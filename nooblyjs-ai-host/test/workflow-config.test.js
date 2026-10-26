// Phase 27: the process as configuration, in NooblyJS itself (root design.md §13, roadmap Phase 27). Who may do what is
// access/roles.yaml's (each action names the permission it needs: `actions:`), the stages and their gates
// workflows/lifecycle.yaml's; both are checked whenever they change, the last good version keeps running when a file is
// refused, and Platform · Settings · Workflow says what is in use and why. These run on the PRD-031 sample story.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let thabo;
let priya;
before(async () => {
  env = await startApp();
  [stevie, lerato, thabo, priya] = [env.client(), env.client(), env.client(), env.client()];
  await stevie.signIn('stevie');
  await lerato.signIn('lerato-m');
  await thabo.signIn('thabo-n');
  await priya.signIn('priya-s');
});
after(async () => { await env?.stop(); });

const roles = async () => yaml.load(await env.store.readText(['access', 'roles.yaml']));
const writeRoles = (doc) => env.store.writeText(['access', 'roles.yaml'], yaml.dump(doc, { lineWidth: 200 }));
const sendBack = (c, id) => c.json(`/workflows/api/v1/items/${id}/send-back`, { method: 'POST', json: { to: 'discover', reason: 'The problem needs customer evidence first' } });

test('Platform · Settings · Workflow: the stages, their gates and checks, every action, and each file\'s state', async () => {
  const { status, body } = await stevie.json('/api/v1/platform/workflow');
  assert.equal(status, 200);
  assert.deepEqual(body.stages.map((s) => s.label), ['Discover', 'Product', 'Design', 'Engineer', 'Build', 'Test', 'Release', 'Operate']);
  const product = body.stages.find((s) => s.key === 'product');
  assert.deepEqual([product.exit.rule, product.exit.toLabel, product.exit.permission, product.checks.length], ['spec', 'Design', 'approve', 7]);
  assert.deepEqual(body.files.map((f) => [f.file, f.status]), [
    ['lifecycle.yaml', 'applied'], ['approval-rules.yaml', 'applied'], ['readiness.yaml', 'applied'], ['access/roles.yaml', 'applied'],
  ]);
  const sendBackAction = body.actions.find((a) => a.action === 'send-back');
  assert.deepEqual([sendBackAction.permission, sendBackAction.fromFile], ['approve', true]);
  assert.ok(body.actions.some((a) => a.action === 'platform.members.manage' && a.permission === 'manage-members'));
  // Reading it needs read-audit, which a Contributor hasn't.
  assert.equal((await priya.json('/api/v1/platform/workflow')).status, 403);
});

test('27b step 1: send-back needs accept-decisions: Lerato (Approver) is told so; Thabo (Architect) sends PRD-031 back', async () => {
  const doc = await roles();
  doc.actions['send-back'] = 'accept-decisions';
  await writeRoles(doc);
  const refused = await sendBack(lerato, 'PRD-031');
  assert.equal(refused.status, 403);
  assert.match(refused.body.error.message, /it needs the "accept-decisions" permission, and your access role is Approver/);
  // The item page doesn't offer Lerato a Send back she can't do.
  assert.equal((await lerato.json('/workflows/api/v1/items/PRD-030')).body.actions.canSendBack, false);
  const sent = await sendBack(thabo, 'PRD-031');
  assert.equal(sent.status, 200);
  assert.equal(sent.body.to, 'discover');
  // The change is in Activity, in words.
  await eventually(async () => {
    const changed = (await today(env.store, 'events')).find((e) => e.type === 'workflow.changed' && e.payload.file === 'access/roles.yaml');
    assert.match(changed.payload.summary, /send-back needs "accept-decisions" \(was "approve"\)/);
  });
  doc.actions['send-back'] = 'approve';
  await writeRoles(doc);
});

test('27b step 2: an action mapped to a permission that doesn\'t exist refuses the file; the last good keeps running', async () => {
  const doc = await roles();
  doc.actions['platform.members.manage'] = 'run-everything';
  await writeRoles(doc);
  const { body } = await stevie.json('/api/v1/platform/workflow');
  const file = body.files.find((f) => f.file === 'access/roles.yaml');
  assert.equal(file.status, 'refused');
  assert.equal(file.errors[0].where, 'actions.platform.members.manage');
  assert.match(file.errors[0].message, /there is no permission "run-everything"/);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'workflow.refused' && a.target === 'access/roles.yaml')));
  // The last good version: Priya still can't change members; Stevie still can read the workflow.
  assert.equal((await priya.request('/api/v1/platform/members/naledi-k', { method: 'PATCH', json: { accessRole: 'Owner', reason: 'try' } })).status, 403);
  assert.equal((await stevie.json('/api/v1/platform/workflow')).status, 200);
  delete doc.actions['platform.members.manage'];
  await writeRoles(doc);
  assert.equal((await stevie.json('/api/v1/platform/workflow')).body.files.find((f) => f.file === 'access/roles.yaml').status, 'applied');
});

test('27b step 5: Design relabelled "Solution design": Home, the item page, Metrics and Activity say it; nothing breaks', async () => {
  const doc = yaml.load(await env.store.readText(['workflows', 'lifecycle.yaml']));
  doc.stages.find((s) => s.key === 'design').label = 'Solution design';
  await env.store.writeText(['workflows', 'lifecycle.yaml'], yaml.dump(doc, { lineWidth: 200 }));
  const overview = (await stevie.json('/api/v1/home/overview')).body;
  assert.ok(JSON.stringify(overview).includes('Solution design'));
  const item = (await stevie.json('/workflows/api/v1/items/PRD-027')).body;
  assert.equal(item.item.stageLabel, 'Solution design');
  assert.ok(item.stages.some((s) => s.key === 'design' && s.label === 'Solution design'));
  const metrics = (await stevie.json('/api/v1/home/metrics?range=30d')).body;
  assert.ok(metrics.stages.some((s) => s.key === 'design' && s.label === 'Solution design'), JSON.stringify(metrics.stages.map((s) => s.label)));
  await eventually(async () => {
    const changed = (await today(env.store, 'events')).find((e) => e.type === 'workflow.changed' && e.payload.file === 'lifecycle.yaml');
    assert.match(changed.payload.summary, /renamed Design to Solution design/);
  });
  // The Product handoff's button and the Approvals queue still work, and send Design's work on under its new name.
  const rows = (await stevie.json('/workflows/api/v1/items')).body;
  assert.equal(rows.stages.find((s) => s.key === 'design').label, 'Solution design');
});

test('a data folder from before Phase 27 gets a lifecycle.yaml of today\'s stages, with no checks of its own', async () => {
  const { tempDir, FsStore } = await import('./helpers.js');
  const { seedMissing } = await import('../src/seed/index.js');
  const dir = await tempDir();
  const store = new FsStore(dir);
  await store.writeYaml(['workflows', 'approval-rules.yaml'], { rules: [] });
  await store.writeYaml(['config', 'seed.yaml'], { content: true });
  const added = await seedMissing(store, { now: new Date().toISOString() });
  assert.ok(added.includes('workflows/lifecycle.yaml'));
  const doc = yaml.load(await store.readText(['workflows', 'lifecycle.yaml']));
  assert.deepEqual(doc.stages.map((s) => [s.key, s.kind]).slice(0, 3), [['discover', 'discover'], ['product', 'product'], ['design', 'design']]);
  assert.ok(doc.stages.every((s) => s.checks === undefined), 'readiness.yaml still says the checks');
  assert.deepEqual((await seedMissing(store, { now: new Date().toISOString() })).filter((a) => a.startsWith('workflows/')), [], 'once');
});
