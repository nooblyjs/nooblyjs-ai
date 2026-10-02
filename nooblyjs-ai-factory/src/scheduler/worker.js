// @ts-check
// Phase F06: doing a run WHILE HOLDING ITS LEASE.
//
//   every heartbeatMs:
//     renew the lease       → failed? the run is someone else's now: stop, write NOTHING more
//     stop-all? cancelled?  → stop, and say why
//
// Both `factory serve` (the scheduler's workers) and a direct `factory run`
// use this, so a run is always held by exactly one worker, whichever started it.
//
// Why must a worker that lost its lease write nothing? Because the run may
// already be running somewhere else. If the old worker woke up and appended
// "run.finished", it would contradict the new owner. (The precise version of
// this idea is a FENCING TOKEN: every write carries the lease id, and writes
// with an old one are refused. Here, the worker checks before each side effect.)
import { systemClock } from '../util/clock.js';
import { holdsLease, releaseLease, renewLease } from './leases.js';
import { stopReason } from './kill-switch.js';

export const LEASE_LOST = 'lease lost';

/**
 * @param {import('../store/events.js').Store} store
 * @param {import('./leases.js').Lease} lease
 * @param {{ ttlMs: number, heartbeatMs: number, clock?: import('../util/clock.js').Clock, signal?: AbortSignal }} options
 *   signal: an outside stop button too (Ctrl+C on `factory run`)
 */
export function holdRun(store, lease, { ttlMs, heartbeatMs, clock = systemClock, signal }) {
  const controller = new AbortController();
  const stop = (reason) => !controller.signal.aborted && controller.abort(reason);
  signal?.addEventListener('abort', () => stop('interrupted'), { once: true });

  const beat = () => {
    if (controller.signal.aborted) return;
    if (!renewLease(store.db, lease, { ttlMs, clock })) return stop(LEASE_LOST);
    const why = stopReason(store, lease.runId);
    if (why) stop(why);
  };
  const timer = setInterval(beat, heartbeatMs);
  timer.unref?.();

  return {
    /** Abort this signal to stop the run; its reason says why. */
    signal: controller.signal,
    /** One heartbeat now (tests call this instead of waiting). */
    beat,
    stop,
    /** Call before any side effect: throws if the lease is no longer ours. */
    guard() {
      if (!holdsLease(store.db, lease, { clock })) {
        stop(LEASE_LOST);
        throw new Error(`${LEASE_LOST}: not delivering`);
      }
    },
    /** The run is over: stop beating and give the lease back. */
    release() {
      clearInterval(timer);
      releaseLease(store.db, lease);
    },
  };
}
