// @ts-check
// Phase F05: noticing runs whose process DIED.
// Phase F06: …or whose LEASE expired.
//
// A run is "running" in the log until something appends run.finished. If the
// worker is killed (kill -9, a crash, a reboot), nothing ever will. Two ways
// to notice:
//
//   the lease expired      nobody renewed it within leaseTtlMs. Works across machines,
//                          and for a worker that hangs without dying.
//   the pid is gone        same machine only, but immediate: no need to wait for the TTL.
//                          (process.kill(pid, 0): signal 0 sends nothing, it only asks "are you there?")
//
// Either way the run becomes "interrupted". Whether it is tried again is a
// POLICY decision: the scheduler requeues it (up to maxAttempts), or a human
// runs `factory run retry`.
import os from 'node:os';
import { systemClock } from '../util/clock.js';

/**
 * @param {import('./events.js').Store} store
 * @param {{ isAlive?: (pid: number) => boolean, clock?: import('../util/clock.js').Clock }} [options]
 * @returns {string[]}  the runs that were marked interrupted
 */
export function recoverRuns(store, { isAlive = processIsAlive, clock = systemClock } = {}) {
  const recovered = [];
  const host = os.hostname();
  for (const run of store.list('runs')) {
    if (run.status !== 'running') continue;
    const lease = /** @type {any} */ (store.db.prepare('SELECT * FROM leases WHERE run_id = ?').get(run.id));
    let reason = null;
    if (lease && lease.expires_at <= clock.now()) reason = `its lease expired (held by ${lease.worker})`;
    else if (lease && lease.host === host && lease.pid !== process.pid && !isAlive(lease.pid)) reason = `the worker holding it (pid ${lease.pid}) is gone`;
    else if (!lease && run.pid !== process.pid && (!run.host || run.host === host) && !isAlive(run.pid)) reason = `the process doing the work (pid ${run.pid}) is gone`;
    if (!reason) continue;
    if (lease) store.db.prepare('DELETE FROM leases WHERE run_id = ? AND lease_id = ?').run(run.id, lease.lease_id);
    const e = store.append(`run:${run.id}`, 'run.interrupted', { runId: run.id, reason, attempt: run.attempt }, { key: `run:${run.id}:${run.attempt}:interrupted` });
    if (e) recovered.push(run.id);
  }
  return recovered;
}

export function processIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {any} */ (error).code === 'EPERM'; // exists, but isn't ours
  }
}
