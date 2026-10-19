// Phase 16a: the nine stages. Ship is replaced by Verify, Release and Operate; leaving each is a person's decision with
// its own permission (a production deploy needs two different people); a person's merge in Bitbucket moves an item to
// Verify; items still in Ship move to Verify once, on record; and a data folder from before gets the new rules and
// permissions without anyone editing a file. These tests write their own items: they don't need the PRD-031 story.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { STAGE_KEYS } from '../../src/lifecycle/stages.js';
import { createRoles } from '../../src/middleware/roles.js';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

const NOW = '2026-10-19T09:00:00.000Z';
const dirs = [];

/** One lifecycle engine on its own data folder, with the rules written and nothing else (no sample story). */
async function start({ files = {}, services = {}, people, dir: reuse } = {}) {
  const dir = reuse ?? await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-nine-stages-'));
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

let env;
before(async () => { env = await start(); });
after(async () => {
  await env?.stop();
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

test('there are nine stages, and Overview shows each with what waits there in words', async () => {
  assert.deepEqual(STAGE_KEYS, ['discover', 'specify', 'architect', 'ux', 'ui', 'build', 'verify', 'release', 'operate']);
  const { status, body } = await env.call('stevie', 'GET', '/overview');
  assert.equal(status, 200);
  assert.deepEqual(body.stages.map((s) => [s.number, s.label]), [
    [1, 'Discover'], [2, 'Specify'], [3, 'Architect'], [4, 'UX design'], [5, 'UI design'], [6, 'Build'], [7, 'Verify'], [8, 'Release'], [9, 'Operate'],
  ]);
  const notes = Object.fromEntries(body.stages.map((s) => [s.key, s.note]));
  assert.equal(notes.build, 'on the line · 0 PRs awaiting merge');
  assert.equal(notes.verify, '0 release candidates in review');
  assert.equal(notes.release, '0 deploys awaiting approval');
  assert.equal(notes.operate, '0 outcome reviews due');
});

test('Build → Verify → Release → Operate → done: each step is a person\'s decision with its own permission', async () => {
  await env.put('WALK-1', 'build');
  let page = (await env.call('lerato-m', 'GET', '/items/WALK-1')).body;
  assert.equal(page.actions.advanceLabel, 'Approve the merge');

  // A Contributor may not merge, and an agent may not decide anything, whatever its access role. Both are audited.
  const contributor = await env.call('priya-s', 'POST', '/items/WALK-1/advance', {});
  assert.equal(contributor.status, 403);
  assert.match(contributor.body.error.message, /"merge" permission/);
  const agent = await env.call('ada-quill', 'POST', '/items/WALK-1/advance', {});
  assert.equal(agent.status, 403);
  assert.equal(agent.body.error.code, 'people_only');
  assert.ok(env.stand.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'ada-quill'));

  // The merge leaves Build for Verify (it used to complete the item).
  let res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.item.stage, 'verify');
  assert.ok(env.events('item.stage_changed').some((e) => e.payload.itemId === 'WALK-1' && e.payload.from === 'build' && e.payload.to === 'verify'));

  // Verify → Release: the release candidate, which needs accept-release-candidate.
  page = (await env.call('lerato-m', 'GET', '/items/WALK-1')).body;
  assert.equal(page.actions.advanceLabel, 'Accept the release candidate');
  assert.equal((await env.call('priya-s', 'POST', '/items/WALK-1/advance', {})).status, 403);
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.equal(res.body.item.stage, 'release');
  assert.equal(res.body.approval.type, 'release-candidate');

  // Release → Operate: a production deploy needs two different people.
  page = (await env.call('lerato-m', 'GET', '/items/WALK-1')).body;
  assert.equal(page.actions.advanceLabel, 'Approve the production deploy');
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'pending');
  assert.equal(res.body.item.stage, 'release');
  const deploy = res.body.approval;
  assert.equal(deploy.type, 'deploy');
  // The item has no team, so the other reviewers are the Owners (the rule for every approval).
  assert.deepEqual(deploy.reviewers.map((r) => [r.id, r.status]).sort(), [['lerato-m', 'approved'], ['stevie', 'waiting']]);
  assert.ok(env.events('approval.requested').some((e) => e.payload.approvalId === deploy.id));
  // The same person can't count twice, and an agent can't be the second.
  assert.equal((await env.call('lerato-m', 'POST', `/approvals/${deploy.id}/decision`, { decision: 'approve' })).status, 403);
  assert.equal((await env.call('ada-quill', 'POST', `/approvals/${deploy.id}/decision`, { decision: 'approve' })).status, 403);
  assert.equal((await env.item('WALK-1')).stage, 'release');
  res = await env.call('stevie', 'POST', `/approvals/${deploy.id}/decision`, { decision: 'approve' });
  assert.equal(res.body.outcome, 'approved');
  assert.equal(res.body.item.stage, 'operate');

  // Operate → done: the outcome review completes the item.
  page = (await env.call('lerato-m', 'GET', '/items/WALK-1')).body;
  assert.equal(page.actions.advanceLabel, 'Close with the outcome review');
  res = await env.call('lerato-m', 'POST', '/items/WALK-1/advance', {});
  assert.equal(res.body.approval.type, 'outcome-review');
  assert.equal(res.body.item.status, 'completed');
  assert.ok(env.events('item.completed').some((e) => e.payload.itemId === 'WALK-1'));
});

test('a production deploy is refused when nobody else may approve it', async () => {
  // Only one person may deploy here.
  const lone = await start({ people: [{ id: 'stevie', name: 'Stevie', accessRole: 'Owner', active: true }] });
  try {
    await lone.put('LONE-1', 'release');
    const res = await lone.call('stevie', 'POST', '/items/LONE-1/advance', {});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'no_reviewers');
    assert.match(res.body.error.message, /needs 2 different people/);
    assert.equal((await lone.item('LONE-1')).stage, 'release');
  } finally { await lone.stop(); }
});

test('Verify\'s readiness checks gate the release candidate, and a person may override with a reason', async () => {
  const strict = await start();
  try {
    await strict.store.writeYaml(['readiness.yaml'], { stages: { verify: [{ key: 'e2e-passing', passed: 'End-to-end tests pass', failed: 'End-to-end tests failing' }] } });
    await strict.put('RC-1', 'verify');
    const refused = await strict.call('lerato-m', 'POST', '/items/RC-1/advance', {});
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.code, 'readiness_failed');
    const overridden = await strict.call('lerato-m', 'POST', '/items/RC-1/advance', { override: { reason: 'The failing test is the known flaky one; fixed in the next release.' } });
    assert.equal(overridden.status, 200);
    assert.equal(overridden.body.item.stage, 'release');
    assert.ok(strict.events('readiness.overridden').some((e) => e.payload.itemId === 'RC-1'));
  } finally { await strict.stop(); }
});

test('a person\'s merge in Bitbucket moves the item from Build to Verify; an agent\'s does not', async () => {
  await env.put('MRG-1', 'build');
  await assert.rejects(env.hosted.services.movedByMerge({ itemId: 'MRG-1', mergedBy: [{ name: 'Factory bot', kind: 'agent' }] }), /Only a person's merge in Bitbucket moves an item to Verify/);
  const result = await env.hosted.services.movedByMerge({ itemId: 'MRG-1', mergedBy: [{ name: 'Thabo N.' }], pullRequests: [{ id: 7 }] });
  assert.equal(result.moved, true);
  assert.equal(result.item.stage, 'verify');
  const merged = env.events('item.merged').find((e) => e.payload.itemId === 'MRG-1');
  assert.match(merged.payload.summary, /moved to Verify: its pull request was merged in Bitbucket by Thabo N\./);
  assert.equal((await env.hosted.services.movedByMerge({ itemId: 'MRG-1', mergedBy: [{ name: 'Thabo N.' }] })).reason, 'already in Verify');
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
  await env.put('SEC-1', 'architect');
  const { approvalId } = await env.hosted.services.requestAppApproval({
    type: 'threat-model', itemId: 'SEC-1', subject: 'THR-1', title: 'Threat model for slot holds', ref: { app: 'security', designId: 'THR-1' },
  });
  const page = (await env.call('stevie', 'GET', `/approvals/${approvalId}`)).body.approval;
  assert.equal(page.label, 'Threat model');
  assert.equal(page.decide.approveLabel, 'Accept the threat model');
  // A Contributor and an agent are refused first; the Owner it waits on is told the deciding app isn't running.
  assert.equal((await env.call('priya-s', 'POST', `/approvals/${approvalId}/decision`, { decision: 'approve' })).status, 403);
  assert.equal((await env.call('ada-quill', 'POST', `/approvals/${approvalId}/decision`, { decision: 'approve' })).status, 403);
  const res = await env.call('stevie', 'POST', `/approvals/${approvalId}/decision`, { decision: 'approve' });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'app_unavailable');
  assert.match(res.body.error.message, /decided by security, which is not running here/);
  assert.equal((await env.call('stevie', 'GET', `/approvals/${approvalId}`)).body.approval.status, 'open');

  const risk = await env.hosted.services.requestAppApproval({ type: 'risk-acceptance', itemId: 'SEC-1', subject: 'FND-1', ref: { app: 'security', designId: 'FND-1' } });
  assert.ok(risk.approvalId);
  // Only people with accept-risk (Architect, Owner) are asked.
  assert.deepEqual(risk.reviewers.map((r) => r.id).sort(), ['stevie']);
});

test('items still in Ship move to Verify once, on record, with no stage event', async () => {
  const shipped = itemData('OLD-1', 'ship', { history: [{ stage: 'build', enteredAt: '2026-10-10T09:00:00.000Z', leftAt: '2026-10-14T09:00:00.000Z', by: 'lerato-m' }, { stage: 'ship', enteredAt: '2026-10-14T09:00:00.000Z', by: 'bitbucket' }] });
  const files = {
    'items/OLD-1.md': { data: shipped },
    'items/OLD-0.md': { data: itemData('OLD-0', 'ship', { status: 'completed', completedAt: '2026-10-12T09:00:00.000Z' }) },
    'approvals/apr_oldmerge.md': {
      data: {
        id: 'apr_oldmerge', type: 'merge', itemId: 'OLD-1', subject: 'OLD-1', title: 'Item OLD-1', from: 'ship', to: null,
        requestedBy: { id: 'lerato-m', name: 'Lerato M.', kind: 'person' }, requestedAt: '2026-10-14T09:00:00.000Z',
        reviewers: [{ id: 'lerato-m', role: 'Approver', status: 'waiting' }], status: 'open',
      },
    },
  };
  const old = await start({ files });
  const dir = old.dir;
  try {
    const moved = await old.item('OLD-1');
    assert.equal(moved.stage, 'verify');
    const history = (await old.store.readDoc(['items', 'OLD-1.md'])).data.history;
    assert.equal(history.at(-2).stage, 'ship');
    assert.ok(history.at(-2).leftAt, 'the Ship visit is closed');
    assert.deepEqual([history.at(-1).stage, history.at(-1).kind, history.at(-1).from], ['verify', 'migrated', 'ship']);
    assert.equal((await old.store.readDoc(['items', 'OLD-0.md'])).data.stage, 'ship', 'a completed item keeps its history');
    assert.equal((await old.store.readDoc(['approvals', 'apr_oldmerge.md'])).data.from, 'verify');
    const records = old.stand.auditLog.filter((a) => a.action === 'lifecycle.stages_migrated');
    assert.equal(records.length, 1);
    assert.deepEqual([records[0].items, records[0].approvals], [['OLD-1'], ['apr_oldmerge']]);
    assert.equal(old.events('item.stage_changed').length, 0, 'nobody decided anything, so no handoff is counted');

    // Deciding the merge that was waiting in Ship records it and moves nothing: the item is already past Build.
    const res = await old.call('lerato-m', 'POST', '/approvals/apr_oldmerge/decision', { decision: 'approve' });
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'approved');
    assert.equal(res.body.item.stage, 'verify');
  } finally { await old.stop(); }

  // The next start on the same folder finds nothing in Ship and writes nothing.
  const again = await start({ dir });
  try {
    assert.equal(again.stand.auditLog.filter((a) => a.action === 'lifecycle.stages_migrated').length, 0);
    assert.equal((await again.item('OLD-1')).stage, 'verify');
  } finally { await again.stop(); }
});

test('a data folder from before gets the new approval rules and permissions; what it lists wins', async () => {
  const { body } = await env.call('stevie', 'GET', '/rules');
  const keys = body.rules.map((r) => r.key);
  for (const key of ['release-candidate', 'outcome-review', 'threat-model', 'risk-acceptance', 'merge', 'deploy']) assert.ok(keys.includes(key), key);
  assert.equal(body.rules.find((r) => r.key === 'deploy').decision, 'Release → Operate (production deploy)');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-old-roles-'));
  dirs.push(dir);
  const store = new FsStore(dir);
  await store.writeYaml(['access', 'roles.yaml'], { roles: ['Viewer', 'Contributor', 'Approver', 'Architect', 'Owner'], permissions: { approve: ['Approver', 'Owner'], 'deploy-production': ['Owner'] } });
  const roles = createRoles({ store });
  assert.equal(await roles.can('Approver', 'accept-release-candidate'), true, 'built in when the file is silent');
  assert.equal(await roles.can('Viewer', 'accept-release-candidate'), false);
  assert.equal(await roles.can('Contributor', 'declare-incident'), true);
  assert.equal(await roles.can('Approver', 'deploy-production'), false, 'the file wins where it speaks');
  assert.equal(await roles.can('Owner', 'deploy-production'), true);
});
