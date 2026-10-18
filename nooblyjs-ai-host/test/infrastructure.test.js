// Phase 9a: NooblyJS Infrastructure (nooblyjs-ai-infrastructure) hosted at /infrastructure. The hosted-app checklist
// (roadmap.md) and the phase's test script, through the real apps: the lifecycle engine, Platform and Infrastructure
// with its mock provisioner. The same steps run in a browser in test/e2e/infrastructure.story.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

const API = '/infrastructure/api/v1';
let env;
let stevie;
let priya;
const hostedInfra = () => env.noobly.hosted.apps.find((a) => a.name === 'infrastructure');
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });

before(async () => {
  // The mock provisioner's pause per 10% of a run: long enough to catch a run queued behind another, no longer.
  process.env.INFRA_MOCK_STEP_MS = '40';
  env = await startApp({
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true },
    ],
  });
  [stevie, priya] = [env.client(), env.client()];
  await stevie.signIn('stevie');
  await priya.signIn('priya-s');
});
after(async () => { await env?.stop(); });

test('checklist 1, 2, 4 and 5: mounted at /infrastructure, on the rail as Infra with its nav and card; deep links get the frame; the API needs a sign-in', async () => {
  const { body } = await stevie.json('/api/v1/shell');
  const infra = body.apps.find((a) => a.name === 'infrastructure');
  assert.deepEqual([infra.state, infra.mountPath, infra.label, infra.icon], ['ready', '/infrastructure', 'Infra', 'cube']);
  assert.deepEqual(infra.nav.map((n) => n.key), ['environments', 'designs', 'runs', 'testing', 'blueprints', 'cost', 'policies']);
  // Between the Software Factory and Teammates on the rail (the mockups), here after the Product Factory.
  const order = body.apps.filter((a) => a.rail !== false).map((a) => a.name);
  assert.ok(order.indexOf('infrastructure') > order.indexOf('product'));
  for (const page of ['/infrastructure', '/infrastructure/environments', '/infrastructure/designs/INF-031']) {
    const res = await stevie.get(page);
    assert.equal(res.status, 200, page);
    assert.match(await res.text(), /id="noobly-content"/);
  }
  assert.equal((await env.client().get(`${API}/environments`)).status, 401);
  assert.equal((await stevie.json(`${API}/environments`)).status, 200);
});

test('checklist 7: the seed story is written under data/infrastructure/ on the first start, and nowhere else', async () => {
  const designs = await fs.readdir(path.join(env.dataDir, 'infrastructure', 'designs'));
  assert.ok(designs.includes('INF-031.md'));
  const { body } = await stevie.json(`${API}/environments`);
  assert.ok(body.environments.some((e) => e.name === 'dev-slots'));
});

test('step 2: Home · Approvals shows INF-031 for Test; Priya is refused; Stevie approves it there and a run for test-slots starts', async () => {
  await stevie.json('/api/v1/shell/status'); // the frame asks for status cards: Infrastructure opens its approvals
  await eventually(async () => {
    const { body } = await stevie.json('/workflows/api/v1/approvals');
    assert.ok(body.rows.some((r) => r.type === 'infra-design' && r.title === 'INF-031 v2 · Approve & provision Test'));
  });
  const row = (await stevie.json('/workflows/api/v1/approvals')).body.rows.find((r) => r.title === 'INF-031 v2 · Approve & provision Test');
  assert.equal((await priya.json('/workflows/api/v1/approvals')).body.rows.length, 0, 'waits on the platform owner only');
  const refused = await priya.request(`/workflows/api/v1/approvals/${row.id}/decision`, { method: 'POST', json: { decision: 'approve' } });
  assert.equal(refused.status, 403);
  const ok = await stevie.request(`/workflows/api/v1/approvals/${row.id}/decision`, { method: 'POST', json: { decision: 'approve' } });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).text, /^Approved for Test\. Provisioning test-slots/);
  const design = (await stevie.json(`${API}/designs/INF-031?kind=test`)).body;
  assert.equal(design.status, 'approved');
  const runs = (await stevie.json(`${API}/runs`)).body.runs;
  assert.ok(runs.some((r) => r.environment === 'test-slots' && r.approvedBy?.id === 'stevie'));
});

test('step 4: the Cloud budget below this month\'s cloud spend pauses new provisioning, in Platform\'s words; Activity shows budget.reached', async () => {
  const settings = (await stevie.json('/api/v1/platform/settings')).body;
  const cloud = settings.budgets.systems.find((s) => s.key === 'cloud');
  assert.equal(cloud.label, 'Cloud (Infrastructure)');
  assert.ok(cloud.spent > 0, 'the spend is Infrastructure\'s cost ledger');
  const saved = await stevie.request('/api/v1/platform/settings/budgets', { method: 'PATCH', json: { systems: { cloud: 100 } } });
  assert.equal(saved.status, 200);
  const refused = await stevie.request(`${API}/environments`, { method: 'POST', json: { name: 'dev-two', kind: 'dev', designId: 'INF-031' } });
  assert.equal(refused.status, 402);
  assert.match((await refused.json()).error.message, /^New provisioning is paused: Cloud \(Infrastructure\) has reached its \$100 budget \(\$[\d,.]+ spent this month\)\./);
  const { body } = await stevie.json('/api/v1/activity?filter=platform');
  assert.ok(body.rows.some((r) => r.type === 'budget.reached' && /Cloud \(Infrastructure\) reached its \$100 budget .*: new provisioning is paused/.test(r.action)));
  // Infrastructure's own card shows Platform's budget.
  assert.match((await stevie.json(`${API}/summary`)).body.spend.text, / of \$100$/);
  await stevie.request('/api/v1/platform/settings/budgets', { method: 'PATCH', json: { systems: { cloud: 6000 } } });
  assert.equal((await stevie.request(`${API}/environments`, { method: 'POST', json: { name: 'dev-two', kind: 'dev', designId: 'INF-031' } })).status, 201);
});

test('step 3: the run has a page of its own: the plan, who approved, and its log', async () => {
  const run = (await stevie.json(`${API}/runs`)).body.runs.find((r) => r.environment === 'test-slots' && r.approvedBy);
  await hostedInfra().idle();
  const detail = (await priya.json(`${API}/runs/${run.id}`)).body;
  assert.deepEqual([detail.status, detail.approvedBy.name], ['done', 'Stevie']);
  const lines = detail.log.map((l) => l.text);
  assert.ok(lines.includes('Approved by Stevie') && lines.includes('Applied 50%') && lines.at(-1) === 'Provisioned test-slots from INF-031 v2');
  // Deep link: the run's page answers with the frame.
  assert.equal((await stevie.get(`/infrastructure/runs/${run.id}`)).status, 200);
  // Activity says it in words, once per step that matters (not once per 10%).
  const rows = (await stevie.json('/api/v1/activity')).body.rows;
  assert.ok(rows.some((r) => r.systemLabel === 'Infrastructure' && r.action === 'provisioned test-slots from INF-031 v2'));
  assert.ok(!rows.some((r) => r.type === 'environment.provisioning_progressed'));
});

test('step 5: six hours on the dev clock and the drift sweep has run; Restore from design on dev-slots starts a run', async () => {
  assert.equal((await hostedInfra().sweep.tick()).ran, false, 'the first check only notes the time');
  assert.equal((await post(stevie, '/api/v1/dev/clock', { hours: 6 })).status, 200);
  const swept = await hostedInfra().sweep.tick();
  assert.equal(swept.ran, true);
  const rows = (await stevie.json('/api/v1/activity')).body.rows;
  assert.ok(rows.some((r) => r.type === 'drift.sweep_finished' && /^checked \d+ environments for drift/.test(r.action)));
  const drift = (await stevie.json(`${API}/drift`)).body.drift.find((d) => d.environment === 'dev-slots');
  assert.equal(drift.status, 'open');
  assert.equal((await post(priya, `${API}/drift/${drift.id}/restore`)).status, 202);
  await hostedInfra().idle();
  assert.equal((await stevie.json(`${API}/drift?status=all`)).body.drift.find((d) => d.id === drift.id).status, 'restored');
  await post(stevie, '/api/v1/dev/clock', { reset: true });
});

test('step 6: a queued run is cancelled and pr-485 destroyed: both audited; pr-485 leaves Platform · Environments and the preview pool', async () => {
  const pool = async () => (await stevie.json('/api/v1/platform/containers')).body.pools.find((p) => p.id === 'preview');
  const before = await pool();
  assert.match(before.note, /from Infrastructure$/);
  const first = await (await post(priya, `${API}/environments`, { name: 'dev-three', kind: 'dev', designId: 'INF-031' })).json();
  const second = await (await post(priya, `${API}/environments`, { name: 'dev-four', kind: 'dev', designId: 'INF-031' })).json();
  const cancelled = await post(priya, `${API}/runs/${second.run.id}/cancel`);
  assert.equal((await cancelled.json()).run.status, 'cancelled');
  await hostedInfra().idle();
  assert.equal((await stevie.json(`${API}/runs/${first.run.id}`)).body.status, 'done');

  assert.equal((await post(priya, `${API}/environments/pr-485/destroy`)).status, 200);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((a) => a.actor === 'priya-s' && a.action === `POST ${API}/runs/${second.run.id}/cancel` && a.status === 200));
    assert.ok(audit.some((a) => a.actor === 'priya-s' && a.action === `POST ${API}/environments/pr-485/destroy` && a.status === 200));
  });
  const listed = (await stevie.json('/api/v1/platform/environments')).body.environments.map((e) => e.name);
  assert.ok(!listed.includes('pr-485') && !listed.includes('dev-four') && listed.includes('dev-three'));
  assert.equal((await pool()).used, before.used - 1);
});

test('step 7: Platform · Environments is Infrastructure\'s list, each linking to it', async () => {
  const { body } = await priya.json('/api/v1/platform/environments');
  assert.deepEqual([body.source, body.href], ['infrastructure', '/infrastructure']);
  const prod = body.environments.find((e) => e.name === 'prod');
  assert.deepEqual([prod.kind, prod.approvals, prod.secretsScope, prod.agentsMayDeploy, prod.href], ['Production', 2, 'production', false, '/infrastructure/environments/prod']);
  const dev = body.environments.find((e) => e.name === 'dev-slots');
  assert.deepEqual([dev.approvals, dev.secretsScope, dev.agentsMayDeploy], [0, 'staging', true]);
});

test('checklist 5: a Viewer reads and changes nothing; an agent is refused an approval whatever its role', async () => {
  const viewer = env.client();
  await viewer.signIn('naledi-k');
  assert.equal((await viewer.json(`${API}/environments`)).status, 200);
  const refused = await post(viewer, `${API}/environments`, { name: 'dev-nine', kind: 'dev', designId: 'INF-031' });
  assert.equal(refused.status, 403);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.actor === 'naledi-k' && a.status === 403)));
  await assert.rejects(hostedInfra().services.decideApproval({ designId: 'INF-031', version: 2, kind: 'staging', decision: 'approve', person: { id: 'ada-quill', name: 'Ada Quill', kind: 'agent', accessRole: 'Owner' } }), { status: 403 });
});
