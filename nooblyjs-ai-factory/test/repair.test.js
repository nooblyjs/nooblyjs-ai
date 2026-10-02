// Phase F13: repair loops: failures fed back to a fixer, bounded, with loop detection.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMockProvider } from '../src/harness.js';
import { openEntries } from '../src/humans/inbox.js';
import { retryRun, runJob } from '../src/job/run-job.js';
import { openStore } from '../src/store/events.js';
import { approve, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const read = (file) => ({ name: 'Read', input: { file_path: file } });
const triage = () => createMockProvider([{ text: '```json\n{"kind":"bug","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"one function"}\n```' }]);
// "fast": false keeps the check out of the builder's Stop hook (F04), like a slow suite would be,
// so the bug gets PAST the builder and the repair loop has something to do.
const GATED = { '.factory/config.json': JSON.stringify({ gates: { test: { command: 'node test.js', fast: false } } }), 'test.js': "import { half } from './half.js';\nif (half(4) !== 2) { console.error(`expected half(4) to be 2, got ${half(4)}`); process.exit(1); }\n", 'package.json': '{"type":"module"}' };
function issueFile() {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, '---\ntitle: Add half()\n---\nhalf(n) returns n / 2.\n');
  return file;
}
const buggyBuilder = () => createMockProvider([{ text: 'Writing half.', tools: [write('half.js', 'export const half = (n) => n * 2;\n')] }, { text: 'Done, all good.' }]);
/** A fixer that reads, then writes these files. */
const fixer = (files) => createMockProvider([{ text: 'Reading.', tools: Object.keys(files).filter((f) => f !== 'extra.md').map(read) }, { text: 'Fixing.', tools: Object.entries(files).map(([f, c]) => write(f, c)) }, { text: 'Fixed the cause.' }]);
const logsOf = () => {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
};

test('FAIL → FIX → PASS: the check fails, the fixer gets the failure, the checks run again, the PR is ready', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo(GATED);
  const fix = fixer({ 'half.js': 'export const half = (n) => n / 2;\n' });
  const review = await approve();
  const out = await runJob({ issueFile: issueFile(), repo, allowUnsandboxed: true, providers: { triage: triage(), build: buggyBuilder(), 'fix#1': fix, review } }, { env, store });
  assert.equal(out.status, 'delivered');
  assert.match(JSON.stringify(fix.requests[0].messages), /checks FAILED[\s\S]*expected half\(4\) to be 2, got 8/, 'the fixer saw the exact failure');
  assert.equal(gitIn(repo, 'show', 'factory/issue-1/main:half.js'), 'export const half = (n) => n / 2;');
  assert.deepEqual(gitIn(repo, 'log', '--topo-order', '--format=%s', 'main..factory/issue-1/main').split('\n'), ['Fix (repair 1): check "test" failed', 'Add half()'], 'the history keeps what happened');
  const run = store.get('runs', out.runId);
  assert.deepEqual(run.repairs.map((r) => [r.attempt, r.trigger, r.outcome]), [[1, 'gates', 'success']]);
  assert.equal(run.steps.verify.result.passed, true, 'verify ran AGAIN, on the fix');
  assert.equal(review.requests.length, 1, 'review ran once: on the fixed code (it was skipped while the checks failed)');
  assert.match(fs.readFileSync(/** @type {string} */ (out.pr?.path), 'utf8'), /## Repairs[\s\S]*\| 1 \| checks: check "test" failed \| fixed in `/);
});

test('a BLOCKING review finding is fixed, then re-reviewed', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ 'package.json': '{"type":"module"}' });
  const build = createMockProvider([{ text: 'x', tools: [write('half.js', 'export const half = (n) => n >> 1;\n')] }, { text: 'Done.' }]);
  const review = createMockProvider([
    { text: '```json\n' + JSON.stringify({ verdict: 'changes_requested', summary: 'Wrong for odd numbers.', findings: [{ severity: 'blocking', file: 'half.js', line: 1, rationale: 'n >> 1 truncates: half(3) is 1, not 1.5', suggestion: 'use n / 2' }] }) + '\n```' },
    { text: '```json\n{"verdict":"approve","summary":"Fixed.","findings":[]}\n```' },
  ]);
  const fix = fixer({ 'half.js': 'export const half = (n) => n / 2;\n' });
  const out = await runJob({ issueFile: issueFile(), repo, providers: { triage: triage(), build, review, 'fix#1': fix } }, { env, store });
  assert.equal(out.status, 'delivered');
  assert.match(JSON.stringify(fix.requests[0].messages), /1 BLOCKING problem[\s\S]*n >> 1 truncates[\s\S]*Suggested: use n \/ 2/);
  assert.equal(review.requests.length, 2, 'reviewed, fixed, reviewed again');
});

test('LOOP DETECTION: the same failure after a repair escalates at once (no second paid attempt)', async () => {
  const env = testEnv({ repairAttempts: 5 });
  const store = openStore({ env });
  const repo = makeRepo(GATED);
  const useless = fixer({ 'half.js': 'export const half = (n) => n * 2; // looked at it\n' });
  const second = createMockProvider([]);
  const out = await runJob({ issueFile: issueFile(), repo, allowUnsandboxed: true, providers: { triage: triage(), build: buggyBuilder(), 'fix#1': useless, 'fix#2': second, review: await approve() } }, { env, store });
  assert.equal(out.status, 'gate_failed');
  assert.equal(second.requests.length, 0, 'no second attempt at the same thing');
  assert.match(out.run.steps.repair.result.reason, /the same failure came back after repair 1/);
  const [esc] = openEntries(store);
  assert.equal(esc.kind, 'escalation');
  const pr = fs.readFileSync(/** @type {string} */ (out.pr?.path), 'utf8');
  assert.match(pr, /status: draft/);
  assert.match(pr, /Escalated:\*\* the same failure came back/);
});

test('the LIMIT: after repairAttempts different failures, a person is asked', async () => {
  const env = testEnv({ repairAttempts: 1 });
  const store = openStore({ env });
  // The fix makes the test pass… by breaking something else a second gate checks.
  const repo = makeRepo({ ...GATED, '.factory/config.json': JSON.stringify({ gates: { test: { command: 'node test.js', fast: false }, size: { command: 'test $(wc -c < half.js) -lt 60', fast: false } } }) });
  const fix = fixer({ 'half.js': 'export const half = (n) => n / 2; // a very very very long comment that makes it too big\n' });
  const out = await runJob({ issueFile: issueFile(), repo, allowUnsandboxed: true, providers: { triage: triage(), build: buggyBuilder(), 'fix#1': fix, review: await approve() } }, { env, store });
  assert.equal(out.status, 'gate_failed');
  assert.match(out.run.steps.repair.result.reason, /already tried 1 repair/);
  assert.match(out.run.steps.verify.result.gates.results.find((g) => g.name === 'size').status, /failed/);
});

test('a fixer that changes nothing escalates; the PR is a draft that says so', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const idle = createMockProvider([{ text: 'I think the code is fine actually.' }]);
  const out = await runJob({ issueFile: issueFile(), repo: makeRepo(GATED), allowUnsandboxed: true, providers: { triage: triage(), build: buggyBuilder(), 'fix#1': idle, review: await approve() } }, { env, store });
  assert.equal(out.status, 'gate_failed');
  assert.match(out.run.steps.repair.result.reason, /the fixer changed nothing/);
});

test('a NEW build forgets the old build\'s repairs', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo(GATED);
  const first = await runJob({ issueFile: issueFile(), repo, allowUnsandboxed: true, providers: { triage: triage(), build: buggyBuilder(), 'fix#1': fixer({ 'half.js': 'export const half = (n) => n / 2;\n' }), review: await approve() } }, { env, store });
  assert.equal(store.get('runs', first.runId).repairs.length, 1);
  const good = createMockProvider([{ text: 'x', tools: [write('half.js', 'export const half = (n) => n / 2;\n')] }, { text: 'Done.' }]);
  const again = await retryRun(store, first.runId, { from: 'build', live: { providers: { build: good, review: await approve() } } });
  assert.equal(again.status, 'delivered');
  assert.deepEqual(store.get('runs', first.runId).repairs, [], 'the old repairs were fixes to the old build');
});
