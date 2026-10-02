// @ts-check
// Phase F06: THE SCHEDULER. A loop that turns the queue into running work, within limits.
//
//   every tick:
//     1. recover        running runs with an expired lease / a dead worker → interrupted
//     2. requeue        interrupted by accident (not stopped, not cancelled), attempts left → queued again
//     3. stop?          stop-all → abort every run this process is doing; start nothing
//     4. pick           which queued runs may start (pick.js: priority, fairness, slots, budgets)
//     5. lease + start  take each run's lease, record run.leased, run it in the background
//
// The loop itself decides nothing clever: the rules live in pure functions
// (pick, canStart) and the state lives in the store. That's what makes it
// small, testable with a fake clock, and safe to kill: a restarted scheduler
// finds everything it needs in the event log and the lease table.
import { campaignStartsToday } from '../campaign/campaign.js';
import os from 'node:os';
import { systemClock } from '../util/clock.js';
import { spentToday } from './budgets.js';
import { isStopped } from './kill-switch.js';
import { acquireLease, workerName } from './leases.js';
import { pickRuns } from './pick.js';
import { holdRun } from './worker.js';
import { recoverRuns } from '../store/recovery.js';

const NOT_REQUEUED = ['stopped', 'cancelled', 'interrupted']; // human decisions (and Ctrl+C) stay stopped

/**
 * @param {{ store: import('../store/events.js').Store, config: import('../config/factory-config.js').FactoryConfig,
 *           execute: (runId: string, live: { signal: AbortSignal, guard: () => void, budgetUsd: number }) => Promise<unknown>,
 *           clock?: import('../util/clock.js').Clock, worker?: string, isAlive?: (pid: number) => boolean,
 *           onDecision?: (d: object) => void }} options
 */
export function createScheduler({ store, config, execute, clock = systemClock, worker = workerName('serve'), isAlive, onDecision }) {
  // Keyed by LEASE id, not run id: after a lease expires, the same run can be held by a new
  // worker while the old one is still winding down. Keyed by run id, the new entry overwrote
  // the old (whose heartbeat then never learned it had lost the lease), and the old one's
  // cleanup deleted the new one. A test caught it.
  /** @type {Map<string, { runId: string, held: ReturnType<typeof holdRun>, done: Promise<unknown> }>} */
  const active = new Map();
  let lastWaiting = [];

  function tick() {
    // 1–2. Recover lost runs, and put accidents back in the queue.
    recoverRuns(store, { clock, ...(isAlive && { isAlive }) });
    for (const run of store.list('runs')) {
      if (run.status !== 'interrupted' || NOT_REQUEUED.includes(run.interruptedReason) || run.attempt >= config.maxAttempts) continue;
      store.append(`run:${run.id}`, 'run.requeued', { runId: run.id, reason: run.interruptedReason }, { key: `run:${run.id}:${run.attempt}:requeued` });
    }

    // 3. The red button: stop everything this process is doing, start nothing.
    const stopped = isStopped(store);
    if (stopped) for (const { held } of active.values()) held.stop('stopped');

    // 4. Decide.
    const runs = store.list('runs');
    const now = clock.now();
    const running = runs.filter((r) => r.status === 'running');
    const queued = runs.filter((r) => r.status === 'queued');
    const spentBySlug = Object.fromEntries([...new Set(queued.map((r) => r.slug).filter(Boolean))].map((slug) => [slug, spentToday(store, now, slug)]));
    const decision = pickRuns({ queued, running, config, spentAll: spentToday(store, now), spentBySlug, stopped, campaignToday: campaignStartsToday(store, now) });
    lastWaiting = decision.waiting;
    // Phase F18: work is waiting on MONEY. Say so once a day per budget (an event, so it can be notified).
    const day = new Date(now).toISOString().slice(0, 10);
    for (const w of decision.waiting) {
      const scope = w.reason.match(/^(repo daily budget \([^)]+\)|daily budget)/)?.[1];
      if (scope) store.append('system', 'budget.exceeded', { day, scope, reason: w.reason, runId: w.runId }, { key: `budget:${day}:${scope}` });
    }

    // 5. Lease and start. Another scheduler may win a lease first: then just skip it.
    const started = [];
    for (const { runId, budgetUsd } of decision.start) {
      const lease = acquireLease(store.db, runId, { worker, ttlMs: config.leaseTtlMs, clock });
      if (!lease) continue;
      const attempt = store.get('runs', runId).attempt + 1;
      store.append(`run:${runId}`, 'run.leased', { runId, worker, pid: process.pid, host: os.hostname(), attempt, budgetUsd }, { key: `run:${runId}:${attempt}:leased` });
      const held = holdRun(store, lease, { ttlMs: config.leaseTtlMs, heartbeatMs: config.heartbeatMs, clock });
      const done = Promise.resolve()
        .then(() => execute(runId, { signal: held.signal, guard: held.guard, budgetUsd }))
        .catch(() => {}) // the run recorded its own error; the scheduler carries on
        .finally(() => {
          held.release();
          active.delete(lease.leaseId);
        });
      active.set(lease.leaseId, { runId, held, done });
      started.push(runId);
    }
    const summary = { started, waiting: decision.waiting, running: active.size, stopped };
    onDecision?.(summary);
    return summary;
  }

  let timer = null;
  return {
    tick,
    /** Tick every tickMs until stop(). */
    start() {
      tick();
      timer = setInterval(tick, config.tickMs);
    },
    /** Stop ticking; interrupt what's running here (it will be requeued by the next scheduler). */
    async stop(reason = 'serve stopped') {
      clearInterval(timer);
      for (const { held } of active.values()) held.stop(reason);
      await Promise.all([...active.values()].map((a) => a.done));
    },
    /** Beat every held run now (tests use this instead of waiting for heartbeatMs). */
    beat() {
      for (const { held } of active.values()) held.beat();
    },
    /** The runs this process is working on (a run can appear twice while an old worker winds down). */
    get active() {
      return [...active.values()].map((a) => a.runId);
    },
    get waiting() {
      return lastWaiting;
    },
    /** Wait until nothing is running here. */
    idle: () => Promise.all([...active.values()].map((a) => a.done)),
  };
}
