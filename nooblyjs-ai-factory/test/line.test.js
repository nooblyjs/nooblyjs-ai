// Phase F07: the line engine and its stations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createLocalForge } from '../src/forge/local.js';
import { createMockProvider } from '../src/harness.js';
import { retryRun, runJob, executeRun, submitJob } from '../src/job/run-job.js';
import { compileCondition } from '../src/line/conditions.js';
import { decide } from '../src/line/engine.js';
import { KINDS } from '../src/line/executor.js';
import { loadLine, parseLine } from '../src/line/line.js';
import { parseTriage } from '../src/line/stations/triage.js';
import { pauseRun, resumeRun } from '../src/scheduler/kill-switch.js';
import { openStore } from '../src/store/events.js';
import { approve, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

// ---- conditions ---------------------------------------------------------------------------------

test('conditions: comparisons, && || !, parentheses, missing = null', () => {
  const ctx = { triage: { size: 'small', kind: 'bug' }, tasks: { count: 3 } };
  const cases = [
    ["triage.size == 'small'", true],
    ["triage.kind != 'question' && tasks.count > 1", true],
    ["!(triage.size == 'large') && (tasks.count >= 4 || true)", true],
    ['nothing.here == null', true],
    ['nothing.here', false],
    ["triage.size == 'large' || tasks.count < 3", false],
  ];
  for (const [text, want] of cases) assert.equal(compileCondition(text)(ctx), want, text);
});

test('conditions: config is never code; mistakes say where they are', () => {
  assert.throws(() => compileCondition("require('fs')"), /position 7/);
  assert.throws(() => compileCondition("process.exit(1)"), /position/);
  assert.throws(() => compileCondition('triage.size =='), /expected a value at the end/);
  assert.throws(() => compileCondition('a ; b'), /Cannot read/);
});

// ---- lines --------------------------------------------------------------------------------------

test('lines: the built-in ones load; a broken line lists every problem at load time', () => {
  assert.deepEqual(loadLine('default', KINDS()).stations.map((s) => s.id), ['triage', 'spec', 'approve', 'build', 'verify', 'review', 'security', 'repair', 'deliver', 'merge'], 'F08 spec, F11 reviews, F12 approve + merge, F13 repair');
  assert.deepEqual(loadLine('quick', KINDS()).stations.map((s) => s.id), ['build', 'verify', 'deliver']);
  assert.throws(
    () => parseLine({ name: 'x', stations: [{ id: 'a', kind: 'build' }, { id: 'a', kind: 'teleport' }, { id: 'c', kind: 'verify', when: 'x ==' }] }, KINDS()),
    (e) => /used twice/.test(e.message) && /unknown kind "teleport"/.test(e.message) && /expected a value/.test(e.message),
  );
  assert.throws(() => loadLine('nope', KINDS()), /No line "nope". Built in: default, quick/);
});

// ---- the engine, as tables: steps so far → next action -------------------------------------------

const line = parseLine(
  { name: 't', stations: [{ id: 'triage', kind: 'triage', retries: 1 }, { id: 'build', kind: 'build' }, { id: 'verify', kind: 'verify', when: "build.agent.outcome == 'success'" }, { id: 'deliver', kind: 'deliver', retries: 2 }] },
  KINDS(),
);
const done = (result = {}) => ({ status: 'done', result });
const next = (steps, extra = {}) => {
  const d = decide({ steps, attempt: 1, ...extra }, line);
  return d.action === 'run' ? `run ${d.station.id}` : d.action === 'finish' ? `finish ${d.status}` : d.action;
};

test('engine: the happy path, one station at a time', () => {
  const ok = { agent: { outcome: 'success' } };
  assert.equal(next({}), 'run triage');
  assert.equal(next({ triage: done() }), 'run build');
  assert.equal(next({ triage: done(), build: done(ok) }), 'run verify');
  assert.equal(next({ triage: done(), build: done(ok), verify: done() }), 'run deliver');
  assert.equal(next({ triage: done(), build: done(ok), verify: done(), deliver: done({ status: 'delivered' }) }), 'finish delivered');
});

test('engine: a stop ends the run with its status; a considered "no" is not retried', () => {
  assert.equal(next({ triage: done({ stop: { status: 'needs_info' } }) }), 'finish needs_info');
  assert.equal(next({ triage: done(), build: done({ stop: { status: 'no_changes' } }) }), 'finish no_changes');
});

test('engine: `when` skips a station (verify after a builder that did not finish)', () => {
  assert.equal(next({ triage: done(), build: done({ agent: { outcome: 'max_turns' } }) }), 'run deliver');
});

test('engine: failures are retried up to the station\'s policy, then the run ends in error', () => {
  const failed = (n) => ({ status: 'failed', failures: n, error: 'boom' });
  assert.equal(next({ triage: failed(1) }), 'run triage', 'retries: 1 → one more try');
  assert.equal(next({ triage: failed(2) }), 'finish error');
  assert.equal(next({ triage: done(), build: failed(1) }), 'finish error', 'build has no retries');
});

test('engine: a station left "running" (its worker died) is run again; pause wins over everything', () => {
  assert.equal(next({ triage: done(), build: { status: 'running' } }), 'run build');
  assert.equal(next({}, { pauseRequested: true }), 'pause');
});

// ---- stations, end to end -----------------------------------------------------------------------

const triageSays = (answer) => createMockProvider([{ text: `Looked.\n\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\`` }]);
const CLEAR = { kind: 'feature', size: 'small', clear: true, outOfScope: false, questions: [], reason: 'one file' };
const writeGreeting = { text: 'Adding it.', tools: [{ name: 'Write', input: { file_path: 'GREETING.md', content: 'Hello!\n' } }] };
function issueFile(text = '---\ntitle: Add a greeting\n---\nPlease add GREETING.md.\n') {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, text);
  return file;
}

test('the default line end to end: triage → build → verify → deliver, each a step in the log', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ '.factory/config.json': JSON.stringify({ gates: { greeting: 'grep -q Hello GREETING.md' } }) });
  const out = await runJob(
    { issueFile: issueFile(), repo, allowUnsandboxed: true, providers: { review: await approve(), triage: triageSays(CLEAR), build: createMockProvider([writeGreeting, { text: 'Done.' }]) } },
    { env, store },
  );
  assert.equal(out.status, 'delivered');
  assert.equal(out.triage.size, 'small');
  const steps = store.read({ stream: `run:${out.runId}`, types: ['step.finished'] }).map((e) => e.data.step);
  assert.deepEqual(steps, ['triage', 'approve', 'build', 'verify', 'review', 'deliver'], 'no security review (nothing sensitive), approve is automatic (a small item has no spec), no merge (not L3)');
  assert.equal(out.run.steps.verify.result.passed, true);
});

test('TRIAGE: a vague issue ends "needs_info", its questions go on the issue, and nothing is built', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const build = createMockProvider([writeGreeting]);
  const unclear = { kind: 'feature', size: 'medium', clear: false, outOfScope: false, questions: ['Better in what way?', 'How will we know?'], reason: 'No behaviour is named.' };
  const out = await runJob({ issueFile: issueFile('---\ntitle: Make it better\n---\nImprove it.\n'), repo: makeRepo(), providers: { review: await approve(), triage: triageSays(unclear), build } }, { env, store });
  assert.equal(out.status, 'needs_info');
  assert.equal(build.requests.length, 0, 'the builder was never paid for');
  const comments = createLocalForge({ env }).comments(out.run.itemId.split('#')[0], 1);
  assert.match(comments, /- Better in what way\?\n- How will we know\?/);
});

test('TRIAGE: out of scope → rejected, with the reason on the issue', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const out = await runJob({ issueFile: issueFile('---\ntitle: What is your favourite colour?\n---\n?\n'), repo: makeRepo(), providers: { review: await approve(), triage: triageSays({ ...CLEAR, outOfScope: true, reason: 'A question for a person.' }) } }, { env, store });
  assert.equal(out.status, 'rejected');
  assert.match(createLocalForge({ env }).comments(out.run.itemId.split('#')[0], 1), /A question for a person/);
});

test('TRIAGE: an answer that is not valid is a FAILURE (retried), never a guess', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const triage = createMockProvider([{ text: 'I think it is fine!' }, { text: '```json\n{"kind":"feature","size":"huge","clear":true}\n```' }]);
  await assert.rejects(runJob({ issueFile: issueFile(), repo: makeRepo(), providers: { triage } }, { env, store }), /size must be one of small\/medium\/large/);
  const failures = store.read({ types: ['step.failed'] }).map((e) => e.data.error);
  assert.deepEqual(failures.map((f) => f.split(':')[0]), ['triage answer is not JSON', 'triage answer is invalid']);
  assert.throws(() => parseTriage('{"kind":"bug","size":"small","clear":false,"questions":[]}'), /needs at least one question/);
});

test('VERIFY runs on a CLEAN CHECKOUT of the commit: a passing check that depended on an ignored file now fails', async () => {
  const env = testEnv();
  const store = openStore({ env });
  // local.txt is git-ignored: it exists in the builder's workspace, but not in the commit.
  const repo = makeRepo({ '.gitignore': 'local.txt\n', '.factory/config.json': JSON.stringify({ gates: { needs_local: 'test -f local.txt' } }) });
  const sneaky = createMockProvider([
    { text: 'Writing.', tools: [{ name: 'Write', input: { file_path: 'GREETING.md', content: 'Hi\n' } }, { name: 'Write', input: { file_path: 'local.txt', content: 'only on my disk\n' } }] },
    { text: 'All checks pass on my machine.' },
  ]);
  const out = await runJob({ line: 'quick', issueFile: issueFile(), repo, allowUnsandboxed: true, agent: { provider: sneaky } }, { env, store });
  assert.equal(out.status, 'gate_failed', 'it passed in the builder\'s workspace (the Stop hook was happy), but not on the commit');
});

test('costs add up across stations into the run (and so into the daily budget)', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const priced = (replies) => createMockProvider(replies.map((r) => ({ ...r, usage: { input_tokens: 100_000, output_tokens: 1000 } })));
  const out = await runJob(
    { issueFile: issueFile(), repo: makeRepo(), agent: { model: 'claude-sonnet-5-5' }, providers: { review: await approve(), triage: priced([{ text: `\`\`\`json\n${JSON.stringify(CLEAR)}\n\`\`\`` }]), build: priced([writeGreeting, { text: 'Done.' }]) } },
    { env, store },
  );
  const { triage, build } = out.run.steps;
  assert.ok(triage.result.costUsd > 0 && build.result.costUsd > 0);
  const sum = Object.values(out.run.steps).reduce((n, st) => n + (st.result?.costUsd ?? 0), 0);
  assert.ok(Math.abs(out.run.costUsd - sum) < 1e-9, 'the run costs what its stations cost (triage, build, and since F11 the reviewer)');
});

test('RETRY --from: redo the build, keeping triage; a new commit updates the same PR', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo();
  const triage = triageSays(CLEAR);
  const first = await runJob({ issueFile: issueFile(), repo, providers: { triage, build: createMockProvider([writeGreeting, { text: 'v1' }]), review: await approve() } }, { env, store });
  const v2 = { text: 'Again.', tools: [{ name: 'Write', input: { file_path: 'GREETING.md', content: 'Hello, v2!\n' } }] };
  const again = await retryRun(store, first.runId, { from: 'build', live: { providers: { build: createMockProvider([v2, { text: 'v2' }]), review: await approve() } } });
  assert.equal(again.status, 'delivered');
  assert.equal(triage.requests.length, 1, 'triage was kept, not asked again');
  assert.equal(gitIn(repo, 'show', 'factory/issue-1/main:GREETING.md'), 'Hello, v2!');
  assert.equal(createLocalForge({ env }).listPRs(first.run.itemId.split('#')[0]).length, 1);
  await assert.rejects(retryRun(store, first.runId, { from: 'teleport' }), /no station "teleport"/);
});

test('PAUSE between stations: the run stops after triage, and resume carries on from build', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const runId = submitJob(store, { issueFile: issueFile(), repo: makeRepo() });
  store.append(`run:${runId}`, 'run.leased', { runId, worker: 'test', pid: process.pid, host: 'h', attempt: 1 });
  const triage = createMockProvider([{ text: `\`\`\`json\n${JSON.stringify(CLEAR)}\n\`\`\``, onChunk: () => pauseRun(store, runId) }]);
  const build = createMockProvider([writeGreeting, { text: 'Done.' }]);
  const paused = await executeRun(store, runId, { live: { providers: { triage, build, review: await approve() } } });
  assert.equal(paused.status, 'paused');
  assert.equal(store.get('runs', runId).steps.triage.status, 'done', 'the station it was on finished');
  assert.equal(build.requests.length, 0);
  resumeRun(store, runId);
  assert.equal(store.get('runs', runId).status, 'queued');
  store.append(`run:${runId}`, 'run.leased', { runId, worker: 'test', pid: process.pid, host: 'h', attempt: 2 });
  const out = await executeRun(store, runId, { live: { providers: { triage, build, review: await approve() } } });
  assert.equal(out.status, 'delivered');
  assert.equal(triage.requests.length, 1);
});
