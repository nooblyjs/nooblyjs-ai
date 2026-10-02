// Phase F05: the event store: append-only, projections, idempotency, effects, recovery.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { snapshot } from '../src/commands/history.js';
import { createLocalForge } from '../src/forge/local.js';
import { createMockProvider } from '../src/harness.js';
import { retryRun, runJob } from '../src/job/run-job.js';
import { getArtifact, putArtifact } from '../src/store/artifacts.js';
import { performEffect } from '../src/store/effects.js';
import { openStore } from '../src/store/events.js';
import { runs as runsProjection } from '../src/store/projections.js';
import { recoverRuns } from '../src/store/recovery.js';
import { listWorkspaces } from '../src/exec/workspace/worktree.js';
import { gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

const newStore = (env = testEnv()) => openStore({ env });

test('append and read: ordered, per stream; listeners hear only committed events', () => {
  const store = newStore();
  const heard = [];
  store.subscribe((e) => heard.push(e.type));
  store.append('run:a', 'x.one', { n: 1 });
  store.append('run:b', 'x.two', { n: 2 });
  store.append('run:a', 'x.three', { n: 3 });
  assert.deepEqual(store.read().map((e) => e.type), ['x.one', 'x.two', 'x.three']);
  assert.deepEqual(store.read({ stream: 'run:a' }).map((e) => e.data.n), [1, 3]);
  assert.deepEqual(store.read({ after: store.read()[1].seq }).map((e) => e.data.n), [3]);
  assert.deepEqual(heard, ['x.one', 'x.two', 'x.three']);
});

test('an idempotency key makes the second append a no-op', () => {
  const store = newStore();
  assert.ok(store.append('s', 't', { v: 1 }, { key: 'once' }));
  assert.equal(store.append('s', 't', { v: 2 }, { key: 'once' }), null);
  assert.deepEqual(store.read().map((e) => e.data.v), [1]);
  assert.ok(store.hasKey('once'));
});

test('a transaction is all or nothing: an error after an append leaves no trace, and nobody heard of it', () => {
  const store = newStore();
  const heard = [];
  store.subscribe((e) => heard.push(e.type));
  assert.throws(() =>
    store.transaction(() => {
      store.append('run:r', 'run.started', { runId: 'r', itemId: 'i', title: 't', pid: 1, request: {} });
      throw new Error('crash inside the transaction');
    }),
  );
  assert.equal(store.read().length, 0);
  assert.equal(store.get('runs', 'r'), null, 'nor in the projection');
  assert.deepEqual(heard, [], 'listeners never heard of the rolled-back event');

  store.transaction(() => {
    store.append('s', 'a', {});
    store.append('s', 'b', {});
    assert.deepEqual(heard, [], 'not yet: the transaction has not committed');
  });
  assert.deepEqual(heard, ['a', 'b']);
});

test('the runs reducer, as a table: events in, state out (pure: no database needed)', () => {
  const ev = (type, data) => ({ seq: 0, stream: 'run:r', type, data: { runId: 'r', ...data }, at: 'T', key: null });
  const cases = [
    [[ev('run.started', { itemId: 'i', title: 't', pid: 7, request: {} })], { status: 'running', attempt: 1, pid: 7 }],
    [[ev('run.started', { pid: 7 }), ev('run.interrupted', { reason: 'gone' })], { status: 'interrupted', interruptedReason: 'gone' }],
    [[ev('run.started', { pid: 7 }), ev('run.interrupted', { reason: 'gone' }), ev('run.retried', { pid: 8 })], { status: 'running', attempt: 2, pid: 8 }],
    [[ev('run.started', {}), ev('step.started', { step: 'build' }), ev('step.finished', { step: 'build', result: { costUsd: 0.25 } })], { costUsd: 0.25 }],
    [[ev('run.started', {}), ev('run.finished', { status: 'delivered', pr: 'p.md', head: 'factory/x/main' })], { status: 'delivered', pr: 'p.md', head: 'factory/x/main' }],
  ];
  for (const [events, expected] of cases) {
    const row = events.reduce((r, e) => runsProjection.reduce(r, e), null);
    for (const [k, v] of Object.entries(expected)) assert.deepEqual(row[k], v, `${events.map((e) => e.type).join(' → ')}: ${k}`);
  }
  const done = [ev('run.started', {}), ev('step.started', { step: 'build' }), ev('step.finished', { step: 'build', result: { costUsd: 0 } })].reduce((r, e) => runsProjection.reduce(r, e), null);
  assert.equal(done.steps.build.status, 'done');
});

// ---- Effects ------------------------------------------------------------------------------------

test('effects: performed once, then skipped; the saved result comes back', async () => {
  const store = newStore();
  let calls = 0;
  const effect = { key: 'pr:r:abc', kind: 'pr', runId: 'r', perform: async () => ({ n: ++calls }), check: async () => null };
  assert.deepEqual(await performEffect(store, effect), { result: { n: 1 }, how: 'performed' });
  assert.deepEqual(await performEffect(store, effect), { result: { n: 1 }, how: 'skipped' });
  assert.equal(calls, 1);
});

test('effects: a crash between "did it" and "wrote it down" is RECONCILED, not repeated', async () => {
  const store = newStore();
  let calls = 0;
  const world = new Set(); // the outside world: which PRs exist
  const perform = async () => {
    calls++;
    world.add('pr-1');
    return { path: 'pr-1' };
  };
  const check = async () => (world.has('pr-1') ? { path: 'pr-1' } : null);
  // First attempt: the effect happens, then the process "dies" before effect.done.
  await assert.rejects(
    performEffect(store, {
      key: 'pr:r:abc', kind: 'pr', runId: 'r', check,
      perform: async () => {
        await perform();
        throw new Error('killed right after opening the PR');
      },
    }),
  );
  assert.equal(store.get('effects', 'pr:r:abc').status, 'intended');
  // Retry: intended but not done → ask the world → it happened → record it, don't redo it.
  const again = await performEffect(store, { key: 'pr:r:abc', kind: 'pr', runId: 'r', perform, check });
  assert.equal(again.how, 'reconciled');
  assert.equal(calls, 1);
  assert.equal(store.get('effects', 'pr:r:abc').reconciled, true);
});

test('effects: intended, and the world says it did NOT happen → do it now', async () => {
  const store = newStore();
  await assert.rejects(performEffect(store, { key: 'k', kind: 'push', runId: 'r', check: async () => null, perform: async () => { throw new Error('network down'); } }));
  const again = await performEffect(store, { key: 'k', kind: 'push', runId: 'r', check: async () => null, perform: async () => 'pushed' });
  assert.deepEqual(again, { result: 'pushed', how: 'performed' });
});

// ---- Jobs on the store --------------------------------------------------------------------------

const ISSUE = '---\ntitle: Add a greeting\n---\nPlease add GREETING.md.\n';
const writeGreeting = { text: 'Adding it.', tools: [{ name: 'Write', input: { file_path: 'GREETING.md', content: 'Hello!\n' } }] };
function issueFile() {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, ISSUE);
  return file;
}

test('a job leaves a complete story in the log, and rebuilding the projections gives the same tables', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const out = await runJob({ line: 'quick', issueFile: issueFile(), repo: makeRepo(), agent: { provider: createMockProvider([writeGreeting, { text: 'Done.' }]) } }, { env, store });
  assert.equal(out.status, 'delivered');
  const types = store.read({ stream: `run:${out.runId}` }).map((e) => e.type);
  for (const t of ['run.started', 'step.started', 'workspace.acquired', 'agent.event', 'step.finished', 'effect.intended', 'effect.done', 'artifact.stored', 'run.finished']) assert.ok(types.includes(t), t);
  const run = store.get('runs', out.runId);
  assert.equal(run.status, 'delivered');
  assert.deepEqual(run.artifacts.map((a) => a.kind).sort(), ['diff', 'evidence', 'pr'], 'F14 added evidence.json');
  assert.match(getArtifact(run.artifacts.find((a) => a.kind === 'diff').sha, env)?.toString() ?? '', /\+Hello!/);

  const live = snapshot(store);
  store.rebuild();
  assert.deepEqual(snapshot(store), live);
});

test('CRASH DURING DELIVERY: the PR was written but not recorded; the line retries the station, reconciles, and there is still ONE PR', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const real = createLocalForge({ env });
  let prWrites = 0;
  let crashes = 0;
  const crashing = {
    ...real,
    openOrUpdatePR(slug, pr) {
      prWrites++;
      real.openOrUpdatePR(slug, pr);
      if (crashes++ === 0) throw new Error('simulated crash right after writing the PR');
      return { path: 'unused', action: 'created' };
    },
  };
  const provider = createMockProvider([writeGreeting, { text: 'Done.' }]);
  // F05: this ended in "error" and needed `factory run retry`. F07: the deliver station has
  // retries, so the LINE tries again at once, and the effect reconciles instead of redoing.
  const out = await runJob({ line: 'quick', issueFile: issueFile(), repo: makeRepo(), agent: { provider } }, { env, store, forge: crashing });
  assert.equal(out.status, 'delivered');
  assert.equal(prWrites, 1, 'the PR was written once, ever');
  assert.equal(provider.requests.length, 2, 'the agent was not paid for again');
  assert.equal(real.listPRs(out.step.workspace.slug).length, 1);
  const events = store.read({ stream: `run:${out.runId}` });
  assert.ok(events.some((e) => e.type === 'step.failed' && e.data.step === 'deliver' && /simulated crash/.test(e.data.error)));
  const effectsDone = events.filter((e) => e.type === 'effect.done');
  assert.deepEqual(effectsDone.map((e) => [e.data.key.split(':')[0], Boolean(e.data.reconciled)]), [['push', false], ['pr', true]]);
});

test('RECOVERY: a "running" run whose process is gone becomes interrupted; the retry rebuilds and keeps the old workspace', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo();
  // Simulate a run that died mid-build: started, workspace acquired, never finished.
  const first = await runJob({ line: 'quick', issueFile: issueFile(), repo, agent: { provider: createMockProvider([{ text: 'nothing' }]) } }, { env, store });
  const { acquireWorkspace } = await import('../src/exec/workspace/worktree.js');
  const ws = await acquireWorkspace({ repo, env });
  fs.writeFileSync(path.join(ws.path, 'HALF.md'), 'half done\n');
  const runId = 'run-dead';
  store.append(`run:${runId}`, 'run.started', { runId, itemId: first.run.itemId, title: 'x', pid: 999_999_999, request: first.run.request });
  store.append(`run:${runId}`, 'step.started', { runId, step: 'build' });
  store.append(`run:${runId}`, 'workspace.acquired', { runId, step: 'build', workspace: { id: ws.id, path: ws.path, branch: ws.branch } });

  assert.deepEqual(recoverRuns(store), [runId]);
  assert.equal(store.get('runs', runId).status, 'interrupted');
  assert.deepEqual(recoverRuns(store), [], 'only once');

  const out = await retryRun(store, runId, { live: { provider: createMockProvider([writeGreeting, { text: 'Done.' }]) } });
  assert.equal(out.status, 'delivered');
  assert.equal(store.get('runs', runId).attempt, 2);
  const old = listWorkspaces(env).find((w) => w.id === ws.id);
  assert.equal(old?.status, 'kept', "the interrupted attempt's work is kept…");
  assert.equal(gitIn(ws.mirror, 'show', `${ws.branch}:HALF.md`), 'half done', '…committed to its own branch');
});

test('a delivered run cannot be retried; a live one neither', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const out = await runJob({ line: 'quick', issueFile: issueFile(), repo: makeRepo(), agent: { provider: createMockProvider([writeGreeting, { text: 'Done.' }]) } }, { env, store });
  await assert.rejects(retryRun(store, out.runId), /was delivered/);
  store.append('run:r-live', 'run.started', { runId: 'r-live', itemId: out.run.itemId, title: 't', pid: process.pid, request: {} });
  await assert.rejects(retryRun(store, 'r-live'), /still running/);
});

test('the same issue twice is ONE item with two runs', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const file = issueFile();
  const repo = makeRepo();
  const a = await runJob({ line: 'quick', issueFile: file, repo, agent: { provider: createMockProvider([{ text: 'x' }]) } }, { env, store });
  const b = await runJob({ line: 'quick', issueFile: file, repo, agent: { provider: createMockProvider([{ text: 'y' }]) } }, { env, store });
  assert.equal(store.list('items').length, 1);
  assert.deepEqual(store.get('items', a.run.itemId).runs, [a.runId, b.runId]);
});

// ---- Storage details ----------------------------------------------------------------------------

test('artifacts are content-addressed: same bytes, same address, stored once', () => {
  const env = testEnv();
  const a = putArtifact('hello', env);
  const b = putArtifact(Buffer.from('hello'), env);
  assert.equal(a.sha, b.sha);
  assert.equal(a.sha, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.equal(getArtifact(a.sha, env)?.toString(), 'hello');
});

test('the schema is versioned (migrations), and reopening an existing database is fine', () => {
  const env = testEnv();
  openStore({ env }).close();
  const store = openStore({ env });
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 3, 'F05: events + projections; F06: leases + system; F12: inbox');
  assert.equal(store.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
});

test('several PROCESSES creating the same NEW database and appending at once: nothing lost, nothing doubled', async () => {
  const env = testEnv(); // no database yet: all four create and migrate it at the same moment
  const url = new URL('../src/store/events.js', import.meta.url).href;
  const script = (who) => `import { openStore } from ${JSON.stringify(url)};
    const s = openStore(); for (let i = 0; i < 40; i++) s.append('w:${who}', 'tick', { i }, { key: '${who}-' + i }); s.close();`;
  const one = (who) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script(who)], { env, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => resolve({ code, err }));
    });
  const results = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(one));
  for (const r of results) assert.equal(r.code, 0, r.err);
  assert.equal(openStore({ env }).read().length, 240);
});
