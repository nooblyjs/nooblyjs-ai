// Phase F15: the GitHub forge, against a fake GitHub (test/fixtures/fake-github.js).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { commandsFor } from './fixtures/github-helpers.js';
import { startFakeGitHub } from './fixtures/fake-github.js';
import { createGitHubClient } from '../src/forge/github/client.js';
import { createGitHubForge } from '../src/forge/github/forge.js';
import { parseWebhook, verifySignature } from '../src/forge/github/webhooks.js';
import { createWebhookServer } from '../src/server/webhooks.js';
import { pollIssues } from '../src/commands/github.js';
import { createMockProvider } from '../src/harness.js';
import { executeRun } from '../src/job/run-job.js';
import { openStore } from '../src/store/events.js';
import { approve, gitIn, makeRepo, testEnv } from './helpers.js';

const settings = { label: 'factory', allowedUsers: ['sam'] };
const sign = (secret, body) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

// ---- the client ---------------------------------------------------------------------------------

test('client: rate limited → waits for the reset, then succeeds; too long a wait → a clear error', async () => {
  const gh = await startFakeGitHub();
  try {
    gh.addIssue(1, 'x', 'y');
    const waits = [];
    const client = createGitHubClient({ token: gh.token, apiUrl: gh.url, sleep: async (ms) => waits.push(ms) });
    gh.state.rateLimited = 1;
    assert.equal((await client.request('GET', '/repos/acme/calc/issues/1')).title, 'x');
    assert.equal(waits.length, 1);
    assert.ok(waits[0] > 1000 && waits[0] < 5000, `waited for the reset (${waits[0]}ms)`);
    const impatient = createGitHubClient({ token: gh.token, apiUrl: gh.url, sleep: async () => {}, maxWaitMs: 100 });
    gh.state.rateLimited = 1;
    await assert.rejects(impatient.request('GET', '/repos/acme/calc/issues/1'), /rate limit: next request allowed in \ds/);
    await assert.rejects(client.request('GET', '/repos/acme/calc/issues/99'), /→ 404: Not Found/);
    const wrong = createGitHubClient({ token: 'nope', apiUrl: gh.url });
    await assert.rejects(wrong.request('GET', '/repos/acme/calc/issues/1'), /401: Bad credentials/);
  } finally {
    await gh.close();
  }
});

// ---- webhooks -----------------------------------------------------------------------------------

test('signatures: only a body signed with our secret is GitHub; parse only what the factory acts on', () => {
  const body = Buffer.from('{"a":1}');
  assert.equal(verifySignature('s3cret', body, sign('s3cret', body)), true);
  assert.equal(verifySignature('s3cret', body, sign('guess', body)), false, 'forged');
  assert.equal(verifySignature('s3cret', Buffer.from('{"a":2}'), sign('s3cret', body)), false, 'tampered body');
  assert.equal(verifySignature('s3cret', body, undefined), false, 'unsigned');

  const repository = { name: 'calc', owner: { login: 'acme' }, clone_url: 'https://github.com/acme/calc.git' };
  const issue = { number: 3, title: 'Add half', body: 'please', labels: [{ name: 'factory' }] };
  assert.equal(parseWebhook('issues', { action: 'labeled', label: { name: 'factory' }, issue, repository }, settings)?.type, 'submit');
  assert.equal(parseWebhook('issues', { action: 'labeled', label: { name: 'bug' }, issue, repository }, settings), null);
  const pr = { head: { ref: 'factory/issue-3/main' }, merged: true, merge_commit_sha: 'abc' };
  assert.equal(parseWebhook('pull_request', { action: 'closed', pull_request: pr, repository }, settings)?.type, 'merged');
  assert.equal(parseWebhook('pull_request', { action: 'closed', pull_request: { ...pr, head: { ref: 'feature/x' } }, repository }, settings), null, "not the factory's PR");
  const review = (by) => ({ action: 'submitted', review: { state: 'changes_requested', body: 'use n / 2', user: { login: by } }, pull_request: pr, repository });
  assert.equal(parseWebhook('pull_request_review', review('sam'), settings)?.type, 'changes_requested');
  assert.deepEqual(parseWebhook('pull_request_review', review('mallory'), settings), { type: 'ignored', reason: 'mallory is not in github.allowedUsers' });
});

// ---- the forge ----------------------------------------------------------------------------------

test('forge: one PR per head (created, then updated); draft → ready takes GraphQL; comments once per key', async () => {
  const gh = await startFakeGitHub();
  try {
    gh.addIssue(3, 'Add half', 'please');
    const forge = createGitHubForge({ client: createGitHubClient({ token: gh.token, apiUrl: gh.url }), owner: 'acme', name: 'calc' });
    const pr = { title: 'Add half', head: 'factory/issue-3/main', base: 'main', body: 'v1', meta: { run: 'run-1', sha: 'aaa' } };
    assert.equal((await forge.openOrUpdatePR('', { ...pr, status: /** @type {const} */ ('draft') })).action, 'created');
    assert.equal(gh.state.pulls[0].draft, true);
    const again = await forge.openOrUpdatePR('', { ...pr, body: 'v2', status: /** @type {const} */ ('ready'), meta: { run: 'run-1', sha: 'bbb' } });
    assert.equal(again.action, 'updated');
    assert.equal(gh.state.pulls.length, 1, 'the same PR');
    assert.equal(gh.state.pulls[0].draft, false, 'ready, through GraphQL');
    assert.match(gh.state.graphql[0].query, /markPullRequestReadyForReview/);
    assert.equal((await forge.findPR('', 'factory/issue-3/main'))?.sha, 'bbb', 'the run marker lets a retried delivery recognise it');
    await forge.comment('', 3, 'Questions…', { key: 'run-1:triage' });
    await forge.comment('', 3, 'Questions…', { key: 'run-1:triage' });
    assert.equal(gh.state.comments.get(3).length, 1, 'a retry does not double-post');
  } finally {
    await gh.close();
  }
});

// ---- end to end ---------------------------------------------------------------------------------

const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const read = (file) => ({ name: 'Read', input: { file_path: file } });

test('END TO END: a labelled issue (signed webhook) → a run → a GitHub PR + status; changes requested → the fixer → the PR is updated; merged', async () => {
  const gh = await startFakeGitHub();
  const secret = 'hook-secret';
  const env = { ...testEnv({ github: { apiUrl: gh.url } }), GITHUB_TOKEN: gh.token };
  const store = openStore({ env });
  const repo = makeRepo({ 'package.json': '{"type":"module"}' }); // stands in for github.com/acme/calc (the clone source)
  const server = createWebhookServer({ store, secret, settings: { ...settings, apiUrl: gh.url }, repoPath: () => repo });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const hook = commandsFor(server, secret);
  try {
    gh.addIssue(3, 'Add half', 'half(n) returns n / 2.');
    // 1. The issue is labelled: the webhook queues a run (and a redelivery doesn't queue another).
    const payload = { action: 'labeled', label: { name: 'factory' }, issue: gh.state.issues.get(3), repository: { name: 'calc', owner: { login: 'acme' }, clone_url: 'https://github.com/acme/calc.git' }, sender: { login: 'sam' } };
    const first = await hook('issues', payload, 'delivery-1');
    assert.equal(first.status, 202);
    assert.equal((await hook('issues', payload, 'delivery-1')).body.reason, 'already handled (a redelivery)');
    assert.equal((await hook('issues', payload, 'delivery-1', 'wrong-secret')).status, 401);
    const runId = first.body.runId;

    // 2. The run: its forge is GitHub (from the request), the code goes to the repo, the PR to GitHub.
    const triage = createMockProvider([{ text: '```json\n{"kind":"feature","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"one function"}\n```' }]);
    const build = createMockProvider([{ text: 'x', tools: [write('half.js', 'export const half = (n) => n >> 1;\n')] }, { text: 'Done.' }]);
    const out = await executeRun(store, runId, { live: { providers: { triage, build, review: await approve() } } });
    assert.equal(out.status, 'delivered');
    assert.equal(gh.state.pulls.length, 1);
    assert.equal(gh.state.pulls[0].head.ref, 'factory/issue-3/main');
    assert.match(gh.state.pulls[0].body, /Resolves acme\/calc#3[\s\S]*## At a glance/, 'the evidence bundle is the PR body');
    assert.equal(gitIn(repo, 'show', 'factory/issue-3/main:half.js'), 'export const half = (n) => n >> 1;', 'pushed by the control plane');
    assert.deepEqual(gh.state.statuses.map((s) => [s.context, s.state]), [['factory', 'success']]);

    // 3. A person requests changes on the PR: the run goes back to the fixer, with their words.
    const review = { action: 'submitted', review: { state: 'changes_requested', body: 'n >> 1 truncates odd numbers: use n / 2', user: { login: 'sam' } }, pull_request: { head: { ref: 'factory/issue-3/main' } }, repository: payload.repository };
    assert.equal((await hook('pull_request_review', review, 'delivery-2')).body.handled, true);
    assert.equal(store.get('runs', runId).status, 'queued');
    const fix = createMockProvider([{ text: 'Reading.', tools: [read('half.js')] }, { text: 'x', tools: [write('half.js', 'export const half = (n) => n / 2;\n')] }, { text: 'Used n / 2, as the reviewer asked.' }]);
    store.append(`run:${runId}`, 'run.leased', { runId, worker: 'test', pid: process.pid, host: 'h', attempt: 2 });
    const again = await executeRun(store, runId, { live: { providers: { 'fix#1': fix, review: await approve() } } });
    assert.equal(again.status, 'delivered');
    assert.match(JSON.stringify(fix.requests[0].messages), /REQUESTED CHANGES \(sam\)[\s\S]*n >> 1 truncates odd numbers/);
    assert.equal(gh.state.pulls.length, 1, 'the same PR, updated');
    assert.match(gh.state.pulls[0].body, /## Repairs[\s\S]*changes requested by sam/);
    assert.equal(gitIn(repo, 'show', 'factory/issue-3/main:half.js'), 'export const half = (n) => n / 2;');

    // 4. Merged on GitHub: the run is merged.
    const merged = { action: 'closed', pull_request: { head: { ref: 'factory/issue-3/main' }, merged: true, merge_commit_sha: 'abc123' }, repository: payload.repository, sender: { login: 'sam' } };
    await hook('pull_request', merged, 'delivery-3');
    assert.equal(store.get('runs', runId).status, 'merged');
  } finally {
    server.close();
    await gh.close();
  }
});

test('POLL (no public URL): open labelled issues become queued runs, once', async () => {
  const gh = await startFakeGitHub();
  try {
    gh.addIssue(1, 'One', 'a');
    gh.addIssue(2, 'Two', 'b', ['bug']);
    const store = openStore({ env: testEnv() });
    const client = createGitHubClient({ token: gh.token, apiUrl: gh.url });
    const first = await pollIssues(store, client, { owner: 'acme', name: 'calc', label: 'factory', clone: '/tmp/x' });
    assert.deepEqual(first.map((q) => q.ref), ['acme/calc#1']);
    assert.deepEqual(await pollIssues(store, client, { owner: 'acme', name: 'calc', label: 'factory', clone: '/tmp/x' }), [], 'seen before');
  } finally {
    await gh.close();
  }
});
