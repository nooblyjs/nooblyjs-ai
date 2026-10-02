// Phase F06: scheduler, leases, budgets, kill switch. Fake clock: no waiting.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { DEFAULTS } from '../src/config/factory-config.js';
import { createMockProvider } from '../src/harness.js';
import { executeRun, submitJob } from '../src/job/run-job.js';
import { canStart, spentToday } from '../src/scheduler/budgets.js';
import { cancelRun, resumeAll, stopAll } from '../src/scheduler/kill-switch.js';
import { acquireLease, holdsLease, renewLease } from '../src/scheduler/leases.js';
import { pickRuns } from '../src/scheduler/pick.js';
import { createScheduler } from '../src/scheduler/scheduler.js';
import { LEASE_LOST, holdRun } from '../src/scheduler/worker.js';
import { openStore } from '../src/store/events.js';
import { createFakeClock } from '../src/util/clock.js';
import { makeRepo, testEnv, tmpDir } from './helpers.js';

const config = (over = {}) => ({ ...DEFAULTS, maxConcurrent: 2, dailyBudgetUsd: 100, runBudgetUsd: 1, ...over });
const q = (id, slug, extra = {}) => ({ id, slug, itemId: `${slug}#1`, status: 'queued', priority: 0, queuedAt: id, request: { repo: `/x/${slug}` }, ...extra });
const pick = (queued, running = [], over = {}) => pickRuns({ queued, running, config: config(over.config), spentAll: over.spentAll ?? 0, spentBySlug: over.spentBySlug ?? {}, stopped: over.stopped ?? false });
const started = (d) => d.start.map((s) => s.runId);

// ---- pick: pure rules, as tables ----------------------------------------------------------------

test('pick: priority first, then oldest', () => {
  assert.deepEqual(started(pick([q('r1', 'a'), q('r2', 'a', { priority: 10 }), q('r3', 'a')])), ['r2', 'r1']);
});

test('pick: never more than maxConcurrent, counting what is already running', () => {
  assert.deepEqual(started(pick([q('r1', 'a'), q('r2', 'b')], [q('r0', 'c', { status: 'running' })])), ['r1']);
});

test('pick: FAIRNESS: ten runs queued for repo A do not starve the one for repo B', () => {
  const queued = [...Array.from({ length: 10 }, (_, i) => q(`a${i}`, 'A')), q('b0', 'B')];
  assert.deepEqual(started(pick(queued)), ['a0', 'b0']);
});

test('pick: a repo limit skips that repo, not the others', () => {
  const d = pick([q('r1', 'a'), q('r2', 'a'), q('r3', 'b')], [], { config: { maxConcurrent: 3, repos: { a: { maxConcurrent: 1 } } } });
  assert.deepEqual(started(d), ['r1', 'r3']);
  assert.match(d.waiting.find((w) => w.runId === 'r2')?.reason ?? '', /repo a: 1 at a time/);
});

test('pick: stopped means nothing starts', () => {
  const d = pick([q('r1', 'a')], [], { stopped: true });
  assert.deepEqual(d.start, []);
  assert.match(d.waiting[0].reason, /stopped/);
});

test('budgets: running runs RESERVE their budget; a run that could overspend the day waits', () => {
  const cfg = config({ dailyBudgetUsd: 3, runBudgetUsd: 1 });
  const running = [q('x', 'a', { status: 'running' })];
  assert.deepEqual(canStart(q('r', 'a'), { running, config: cfg, spentAll: 1, spentBySlug: {} }), { ok: true, budgetUsd: 1 });
  const no = canStart(q('r', 'a'), { running, config: cfg, spentAll: 1.5, spentBySlug: {} });
  assert.equal(no.ok, false);
  assert.match(/** @type {any} */ (no).reason, /\$1\.50 spent \+ \$1\.00 reserved of \$3/);
  const d = pick([q('r1', 'a'), q('r2', 'a')], [], { config: { dailyBudgetUsd: 1.5, runBudgetUsd: 1 } });
  assert.deepEqual(started(d), ['r1'], 'the second would overspend: it waits');
});

test('budgets: a run gets min(its own --budget, the default); per-repo daily caps', () => {
  const cheap = q('r', 'a', { request: { repo: '/x/a', agent: { limits: { budgetUsd: 0.25 } } } });
  assert.deepEqual(canStart(cheap, { running: [], config: config(), spentAll: 0, spentBySlug: {} }), { ok: true, budgetUsd: 0.25 });
  const capped = canStart(q('r', 'a'), { running: [], config: config({ repos: { a: { dailyBudgetUsd: 2 } } }), spentAll: 0, spentBySlug: { a: 1.5 } });
  assert.match(/** @type {any} */ (capped).reason, /repo daily budget \(a\)/);
});

test('spentToday counts finished steps of TODAY only (UTC, by the clock)', () => {
  const clock = createFakeClock(Date.parse('2026-09-30T10:00:00Z'));
  const store = openStore({ env: testEnv(), clock });
  store.append('run:r', 'step.finished', { runId: 'r', step: 'build', result: { costUsd: 0.4 } });
  assert.equal(spentToday(store, clock.now()), 0.4);
  clock.advance(24 * 3600_000);
  assert.equal(spentToday(store, clock.now()), 0, 'a new day');
});

// ---- leases -------------------------------------------------------------------------------------

test('leases: one holder at a time; an expired lease can be taken; the old holder then cannot renew', () => {
  const clock = createFakeClock(0);
  const { db } = openStore({ env: testEnv(), clock });
  const a = acquireLease(db, 'r', { worker: 'A', ttlMs: 1000, clock });
  assert.ok(a);
  assert.equal(acquireLease(db, 'r', { worker: 'B', ttlMs: 1000, clock }), null, 'held');
  clock.advance(500);
  assert.ok(renewLease(db, /** @type {any} */ (a), { ttlMs: 1000, clock }), 'A renews in time');
  clock.advance(1500); // A froze: no renewal
  const b = acquireLease(db, 'r', { worker: 'B', ttlMs: 1000, clock });
  assert.ok(b, 'expired: B may take it');
  assert.equal(renewLease(db, /** @type {any} */ (a), { ttlMs: 1000, clock }), false, 'A wakes up: its lease id no longer matches');
  assert.equal(holdsLease(db, /** @type {any} */ (a), { clock }), false);
  assert.equal(holdsLease(db, /** @type {any} */ (b), { clock }), true);
});

test('a worker that lost its lease stops, and its guard refuses side effects', () => {
  const clock = createFakeClock(0);
  const store = openStore({ env: testEnv(), clock });
  const lease = /** @type {any} */ (acquireLease(store.db, 'r', { worker: 'A', ttlMs: 1000, clock }));
  const held = holdRun(store, lease, { ttlMs: 1000, heartbeatMs: 1e9, clock });
  clock.advance(2000);
  acquireLease(store.db, 'r', { worker: 'B', ttlMs: 1000, clock });
  assert.throws(() => held.guard(), /lease lost: not delivering/);
  assert.equal(held.signal.reason, LEASE_LOST);
  held.release();
});

// ---- the scheduler ------------------------------------------------------------------------------

/** A store with n queued runs, created directly as events (no git needed). */
function queue(store, specs) {
  for (const [id, slug, extra = {}] of specs) store.append(`run:${id}`, 'run.queued', { runId: id, itemId: `${slug}#1`, slug, title: id, priority: 0, request: { repo: `/x/${slug}` }, ...extra });
}
/** The scheduler starts execute() on the next turn of the event loop: let it. */
const settle = () => new Promise((r) => setImmediate(r));

/** An execute() that runs until told to finish (or aborted), and records what it saw. */
function controllable() {
  const runs = new Map();
  const execute = (runId, live) =>
    new Promise((resolve) => {
      runs.set(runId, { live, finish: resolve });
      live.signal.addEventListener('abort', () => resolve(live.signal.reason));
    });
  return { runs, execute };
}

test('scheduler: starts up to maxConcurrent, records run.leased, and fills slots as runs finish', async () => {
  const clock = createFakeClock(1_000_000);
  const store = openStore({ env: testEnv(), clock });
  queue(store, [['r1', 'a'], ['r2', 'a'], ['r3', 'a']]);
  const work = controllable();
  const s = createScheduler({ store, config: config(), execute: work.execute, clock });
  assert.deepEqual(s.tick().started, ['r1', 'r2']);
  await settle();
  assert.equal(store.get('runs', 'r1').status, 'running');
  assert.equal(store.get('runs', 'r1').attempt, 1);
  assert.deepEqual(s.tick().started, [], 'full');
  // r1 finishes (the real executeRun would append run.finished):
  store.append('run:r1', 'run.finished', { runId: 'r1', itemId: 'a#1', status: 'delivered' });
  work.runs.get('r1').finish();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(s.tick().started, ['r3']);
});

test('scheduler: a lease that expires (a frozen worker) → interrupted → requeued with attempt+1 → leased again', async () => {
  const clock = createFakeClock(1_000_000);
  const store = openStore({ env: testEnv(), clock });
  queue(store, [['r1', 'a']]);
  const work = controllable();
  const cfg = config({ leaseTtlMs: 1000, heartbeatMs: 1e9 });
  const s = createScheduler({ store, config: cfg, execute: work.execute, clock });
  s.tick();
  await settle();
  const first = work.runs.get('r1').live;
  clock.advance(5000); // no heartbeats: the lease runs out
  const second = s.tick();
  await settle();
  assert.deepEqual(second.started, ['r1'], 'requeued and started again in the same tick');
  assert.equal(store.get('runs', 'r1').attempt, 2);
  const types = store.read({ stream: 'run:r1' }).map((e) => e.type);
  assert.deepEqual(types, ['run.queued', 'run.leased', 'run.interrupted', 'run.requeued', 'run.leased']);
  const again = work.runs.get('r1').live;
  assert.notEqual(first, again);
  assert.equal(s.active.length, 2, 'both workers are tracked: the old one is still winding down');
  s.beat(); // the OLD worker's heartbeat now finds its lease gone…
  assert.equal(first.signal.reason, LEASE_LOST);
  assert.equal(again.signal.aborted, false, '…and the new worker keeps going');
  await settle();
  assert.deepEqual(s.active, ['r1'], "the old worker's cleanup did not remove the new one");
});

test('scheduler: gives up after maxAttempts', () => {
  const clock = createFakeClock(1_000_000);
  const store = openStore({ env: testEnv(), clock });
  queue(store, [['r1', 'a']]);
  const s = createScheduler({ store, config: config({ leaseTtlMs: 10, heartbeatMs: 1e9, maxAttempts: 2 }), execute: controllable().execute, clock });
  for (let i = 0; i < 5; i++) {
    s.tick();
    clock.advance(100);
  }
  s.tick();
  assert.equal(store.get('runs', 'r1').status, 'interrupted');
  assert.equal(store.get('runs', 'r1').attempt, 2);
});

test('STOP-ALL: every running run is aborted within one tick, nothing new starts, and stopped runs stay stopped after resume', async () => {
  const clock = createFakeClock(1_000_000);
  const store = openStore({ env: testEnv(), clock });
  queue(store, [['r1', 'a'], ['r2', 'b'], ['r3', 'a']]);
  const work = controllable();
  const s = createScheduler({ store, config: config(), execute: work.execute, clock });
  s.tick();
  await settle();
  stopAll(store);
  const t = s.tick();
  assert.deepEqual(t.started, []);
  assert.equal(work.runs.get('r1').live.signal.reason, 'stopped');
  assert.equal(work.runs.get('r2').live.signal.reason, 'stopped');
  // (the real executeRun records run.interrupted {reason: 'stopped'})
  for (const id of ['r1', 'r2']) store.append(`run:${id}`, 'run.interrupted', { runId: id, reason: 'stopped' });
  await s.idle();
  resumeAll(store);
  assert.deepEqual(s.tick().started, ['r3'], 'resume: queued runs start again…');
  assert.equal(store.get('runs', 'r1').status, 'interrupted', '…but stopped runs are not requeued: a human decides');
});

test('CANCEL: a queued run is cancelled at once; a running one is stopped at its next heartbeat', async () => {
  const clock = createFakeClock(1_000_000);
  const store = openStore({ env: testEnv(), clock });
  queue(store, [['r1', 'a'], ['r2', 'a'], ['r3', 'a']]);
  const work = controllable();
  const s = createScheduler({ store, config: config(), execute: work.execute, clock });
  s.tick();
  await settle();
  assert.equal(cancelRun(store, 'r3'), 'cancelled');
  assert.equal(store.get('runs', 'r3').status, 'cancelled');
  assert.equal(cancelRun(store, 'r1'), 'requested');
  s.beat();
  assert.equal(work.runs.get('r1').live.signal.reason, 'cancelled');
  assert.equal(work.runs.get('r2').live.signal.aborted, false);
});

test('END TO END: real jobs through the scheduler, two repos, never more than maxConcurrent at once', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repos = [makeRepo(), makeRepo()];
  for (let i = 0; i < 5; i++) {
    const file = path.join(tmpDir(), `issue-${i}.md`);
    fs.writeFileSync(file, `---\ntitle: Add note ${i}\n---\nAdd NOTE-${i}.md.\n`);
    submitJob(store, { line: 'quick', issueFile: file, repo: repos[i % 2], driver: 'in-process' });
  }
  let now = 0;
  let most = 0;
  const execute = async (runId, live) => {
    most = Math.max(most, ++now);
    try {
      const i = store.get('runs', runId).title.at(-1);
      const provider = createMockProvider([{ text: 'Writing.', tools: [{ name: 'Write', input: { file_path: `NOTE-${i}.md`, content: 'note\n' } }], onChunk: () => new Promise((r) => setTimeout(r, 5)) }, { text: 'Done.' }]);
      return await executeRun(store, runId, { live: { ...live, provider } });
    } finally {
      now--;
    }
  };
  const s = createScheduler({ store, config: config({ maxConcurrent: 2 }), execute });
  for (let i = 0; i < 200 && store.list('runs').some((r) => r.status !== 'delivered'); i++) {
    s.tick();
    await new Promise((r) => setTimeout(r, 20));
  }
  await s.idle();
  assert.deepEqual(store.list('runs').map((r) => r.status), Array(5).fill('delivered'));
  assert.equal(most, 2);
});
