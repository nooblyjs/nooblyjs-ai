// Phase 16e: pull requests in the lifecycle (root product.md §3.2c). A pull request the Software Factory delivers for a
// story is an item of its own (type pr, the story's child) with a Build approval and a Test approval. The Build approval
// moves it to Test and opens the Test approval; a Test approval sent back puts it in Build again; a new commit clears
// both; a person merges after both, for the commit they were given on; a Bitbucket merge without them is flagged. The
// story follows its pull requests and passes Test when the last one is merged; a feature goes to Release when all its
// stories have, without waiting for the item's other features. These tests write their own items.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.js';

const NOW = '2026-10-21T09:00:00.000Z';
const AGENT = { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' };
const person = (id) => ({ id });
const dirs = [];
const runs = [];
const waiting = [];

async function start() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-pull-requests-'));
  dirs.push(dir);
  const factory = { runsForItem: async (id) => runs.filter((r) => r.itemId === id), waitingWork: async (id) => waiting.filter((w) => w.itemId === id) };
  const stand = createHost({ dataDir: dir, now: NOW, services: { factory } });
  const app = express();
  app.use(express.json());
  const hosted = await register(app, createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed({ content: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/workflows/api/v1`;
  const call = async (who, method, url, body) => {
    const res = await fetch(`${base}${url}`, { method, headers: { [PERSON_HEADER]: who, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  const s = hosted.services;
  const item = async (id) => stand.host.store.readDoc(['items', `${id}.md`]).then((d) => d.data);
  const story = (id, stage, feature, parentId = 'PRD-090') => stand.host.store.writeDoc(['items', `${id}.md`], {
    id, type: 'story', ref: id, title: `Story ${id}`, system: 'factory', parentId, feature, stage, status: 'active', owner: 'lerato-m', team: null,
    createdAt: '2026-10-01T09:00:00.000Z', stageEnteredAt: '2026-10-20T09:00:00.000Z', history: [{ stage, enteredAt: '2026-10-20T09:00:00.000Z', by: 'thabo-n' }], version: 1,
  }, '');
  const events = (type) => stand.eventLog.filter((e) => e.type === type);
  const stop = async () => {
    await hosted.close();
    await new Promise((resolve) => server.close(resolve));
  };
  return { stand, s, call, item, story, events, stop };
}

const EVIDENCE = (missing = []) => ({
  required: 3, present: 3 - missing.length, passing: 3 - missing.length, missing, failing: [], unproven: [], gates: 'passed',
  text: missing.length ? `${3 - missing.length} of 3 required tests present (${missing.join(', ')} missing)` : '3 of 3 required tests present, all passing',
  cases: [], manual: [{ id: 'TC-090-1-4', title: 'A person checks it with a screen reader' }],
});
const facts = (storyId, runId, sha, extra = {}) => ({ itemId: storyId, runId, workItemId: `WI-${storyId}-1`, repo: 'acme/web-storefront', title: `Build ${storyId}`, head: `factory/${runId}/main`, sha, gates: 'passed', evidence: EVIDENCE(), ...extra });
const open = async (env, prId, type) => (await env.s.approvals({ type })).find((a) => a.itemId === prId && a.status === 'open');

let env;
before(async () => {
  env = await start();
  await env.stand.host.store.writeDoc(['items', 'PRD-090.md'], {
    id: 'PRD-090', type: 'spec', ref: 'PRD-090', title: 'Item 90', system: 'product', stage: 'design', status: 'active', owner: 'lerato-m', team: null,
    createdAt: '2026-10-01T09:00:00.000Z', stageEnteredAt: '2026-10-10T09:00:00.000Z', history: [{ stage: 'design', enteredAt: '2026-10-10T09:00:00.000Z', by: 'lerato-m' }], version: 1,
  }, '');
});
after(async () => {
  await env?.stop();
  for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
});

test('a delivered pull request is the story\'s child in Build, with its Build approval; only a story\'s are recorded', async () => {
  await env.story('STORY-090-1', 'build', { id: 'FEAT-090-1', title: 'Feature one' });
  const out = await env.s.recordPullRequest(facts('STORY-090-1', 'run-a', 'a'.repeat(40), { evidence: EVIDENCE(['TC-090-1-2']) }));
  assert.equal(out.item.id, 'PR-090-1-1');
  assert.deepEqual([out.item.type, out.item.parentId, out.item.stage, out.item.ref], ['pr', 'STORY-090-1', 'build', 'web-storefront PR-090-1-1']);
  const build = await open(env, 'PR-090-1-1', 'build-approval');
  assert.equal(build.id, out.opened);
  assert.equal(build.sha, 'a'.repeat(40));
  assert.equal(build.link, '/factory/pull-requests/PR-090-1-1');
  assert.match(build.body, /^2 of 3 required tests present \(TC-090-1-2 missing\)\. The checks passed on this commit/);
  // The same delivery again changes nothing; a non-story is refused.
  assert.equal((await env.s.recordPullRequest(facts('STORY-090-1', 'run-a', 'a'.repeat(40), { evidence: EVIDENCE(['TC-090-1-2']) }))).opened, null);
  await assert.rejects(env.s.recordPullRequest(facts('PRD-090', 'run-x', 'f'.repeat(40))), /is not a story/);
  // The story goes on pull request by pull request; so does the pull request.
  const whole = await env.call('lerato-m', 'POST', '/items/STORY-090-1/advance', {});
  assert.deepEqual([whole.status, whole.body.error.code], [422, 'per_pull_request']);
  assert.equal((await env.call('lerato-m', 'POST', '/items/PR-090-1-1/advance', {})).body.error.code, 'per_pull_request');
  const view = (await env.call('lerato-m', 'GET', '/items/STORY-090-1')).body;
  assert.deepEqual(view.item.pullRequests.map((p) => [p.id, p.stage, p.href]), [['PR-090-1-1', 'build', '/factory/pull-requests/PR-090-1-1']]);
  assert.equal(view.actions.canAdvance, false);
});

test('the Build approval moves it to Test and opens the Test approval; the Test approval\'s checks need every required test', async () => {
  const build = await open(env, 'PR-090-1-1', 'build-approval');
  // An agent is refused, and audited.
  await assert.rejects(env.s.decideApproval({ approvalId: build.id, decision: 'approve', actor: AGENT }), { code: 'people_only' });
  const res = await env.s.decideApproval({ approvalId: build.id, decision: 'approve', actor: person('lerato-m'), for: 'stevie' });
  assert.equal(res.outcome, 'approved');
  assert.equal((await env.item('PR-090-1-1')).stage, 'test');
  assert.equal((await env.item('STORY-090-1')).stage, 'test', 'the story follows its only pull request');
  const testApproval = await open(env, 'PR-090-1-1', 'test-approval');
  assert.match(testApproval.body, /^The AI's tests: 2 of 3 required tests present \(TC-090-1-2 missing\)\. A person checks: TC-090-1-4 \(A person checks it with a screen reader\)\. Build approval given by Lerato M\. for Stevie\./);
  // TC-090-1-2 is missing: the Test approval's readiness refuses, naming it, unless a person overrides with a reason.
  await assert.rejects(env.s.decideApproval({ approvalId: testApproval.id, decision: 'approve', actor: person('stevie') }), (err) => err.code === 'readiness_failed' && /TC-090-1-2 missing/.test(err.message));
  const readiness = (await env.call('stevie', 'GET', '/items/PR-090-1-1')).body.readiness;
  assert.deepEqual(readiness.checks.map((c) => [c.key, c.passed]), [['required-tests', false], ['gates-passed', true]]);
});

test('sent back from Test it is in Build again; a new commit clears both approvals and opens a fresh Build approval', async () => {
  const testApproval = await open(env, 'PR-090-1-1', 'test-approval');
  const back = await env.s.decideApproval({ approvalId: testApproval.id, decision: 'request-changes', reason: 'TC-090-1-2 is not automated', actor: person('stevie') });
  assert.equal(back.outcome, 'changes-requested');
  assert.equal((await env.item('PR-090-1-1')).stage, 'build');
  assert.equal((await env.item('STORY-090-1')).stage, 'build');
  const sent = env.events('approval.decided').at(-1);
  assert.deepEqual([sent.payload.itemType, sent.payload.type, sent.payload.outcome, sent.payload.reason], ['pr', 'test-approval', 'changes-requested', 'TC-090-1-2 is not automated']);
  assert.ok(env.events('item.sent_back').some((e) => e.payload.itemId === 'PR-090-1-1' && e.payload.itemType === 'pr'));
  // The repair's commit: the Build approval given on the old commit is cleared, and a fresh one opens.
  const fixed = await env.s.recordPullRequest(facts('STORY-090-1', 'run-a', 'b'.repeat(40)));
  assert.equal(fixed.cleared, 1);
  const list = (await env.s.approvals({ type: 'build-approval' })).filter((a) => a.itemId === 'PR-090-1-1');
  assert.deepEqual(list.map((a) => a.status).sort(), ['cleared', 'open']);
  assert.ok(env.stand.auditLog.some((a) => a.action === 'approval.cleared' && a.itemId === 'PR-090-1-1'));
});

test('a person merges only after both approvals for the pull request\'s commit; a commit being checked holds it', async () => {
  const blocked = env.s.canMerge({ prId: 'PR-090-1-1', actor: person('lerato-m') });
  await assert.rejects(blocked, (err) => err.code === 'not_mergeable' && /it needs the Build approval, the Test approval/.test(err.message));
  await assert.rejects(env.s.canMerge({ prId: 'PR-090-1-1', actor: AGENT }), { code: 'people_only' });
  await assert.rejects(env.s.canMerge({ prId: 'PR-090-1-1', actor: person('priya-s') }), { code: 'forbidden' });
  await env.s.decideApproval({ approvalId: (await open(env, 'PR-090-1-1', 'build-approval')).id, decision: 'approve', actor: person('stevie') });
  await env.s.decideApproval({ approvalId: (await open(env, 'PR-090-1-1', 'test-approval')).id, decision: 'approve', actor: person('stevie') });
  const { given } = await env.s.canMerge({ prId: 'PR-090-1-1', actor: person('lerato-m') });
  assert.deepEqual(given.map((g) => [g.type, g.by]), [['build-approval', 'stevie'], ['test-approval', 'stevie']]);
  // A pushed commit, being checked: both cleared, nothing opens until the Factory has checked it.
  const pushed = await env.s.recordPullRequest(facts('STORY-090-1', 'run-a', 'c'.repeat(40), { checking: true, gates: 'none', evidence: null, why: 'a commit (ccccccc) was pushed' }));
  assert.deepEqual([pushed.cleared, pushed.opened, pushed.item.stage], [2, null, 'build']);
  await assert.rejects(env.s.canMerge({ prId: 'PR-090-1-1', actor: person('lerato-m') }), /the Factory to finish checking its new commit \(ccccccc\)/);
  const checked = await env.s.recordPullRequest(facts('STORY-090-1', 'run-a', 'c'.repeat(40)));
  assert.ok(checked.opened, 'checked: a fresh Build approval');
});

test('merged: the story passes Test; its feature waits on its other story, then both go to Release while the item\'s other feature is in Build', async () => {
  await env.s.decideApproval({ approvalId: (await open(env, 'PR-090-1-1', 'build-approval')).id, decision: 'approve', actor: person('stevie') });
  await env.s.decideApproval({ approvalId: (await open(env, 'PR-090-1-1', 'test-approval')).id, decision: 'approve', actor: person('stevie') });
  // Feature one has a second story, still in Build; feature two's story is in Build too.
  await env.story('STORY-090-2', 'build', { id: 'FEAT-090-1', title: 'Feature one' });
  await env.story('STORY-090-3', 'build', { id: 'FEAT-090-2', title: 'Feature two' });
  waiting.push({ itemId: 'STORY-090-1', workItemId: 'WI-STORY-090-1-2', repo: 'slots-api', reason: 'no repository is set up for "slots-api"' });
  const merged = await env.s.pullRequestMerged({ prId: 'PR-090-1-1', actor: person('lerato-m') });
  assert.equal(merged.item.status, 'completed');
  const s1 = await env.item('STORY-090-1');
  assert.deepEqual([s1.stage, Boolean(s1.passedTestAt), s1.notBuiltHere.map((w) => w.repo)], ['test', true, ['slots-api']]);
  assert.match(env.events('pr.merged').at(-1).payload.summary, /^merged web-storefront PR-090-1-1 · Build STORY-090-1, after the Build approval by Stevie and the Test approval by Stevie$/);
  assert.equal(env.events('feature.in_release').length, 0, 'feature one waits on STORY-090-2');
  // STORY-090-2's pull request, both approvals, merged: feature one is in Release; feature two isn't.
  await env.s.recordPullRequest(facts('STORY-090-2', 'run-b', 'd'.repeat(40)));
  await env.s.decideApproval({ approvalId: (await open(env, 'PR-090-2-1', 'build-approval')).id, decision: 'approve', actor: person('stevie') });
  await env.s.decideApproval({ approvalId: (await open(env, 'PR-090-2-1', 'test-approval')).id, decision: 'approve', actor: person('stevie') });
  await env.s.pullRequestMerged({ prId: 'PR-090-2-1', actor: person('thabo-n') });
  assert.deepEqual([(await env.item('STORY-090-1')).stage, (await env.item('STORY-090-2')).stage, (await env.item('STORY-090-3')).stage], ['release', 'release', 'build']);
  assert.match(env.events('feature.in_release')[0].payload.summary, /^FEAT-090-1 · Feature one is in Release: all 2 of its stories passed Test$/);
  const features = Object.fromEntries((await env.s.featuresOf({ itemId: 'PRD-090' })).map((f) => [f.id, [f.stage, f.text]]));
  assert.deepEqual(features, { 'FEAT-090-1': ['release', 'In Release: all its stories passed Test'], 'FEAT-090-2': ['build', 'In Build (STORY-090-3)'] });
  // A story still being built (a run with no pull request yet) stays in Build.
  runs.push({ itemId: 'STORY-090-3', id: 'run-c', status: 'running' });
  await env.s.recordPullRequest(facts('STORY-090-3', 'run-d', 'e'.repeat(40)));
  await env.s.decideApproval({ approvalId: (await open(env, 'PR-090-3-1', 'build-approval')).id, decision: 'approve', actor: person('stevie') });
  assert.deepEqual([(await env.item('PR-090-3-1')).stage, (await env.item('STORY-090-3')).stage], ['test', 'build']);
});

test('a Bitbucket merge without both approvals is flagged on the story, not counted; with them it counts', async () => {
  const early = await env.s.pullRequestMergedOutside({ workItemId: 'WI-STORY-090-3-1', mergedBy: 'Thabo N.' });
  assert.deepEqual([early.counted, early.missing], [false, ['the Test approval']]);
  assert.equal((await env.item('PR-090-3-1')).status, 'active');
  assert.deepEqual((await env.item('STORY-090-3')).mergedEarly.missing, ['the Test approval']);
  assert.ok(env.stand.auditLog.some((a) => a.action === 'pr.merged_before_approval' && a.target === 'PR-090-3-1'));
  assert.match(env.events('pr.merged_early').at(-1).payload.summary, /was merged in Bitbucket by Thabo N\. before the Test approval: not counted as done$/);
  await env.s.decideApproval({ approvalId: (await open(env, 'PR-090-3-1', 'test-approval')).id, decision: 'approve', actor: person('stevie') });
  const counted = await env.s.pullRequestMergedOutside({ workItemId: 'WI-STORY-090-3-1', mergedBy: 'Thabo N.' });
  assert.equal(counted.counted, true);
  assert.equal((await env.item('PR-090-3-1')).mergedVia, 'bitbucket');
  assert.equal(await env.s.pullRequestMergedOutside({ workItemId: 'WI-NOT-A-PR', mergedBy: 'Thabo N.' }), null, 'not a lifecycle pull request');
});
