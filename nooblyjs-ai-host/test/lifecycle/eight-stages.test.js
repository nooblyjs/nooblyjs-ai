// Phase 16b: lifecycle v3, eight stages (root product.md §3.2). Discover · Product · Design · Engineer · Build · Test ·
// Release · Operate. Leaving each is a person's decision: the Product handoff, the Design handoff, the Engineering
// sign-off (an Application Architect and a test lead), the Build approval, the Test approval, the production deploy (two
// different people) and the outcome review. Any person but a Viewer may give an approval on behalf of someone it waits
// on, recorded as given by them for that person; agents never. The work reaches the Software Factory only with the
// Engineering sign-off. Items in a stage from before move once, on record. These tests write their own items: they
// don't need the PRD-031 story. (Phase 16a's nine stages were tested here before.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { STAGE_KEYS, stageKey, handoffLabel } from '../../src/lifecycle/stages.js';
import { createRoles } from '../../src/middleware/roles.js';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

const NOW = '2026-10-19T09:00:00.000Z';
const OVERRIDE = { override: { reason: 'The spec checks are recorded in the Product section.' } };
const dirs = [];

/** One lifecycle engine on its own data folder, with the rules written and nothing else (no sample story). */
async function start({ files = {}, services = {}, people, dir: reuse } = {}) {
  const dir = reuse ?? await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-eight-stages-'));
  if (!reuse) dirs.push(dir);
  const store = new FsStore(dir);
  for (const [name, data] of Object.entries(files)) await store.writeDoc(name.split('/'), data.data, data.body ?? '');
  const stand = createHost({ dataDir: dir, now: NOW, services, ...(people ? { people } : {}) });
  const app = express();
  app.use(express.json());
  const hosted = await register(app, createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed({ content: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/workflows/api/v1`;
  const call = async (person, method, url, body) => {
    const res = await fetch(`${base}${url}`, { method, headers: { [PERSON_HEADER]: person, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const item = async (id) => (await call('stevie', 'GET', `/items/${id}`)).body.item;
  const put = (id, stage, extra = {}) => store.writeDoc(['items', `${id}.md`], itemData(id, stage, extra), '');
  const events = (type) => stand.eventLog.filter((e) => e.type === type);
  const stop = async () => {
    await hosted.close();
    await new Promise((resolve) => server.close(resolve));
  };
  return { dir, store, stand, hosted, call, item, put, events, stop };
}

function itemData(id, stage, extra = {}) {
  return {
    id, type: 'spec', ref: id, title: `Item ${id}`, system: 'product', stage, status: 'active', owner: 'lerato-m', team: null,
    createdAt: '2026-10-01T09:00:00.000Z', stageEnteredAt: '2026-10-15T09:00:00.000Z',
    history: [{ stage, enteredAt: '2026-10-15T09:00:00.000Z', by: 'lerato-m' }], version: 1, updatedAt: '2026-10-15T09:00:00.000Z',
    ...extra,
  };
}

const approvalData = (id, type, itemId, from, reviewers, extra = {}) => ({
  id, type, itemId, subject: itemId, title: `Item ${itemId}`, from, to: null,
  requestedBy: { id: 'lerato-m', name: 'Lerato M.', kind: 'person' }, requestedAt: '2026-10-18T09:00:00.000Z',
  reviewers: reviewers.map((r) => ({ id: r, role: 'Approver', status: 'waiting' })), status: 'open', ...extra,
});

let env;
before(async () => { env = await start(); });
after(async () => {
  await env?.stop();
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

test('there are eight stages, handoffs are named by area, and Overview says what waits in each', async () => {
  assert.deepEqual(STAGE_KEYS, ['discover', 'product', 'design', 'engineer', 'build', 'test', 'release', 'operate']);
  assert.deepEqual([stageKey('specify'), stageKey('ux'), stageKey('ui'), stageKey('architect'), stageKey('verify'), stageKey('ship')], ['product', 'product', 'product', 'design', 'test', 'test']);
  assert.deepEqual([handoffLabel('product', 'design'), handoffLabel('design', 'engineer'), handoffLabel('engineer', 'build'), handoffLabel('build', 'test')],
    ['Product → Design', 'Design → Engineering', 'Engineering → Build', 'Build → Test']);
  const { status, body } = await env.call('stevie', 'GET', '/overview');
  assert.equal(status, 200);
  assert.deepEqual(body.stages.map((s) => [s.number, s.label]), [
    [1, 'Discover'], [2, 'Product'], [3, 'Design'], [4, 'Engineer'], [5, 'Build'], [6, 'Test'], [7, 'Release'], [8, 'Operate'],
  ]);
  const notes = Object.fromEntries(body.stages.map((s) => [s.key, s.note]));
  assert.equal(notes.product, 'specs, UX and UI · 0 in review');
  assert.equal(notes.design, '0 ADRs proposed · 0 awaiting handoff');
  assert.equal(notes.engineer, '0 awaiting sign-off');
  assert.equal(notes.build, 'on the line · 0 PRs awaiting the Build approval');
  assert.equal(notes.test, '0 PRs awaiting the Test approval');
});

test('Product → Design → Engineer → Build → Test → Release → Operate → done: each step is a person\'s decision', async () => {
  await env.put('WALK-1', 'product');
  const label = async () => (await env.call('lerato-m', 'GET', '/items/WALK-1')).body.actions.advanceLabel;
  assert.equal(await label(), 'Approve & hand off to Design');

  // A Viewer and an agent may not decide anything, whatever its access role. Both refusals are audited.
  const viewer = await env.call('naledi-k', 'POST', '/items/WALK-1/advance', OVERRIDE);
  assert.equal(viewer.status, 403);
  assert.equal(viewer.body.error.code, 'viewers_cannot_approve');
  const agent = await env.call('ada-quill', 'POST', '/items/WALK-1/advance', OVERRIDE);
  assert.equal(agent.status, 403);
  assert.equal(agent.body.error.code, 'people_only');
  assert.ok(env.stand.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'ada-quill'));
  assert.ok(env.stand.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'naledi-k'));

  // The Product handoff (the spec rule) leaves Product for Design; its readiness is the spec checks.
  assert.equal((await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {})).status, 422);
  let res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', OVERRIDE);
  assert.equal(res.status, 200);
  assert.equal(res.body.approval.type, 'spec');
  assert.equal(res.body.item.stage, 'design');

  // The Design handoff, an Architect's (accept-decisions): Engineer. Lerato (an Approver) gives it on behalf of the
  // Owner it waits on, and the record says so.
  assert.equal(await label(), 'Approve & hand off to Engineering');
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.approval.type, 'design-handoff');
  assert.equal(res.body.item.stage, 'engineer');
  assert.deepEqual([res.body.by, res.body.for], ['lerato-m', 'stevie']);
  assert.equal(res.body.approval.reviewers[0].by, 'lerato-m');
  assert.match(env.events('approval.decided').at(-1).payload.summary, /approved the Design handoff of WALK-1 · Item WALK-1 to Engineering, for Stevie$/);
  assert.equal(env.events('handoff.created').length, 0, 'nothing goes to the Software Factory before the Engineering sign-off');

  // The Engineering sign-off waits on an Application Architect and a test lead: Lerato holds the test lead's place
  // (sign-off-tests), so it waits on the Owner for the other. Stevie's approval sends it to Build, with the work.
  assert.equal(await label(), 'Sign off & send to Build');
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.equal(res.body.outcome, 'pending');
  assert.equal(res.body.item.stage, 'engineer');
  const signoff = res.body.approval;
  assert.equal(signoff.type, 'engineering-signoff');
  assert.deepEqual(signoff.reviewers.map((r) => [r.id, r.role, r.status]), [['stevie', 'Application Architect', 'waiting'], ['lerato-m', 'Test lead', 'approved']]);
  res = await env.call('stevie', 'POST', `/approvals/${signoff.id}/decision`, { decision: 'approve' });
  assert.equal(res.body.outcome, 'approved');
  assert.equal(res.body.item.stage, 'build');
  const created = env.events('handoff.created').find((e) => e.payload.itemId === 'WALK-1');
  assert.deepEqual([created.payload.from, created.payload.to], ['engineer', 'build']);

  // The Build approval (an engineer) moves it to Test; the Test approval (a tester) to Release, when the PR may merge.
  assert.equal(await label(), 'Give the Build approval');
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.deepEqual([res.body.approval.type, res.body.item.stage], ['build-approval', 'test']);
  assert.equal(await label(), 'Give the Test approval');
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.deepEqual([res.body.approval.type, res.body.item.stage], ['test-approval', 'release']);

  // Release → Operate: a production deploy needs two different people.
  assert.equal(await label(), 'Approve the production deploy');
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.equal(res.body.outcome, 'pending');
  const deploy = res.body.approval;
  assert.deepEqual(deploy.reviewers.map((r) => [r.id, r.status]).sort(), [['lerato-m', 'approved'], ['stevie', 'waiting']]);
  // Lerato can't give the second approval too, not even on Stevie's behalf; an agent can't either.
  const twice = await env.call('lerato-m', 'POST', `/approvals/${deploy.id}/decision`, { decision: 'approve' });
  assert.equal(twice.status, 403);
  assert.equal(twice.body.error.code, 'already_given');
  assert.equal((await env.call('ada-quill', 'POST', `/approvals/${deploy.id}/decision`, { decision: 'approve' })).status, 403);
  // Priya (a Contributor) gives it on Stevie's behalf: the second person.
  res = await env.call('priya-s', 'POST', `/approvals/${deploy.id}/decision`, { decision: 'approve' });
  assert.equal(res.body.outcome, 'approved');
  assert.equal(res.body.item.stage, 'operate');
  assert.match(res.body.text, /^Approved for Stevie\. WALK-1 moved to Operate\.$/);

  // Operate → done: the outcome review completes the item.
  assert.equal(await label(), 'Close with the outcome review');
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.equal(res.body.approval.type, 'outcome-review');
  assert.equal(res.body.item.status, 'completed');
});

test('anyone but a Viewer may approve for anyone else: it says for whom, and who gave it is logged', async () => {
  await env.put('BEHALF-1', 'test');
  await env.store.writeDoc(['approvals', 'apr_behalf1.md'], approvalData('apr_behalf1', 'test-approval', 'BEHALF-1', 'test', ['thabo-n', 'stevie'], { to: 'release' }), '');
  // Waiting on two people, neither of them Priya: she must say whom she decides for.
  const ask = await env.call('priya-s', 'POST', '/approvals/apr_behalf1/decision', { decision: 'approve' });
  assert.equal(ask.status, 400);
  assert.match(ask.body.error.message, /Say whom you are deciding for: this approval is waiting on thabo-n, stevie/);
  assert.equal((await env.call('priya-s', 'POST', '/approvals/apr_behalf1/decision', { decision: 'approve', for: 'lerato-m' })).status, 403, 'not someone it waits on');

  // The panel offers her the people it waits on, and says she decides on their behalf.
  const panel = (await env.call('priya-s', 'GET', '/approvals/apr_behalf1')).body.approval.decide;
  assert.deepEqual([panel.can, panel.mine, panel.for.map((r) => r.id)], [true, false, ['thabo-n', 'stevie']]);
  assert.equal((await env.call('naledi-k', 'GET', '/approvals/apr_behalf1')).body.approval.decide.can, false, 'a Viewer is told they can\'t');

  const res = await env.call('priya-s', 'POST', '/approvals/apr_behalf1/decision', { decision: 'approve', for: 'thabo-n' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.outcome, res.body.item.stage], ['approved', 'release']);
  const record = (await env.store.readDoc(['approvals', 'apr_behalf1.md'])).data;
  assert.deepEqual(record.reviewers.map((r) => [r.id, r.status, r.by ?? null]), [['thabo-n', 'approved', 'priya-s'], ['stevie', 'waiting', null]]);
  const decided = env.events('approval.decided').find((e) => e.payload.approvalId === 'apr_behalf1');
  assert.deepEqual([decided.actor, decided.payload.by, decided.payload.for, decided.payload.onBehalf], ['priya-s', 'priya-s', 'thabo-n', true]);
  assert.match(decided.payload.summary, /gave the Test approval on BEHALF-1 · Item BEHALF-1, for Thabo N\.$/);
  assert.ok(env.stand.auditLog.some((a) => a.action === 'approval.on_behalf' && a.actor === 'priya-s' && a.for === 'thabo-n'));

  // A Viewer may not, even for someone named.
  await env.store.writeDoc(['approvals', 'apr_behalf2.md'], approvalData('apr_behalf2', 'test-approval', 'BEHALF-1', null, ['stevie']), '');
  const viewer = await env.call('naledi-k', 'POST', '/approvals/apr_behalf2/decision', { decision: 'approve', for: 'stevie' });
  assert.equal(viewer.status, 403);
  assert.equal(viewer.body.error.code, 'viewers_cannot_approve');
});

test('a production deploy is refused when nobody else may approve it', async () => {
  const lone = await start({ people: [{ id: 'stevie', name: 'Stevie', accessRole: 'Owner', active: true }] });
  try {
    await lone.put('LONE-1', 'release');
    const res = await lone.call('stevie', 'POST', '/items/LONE-1/advance', {});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'no_reviewers');
    assert.match(res.body.error.message, /needs 2 different people .* there is nobody else/);
    assert.equal((await lone.item('LONE-1')).stage, 'release');
  } finally { await lone.stop(); }
});

test('the Design handoff carries the planned work; the Software Factory gets it with the Engineering sign-off', async () => {
  await env.put('HOF-1', 'ui');
  await env.put('HOF-2', 'design');
  // HOF-1 was in UI design before lifecycle v3 and has not moved yet (the migration runs at start): not in Design.
  await assert.rejects(env.hosted.services.handoff({ itemId: 'HOF-1', workItems: [], actor: { id: 'thabo-n' } }), /the Design handoff leaves from Design/);
  const workItems = [{ repo: 'slots-api', title: 'Hold a slot' }, { repo: 'web-storefront', title: 'Slot picker' }];
  const handed = await env.hosted.services.handoff({ itemId: 'HOF-2', workItems, estimate: '$12–$18', note: 'Two repos.', actor: { id: 'thabo-n', kind: 'person' } });
  assert.deepEqual([handed.approval.type, handed.item.stage, handed.handoff], ['design-handoff', 'engineer', null]);
  assert.equal(env.events('handoff.created').filter((e) => e.payload.itemId === 'HOF-2').length, 0);
  // Thabo (an Architect) holds both places of the Engineering sign-off (accept-decisions and sign-off-tests).
  const res = await env.call('thabo-n', 'POST', '/items/HOF-2/advance', {});
  assert.equal(res.body.item.stage, 'build');
  assert.equal(res.body.handoff.workItems.length, 2);
  const created = env.events('handoff.created').find((e) => e.payload.itemId === 'HOF-2');
  const stored = await env.hosted.services.handoffOf({ handoffId: created.payload.handoffId });
  assert.deepEqual(stored.workItems.map((w) => [w.repo, w.title]), [['slots-api', 'Hold a slot'], ['web-storefront', 'Slot picker']]);
  assert.equal(stored.estimate, '$12–$18');
});

test('Test\'s readiness checks gate the Test approval (and Verify\'s count until Test has its own), with an override', async () => {
  const strict = await start();
  try {
    await strict.store.writeYaml(['readiness.yaml'], { stages: { verify: [{ key: 'e2e-passing', passed: 'End-to-end tests pass', failed: 'End-to-end tests failing' }] } });
    await strict.put('RC-1', 'test');
    const refused = await strict.call('lerato-m', 'POST', '/items/RC-1/advance', {});
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.code, 'readiness_failed');
    const overridden = await strict.call('lerato-m', 'POST', '/items/RC-1/advance', { override: { reason: 'The failing test is the known flaky one.' } });
    assert.equal(overridden.status, 200);
    assert.equal(overridden.body.item.stage, 'release');
    assert.ok(strict.events('readiness.overridden').some((e) => e.payload.itemId === 'RC-1'));
  } finally { await strict.stop(); }
});

test('a merge in Bitbucket before the Build and Test approvals is flagged, not counted; an agent\'s is refused', async () => {
  await env.put('MRG-1', 'build');
  await assert.rejects(env.hosted.services.movedByMerge({ itemId: 'MRG-1', mergedBy: [{ name: 'Factory bot', kind: 'agent' }] }), /Only a person's merge in Bitbucket counts/);
  const result = await env.hosted.services.movedByMerge({ itemId: 'MRG-1', mergedBy: [{ name: 'Thabo N.' }], pullRequests: [{ id: 7 }] });
  assert.deepEqual([result.moved, result.flagged, result.item.stage], [false, true, 'build']);
  assert.deepEqual(result.missing, ['the Build approval', 'the Test approval']);
  assert.deepEqual((await env.store.readDoc(['items', 'MRG-1.md'])).data.mergedEarly.by, ['Thabo N.']);
  const merged = env.events('item.merged').find((e) => e.payload.itemId === 'MRG-1');
  assert.match(merged.payload.summary, /merged in Bitbucket by Thabo N\. before the Build approval and the Test approval; it stays in Build/);
  assert.ok(env.stand.auditLog.some((a) => a.action === 'item.merged_before_approval' && a.target === 'MRG-1'));
  await env.put('MRG-2', 'release');
  assert.equal((await env.hosted.services.movedByMerge({ itemId: 'MRG-2', mergedBy: [{ name: 'Thabo N.' }] })).reason, 'MRG-2 is not in Build or Test');
});

test('an item in a later stage can be sent back with a reason, and its open deploy approval is withdrawn', async () => {
  await env.put('BACK-1', 'release');
  const pending = await env.call('lerato-m', 'POST', '/items/BACK-1/advance', {});
  assert.equal(pending.body.outcome, 'pending');
  const back = await env.call('lerato-m', 'POST', '/items/BACK-1/send-back', { to: 'build', reason: 'The load test found a regression.' });
  assert.equal(back.status, 200);
  assert.equal(back.body.item.stage, 'build');
  const deploy = (await env.call('lerato-m', 'GET', `/approvals/${pending.body.approval.id}`)).body.approval;
  assert.equal(deploy.status, 'withdrawn');
});

test('threat model and risk acceptance are app approvals: refused, with nothing recorded, until the Security app runs', async () => {
  await env.put('SEC-1', 'design');
  const { approvalId } = await env.hosted.services.requestAppApproval({
    type: 'threat-model', itemId: 'SEC-1', subject: 'THR-1', title: 'Threat model for slot holds', ref: { app: 'security', designId: 'THR-1' },
  });
  const page = (await env.call('stevie', 'GET', `/approvals/${approvalId}`)).body.approval;
  assert.equal(page.label, 'Threat model');
  assert.equal(page.decide.approveLabel, 'Accept the threat model');
  // A Viewer and an agent are refused first; anyone else (here a Contributor, on the Owner's behalf) is told the
  // deciding app isn't running, and nothing is recorded.
  assert.equal((await env.call('naledi-k', 'POST', `/approvals/${approvalId}/decision`, { decision: 'approve' })).status, 403);
  assert.equal((await env.call('ada-quill', 'POST', `/approvals/${approvalId}/decision`, { decision: 'approve' })).status, 403);
  const res = await env.call('priya-s', 'POST', `/approvals/${approvalId}/decision`, { decision: 'approve' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'app_unavailable');
  assert.match(res.body.error.message, /decided by security, which is not running here/);
  assert.equal((await env.call('stevie', 'GET', `/approvals/${approvalId}`)).body.approval.status, 'open');

  const risk = await env.hosted.services.requestAppApproval({ type: 'risk-acceptance', itemId: 'SEC-1', subject: 'FND-1', ref: { app: 'security', designId: 'FND-1' } });
  // It waits only on people with accept-risk (Architect, Owner); the item has no team, so the Owners.
  assert.deepEqual(risk.reviewers.map((r) => r.id).sort(), ['stevie']);
});

test('items in a stage from before move once, on record, with no stage event; retired approvals are withdrawn', async () => {
  const files = {
    'items/OLD-SPEC.md': { data: itemData('OLD-SPEC', 'specify') },
    'items/OLD-UX.md': { data: itemData('OLD-UX', 'ux') },
    'items/OLD-UI.md': { data: itemData('OLD-UI', 'ui') },
    'items/OLD-ARCH.md': { data: itemData('OLD-ARCH', 'architect') },
    'items/OLD-VER.md': { data: itemData('OLD-VER', 'verify') },
    'items/OLD-SHIP.md': { data: itemData('OLD-SHIP', 'ship', { history: [{ stage: 'build', enteredAt: '2026-10-10T09:00:00.000Z', leftAt: '2026-10-14T09:00:00.000Z', by: 'lerato-m' }, { stage: 'ship', enteredAt: '2026-10-14T09:00:00.000Z', by: 'bitbucket' }] }) },
    'items/OLD-BUILD.md': { data: itemData('OLD-BUILD', 'build') },
    'items/OLD-DONE.md': { data: itemData('OLD-DONE', 'ship', { status: 'completed', completedAt: '2026-10-12T09:00:00.000Z' }) },
    'approvals/apr_oldspec.md': { data: approvalData('apr_oldspec', 'spec', 'OLD-SPEC', 'specify', ['stevie'], { to: 'architect' }) },
    'approvals/apr_oldui.md': { data: approvalData('apr_oldui', 'ui-handoff', 'OLD-UI', 'ui', ['stevie']) },
    'approvals/apr_oldrc.md': { data: approvalData('apr_oldrc', 'release-candidate', 'OLD-VER', 'verify', ['stevie']) },
    'approvals/apr_oldmerge.md': { data: approvalData('apr_oldmerge', 'merge', 'OLD-BUILD', 'build', ['lerato-m']) },
  };
  const old = await start({ files });
  const dir = old.dir;
  try {
    const stages = {};
    for (const id of ['OLD-SPEC', 'OLD-UX', 'OLD-UI', 'OLD-ARCH', 'OLD-VER', 'OLD-SHIP', 'OLD-BUILD']) stages[id] = (await old.item(id)).stage;
    assert.deepEqual(stages, { 'OLD-SPEC': 'product', 'OLD-UX': 'product', 'OLD-UI': 'product', 'OLD-ARCH': 'design', 'OLD-VER': 'test', 'OLD-SHIP': 'test', 'OLD-BUILD': 'build' });
    const history = (await old.store.readDoc(['items', 'OLD-SHIP.md'])).data.history;
    assert.equal(history.at(-2).stage, 'ship');
    assert.ok(history.at(-2).leftAt, 'the Ship visit is closed');
    assert.deepEqual([history.at(-1).stage, history.at(-1).kind, history.at(-1).from], ['test', 'migrated', 'ship']);
    assert.equal((await old.store.readDoc(['items', 'OLD-DONE.md'])).data.stage, 'ship', 'a completed item keeps its history');
    // Open approvals follow; the UI handoff and the release candidate are withdrawn, saying why; a merge is the Build approval.
    const doc = async (id) => (await old.store.readDoc(['approvals', `${id}.md`])).data;
    assert.deepEqual([(await doc('apr_oldspec')).from, (await doc('apr_oldspec')).to], ['product', 'design']);
    assert.deepEqual([(await doc('apr_oldui')).status, (await doc('apr_oldui')).withdrawnReason], ['withdrawn', 'the UI handoff is replaced by the Design handoff (lifecycle v3)']);
    assert.deepEqual([(await doc('apr_oldrc')).status, (await doc('apr_oldrc')).withdrawnReason], ['withdrawn', 'the release candidate is replaced by the Test approval (lifecycle v3)']);
    assert.deepEqual([(await doc('apr_oldmerge')).type, (await doc('apr_oldmerge')).from, (await doc('apr_oldmerge')).to], ['build-approval', 'build', 'test']);
    const records = old.stand.auditLog.filter((a) => a.action === 'lifecycle.stages_migrated');
    assert.equal(records.length, 1);
    assert.deepEqual(records[0].items.sort(), ['OLD-ARCH', 'OLD-SHIP', 'OLD-SPEC', 'OLD-UI', 'OLD-UX', 'OLD-VER']);
    assert.deepEqual(records[0].withdrawn.sort(), ['apr_oldrc', 'apr_oldui']);
    assert.equal(old.events('item.stage_changed').length, 0, 'nobody decided anything, so no handoff is counted');

    // The merge that was waiting is the Build approval now: deciding it moves the item to Test.
    const res = await old.call('lerato-m', 'POST', '/approvals/apr_oldmerge/decision', { decision: 'approve' });
    assert.equal(res.status, 200);
    assert.equal(res.body.item.stage, 'test');
  } finally { await old.stop(); }

  // The next start on the same folder finds nothing from before and writes nothing.
  const again = await start({ dir });
  try {
    assert.equal(again.stand.auditLog.filter((a) => a.action === 'lifecycle.stages_migrated').length, 0);
    assert.equal((await again.item('OLD-SHIP')).stage, 'test');
  } finally { await again.stop(); }
});

test('a data folder from before gets the new rules, words and permissions; retired rules leave the table', async () => {
  const { body } = await env.call('stevie', 'GET', '/rules');
  const keys = body.rules.map((r) => r.key);
  for (const key of ['spec', 'design-handoff', 'engineering-signoff', 'build-approval', 'test-approval', 'deploy', 'outcome-review', 'threat-model', 'risk-acceptance']) assert.ok(keys.includes(key), key);
  for (const key of ['release-candidate', 'ui-handoff', 'merge']) assert.ok(!keys.includes(key), `${key} is retired`);
  assert.equal(body.rules.find((r) => r.key === 'spec').decision, 'Product → Design (spec, UX and UI)');

  // An approval-rules.yaml from before lifecycle v3: its unedited spec words change, its old rules are retired, and the
  // rules it doesn't have are built in. Its readiness checks under `specify` count for Product.
  const oldRules = {
    rules: [
      { key: 'spec', decision: 'Spec → Architecture', approver: 'Product lead', permission: 'approve', quorum: 'all', target: { workingDays: 1 }, label: 'Spec approval', transition: 'Approve & send to Architecture' },
      { key: 'ui-handoff', decision: 'UI → Software Factory', approver: 'Design lead', permission: 'approve', quorum: 'any', target: { hours: 4 } },
      { key: 'merge', decision: 'Merge to main', approver: 'Code owner', permission: 'merge', quorum: 'any', target: { hours: 4 } },
    ],
  };
  const before16b = await start();
  try {
    await before16b.store.writeYaml(['approval-rules.yaml'], oldRules);
    await before16b.store.writeYaml(['readiness.yaml'], { stages: { specify: [{ key: 'goals', passed: 'Goals are measurable', failed: 'Goals need measures' }] } });
    const rules = (await before16b.call('stevie', 'GET', '/rules')).body.rules;
    assert.equal(rules.find((r) => r.key === 'spec').decision, 'Product → Design (spec, UX and UI)');
    assert.ok(rules.some((r) => r.key === 'design-handoff'));
    assert.ok(!rules.some((r) => r.key === 'ui-handoff' || r.key === 'merge'));
    await before16b.put('RDY-1', 'product');
    const page = (await before16b.call('stevie', 'GET', '/items/RDY-1')).body;
    assert.deepEqual([page.readiness.total, page.readiness.checks[0].key], [1, 'goals']);
  } finally { await before16b.stop(); }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-old-roles-'));
  dirs.push(dir);
  const store = new FsStore(dir);
  await store.writeYaml(['access', 'roles.yaml'], { roles: ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'], permissions: { approve: ['Approver', 'Owner'], 'deploy-production': ['Owner'] } });
  const roles = createRoles({ store });
  assert.equal(await roles.can('Approver', 'sign-off-tests'), true, 'built in when the file is silent');
  assert.equal(await roles.can('Viewer', 'sign-off-tests'), false);
  assert.equal(await roles.can('Contributor', 'declare-incident'), true);
  assert.equal(await roles.can('Approver', 'deploy-production'), false, 'the file wins where it speaks');
  assert.equal(await roles.can('Owner', 'deploy-production'), true);
});
