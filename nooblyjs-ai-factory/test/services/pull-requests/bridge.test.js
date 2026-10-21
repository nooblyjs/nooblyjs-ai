// NooblyJS Phase 16e: the pull request bridge. A delivered run for a story is recorded in NooblyJS's lifecycle; changes
// asked for at the Build approval (or a Test approval sent back) send the run back to repair with the person's words;
// a commit pushed to the pull request's branch is recorded at once and checked again from verify; a person's merge is
// carried out on the local forge after the lifecycle says yes, and a Bitbucket one is refused. NooblyJS is a stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBridge } from '../../../src/services/pull-requests/bridge.js';
import { openStore } from '../../../src/models/store/events.js';
import { commitFiles, gitIn, makeRepo, testEnv } from '../../helpers.js';

const HEAD = 'factory/issue-1/main';

/** A delivered run on a repository whose PR branch exists, and a stand-in lifecycle that records what it is told. */
function setUp({ forge = 'local', type = 'story' } = {}) {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ 'README.md': '# demo\n' });
  const base = gitIn(repo, 'rev-parse', 'HEAD');
  gitIn(repo, 'checkout', '-q', '-b', HEAD);
  const sha = commitFiles(repo, { 'test/a.test.js': "test('TC-1-1-1', () => {});\n" }, 'the change');
  gitIn(repo, 'checkout', '-q', 'main');
  const runId = 'run-1';
  const request = { repo, line: 'default', noobly: { itemId: 'STORY-1', workItemId: 'WI-STORY-1-1', repoName: 'web-storefront' }, ...(forge === 'bitbucket' ? { forge: { kind: 'bitbucket', name: 'web-storefront' } } : {}) };
  store.append(`run:${runId}`, 'run.queued', { runId, itemId: 'issue-1', title: 'See the stores', request });
  store.append(`run:${runId}`, 'step.finished', { runId, step: 'build', result: { commits: 1, prBaseSha: base, workspace: { baseRef: 'main', baseSha: base } } });
  store.append(`run:${runId}`, 'step.finished', { runId, step: 'verify', result: { passed: true } });
  store.append(`run:${runId}`, 'step.finished', { runId, step: 'deliver', result: { status: 'delivered', head: HEAD, sha, requiredTests: { text: '1 of 1 required tests present, all passing' } } });
  store.append(`run:${runId}`, 'run.finished', { runId, status: 'delivered', pr: 'prs/issue-1.md', head: HEAD });
  const calls = [];
  let recorded = sha;
  const pr = () => ({ id: 'PR-1-1', ref: 'web-storefront PR-1-1', type: 'pr', status: 'active', pr: { runId, sha: recorded, forge, head: HEAD } });
  const workflows = {
    item: async ({ itemId }) => (itemId === 'STORY-1' ? { id: 'STORY-1', type } : itemId === 'PR-1-1' ? pr() : null),
    recordPullRequest: async (facts) => { calls.push(['record', facts]); recorded = facts.sha; return { item: pr() }; },
    pullRequests: async () => [pr()],
    canMerge: async ({ actor }) => { calls.push(['canMerge', actor.id]); return { item: pr(), given: [{ type: 'build-approval', by: 'lerato-m' }, { type: 'test-approval', by: 'lerato-m', for: 'naledi-k' }] }; },
    pullRequestMerged: async (input) => { calls.push(['merged', input.sha]); return { item: { ...pr(), status: 'completed' } }; },
  };
  const names = { 'lerato-m': 'Lerato M.', 'naledi-k': 'Naledi K.' };
  const host = { service: (name) => (name === 'workflows' ? workflows : null), people: { get: async (id) => (names[id] ? { id, name: names[id] } : null) } };
  const bridge = createBridge({ store, env, host, log: { info() {}, warn() {} } });
  return { env, store, repo, sha, base, runId, calls, bridge };
}

test('a delivered run for a story is recorded with its commit, checks and evidence; one for anything else is not', async () => {
  const { store, sha, runId, calls, bridge } = setUp();
  await bridge.record(store.get('runs', runId));
  const [[, facts]] = calls;
  assert.deepEqual([facts.itemId, facts.runId, facts.workItemId, facts.repo, facts.head, facts.sha, facts.forge, facts.draft, facts.gates, facts.evidence.text, facts.href],
    ['STORY-1', runId, 'WI-STORY-1-1', 'web-storefront', HEAD, sha, 'local', false, 'passed', '1 of 1 required tests present, all passing', `/factory/runs/${runId}`]);
  const other = setUp({ type: 'spec' });
  assert.equal(await other.bridge.record(other.store.get('runs', other.runId)), null);
});

test('changes asked for send the run back to repair with the person\'s words, once per decision', async () => {
  const { store, runId, bridge } = setUp();
  const payload = { itemType: 'pr', type: 'build-approval', outcome: 'changes-requested', itemId: 'PR-1-1', approvalId: 'apr_1', by: 'lerato-m', reason: 'TC-1-1-2 is missing' };
  assert.equal(await bridge.onDecided(payload), runId);
  const run = store.get('runs', runId);
  assert.equal(run.status, 'queued');
  assert.equal(run.humanReview.body, 'Lerato M. asked for changes at the Build approval: TC-1-1-2 is missing');
  assert.equal(store.read({ stream: `run:${runId}`, types: ['run.rewound'] }).at(-1).data.from, 'repair');
  await bridge.onDecided(payload);
  assert.equal(store.read({ stream: `run:${runId}`, types: ['pr.changes_requested'] }).length, 1, 'once');
  assert.equal(await bridge.onDecided({ ...payload, outcome: 'approved' }), null);
});

test('a commit pushed to the branch is recorded at once (being checked) and the run checks it again from verify', async () => {
  const { store, repo, sha, runId, calls, bridge } = setUp();
  assert.deepEqual(await bridge.syncPushes(), [], 'nothing moved');
  gitIn(repo, 'checkout', '-q', HEAD);
  const pushed = commitFiles(repo, { 'README.md': '# demo, by a person\n' }, 'a person\'s commit');
  gitIn(repo, 'checkout', '-q', 'main');
  assert.deepEqual(await bridge.syncPushes(), [pushed]);
  const [, facts] = calls.at(-1);
  assert.deepEqual([facts.sha, facts.checking, facts.gates, facts.why], [pushed, true, 'none', `a commit (${pushed.slice(0, 7)}) was pushed to ${HEAD}`]);
  const run = store.get('runs', runId);
  assert.equal(run.status, 'queued');
  assert.deepEqual(run.repairs.map((r) => [r.trigger, r.sha]), [['push', pushed]]);
  assert.equal(run.steps.verify.status, 'pending');
  assert.notEqual(pushed, sha);
});

test('a person merges after the lifecycle says yes, on the local forge, named as the author; a Bitbucket pull request is refused', async () => {
  const { store, repo, runId, calls, bridge } = setUp();
  const out = await bridge.merge('PR-1-1', { id: 'lerato-m', name: 'Lerato M.' });
  assert.match(out.text, /^web-storefront PR-1-1 is merged into main \([0-9a-f]{7}\)\.$/);
  assert.ok(fs.existsSync(path.join(repo, 'test', 'a.test.js')));
  assert.match(gitIn(repo, 'log', '-1', '--format=%an|%B'), /^Lerato M\.\|Merge factory\/issue-1\/main: See the stores\n\nMerged by Lerato M\. in NooblyJS \(web-storefront PR-1-1\), after the Build approval by Lerato M\. and the Test approval by Lerato M\. for Naledi K\./);
  assert.equal(store.get('runs', runId).status, 'merged');
  assert.deepEqual(calls.map(([k]) => k), ['canMerge', 'merged']);
  const bb = setUp({ forge: 'bitbucket' });
  await assert.rejects(bb.bridge.merge('PR-1-1', { id: 'lerato-m', name: 'Lerato M.' }), (err) => err.code === 'merge_in_bitbucket');
});
