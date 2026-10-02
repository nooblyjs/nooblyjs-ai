// @ts-check
// Phase F23: the DISPATCHER. Agent steps, handed to workers on other machines.
//
//   control plane                                   worker (anywhere that can reach the URL)
//   ─────────────                                   ──────
//   dispatch(job) ─► queue ◄── POST /worker/lease ── "anything for me?"
//                          ──► the job (a step: prompt, model, base commits as a git bundle)
//                   events ◄── POST /worker/events ── agent output, as it happens
//              heartbeat  ◄── POST /worker/heartbeat ─ "still working" ─► { ok } | { stop: 'cancelled' | 'lease lost' }
//   ◄─ result  ◄─ complete ◄── POST /worker/complete ─ the outcome + the new commits (a git bundle)
//
// LEASES, again (F06): a worker holds a step only while it heartbeats. Miss them for
// leaseMs and the step goes back in the queue for another worker (up to maxAttempts);
// when the old worker's next heartbeat arrives, it's told "lease lost" and stops its agent.
// So a worker that hangs, crashes or loses its network costs one lease, not the run.
//
// The queue lives in the control plane's memory, on purpose: the RUN is already durable
// (leased and event-sourced by the scheduler). If the control plane restarts, the scheduler
// requeues the run, which dispatches its step again.
import crypto from 'node:crypto';
import { systemClock } from '../util/clock.js';

/**
 * @param {{ clock?: import('../util/clock.js').Clock, leaseMs?: number, maxAttempts?: number, log?: (l: string) => void }} [options]
 */
export function createDispatcher({ clock = systemClock, leaseMs = 60_000, maxAttempts = 2, log = () => {} } = {}) {
  /** @type {Map<string, any>} */
  const steps = new Map();

  /** Steps whose worker went quiet: back to the queue, or failed. */
  function expire() {
    for (const s of steps.values()) {
      if (s.state !== 'leased' || clock.now() - s.beatAt < leaseMs) continue;
      log(`step ${s.id}: worker ${s.worker} went quiet; ${s.attempt < maxAttempts ? 'requeued' : 'giving up'}`);
      s.lost.add(s.worker);
      if (s.attempt < maxAttempts) Object.assign(s, { state: 'queued', worker: null });
      else finish(s, null, new Error(`no worker finished the step (${s.attempt} attempt(s); the last one, ${s.worker}, stopped heartbeating)`));
    }
  }

  function finish(s, result, error) {
    s.state = 'done';
    s.signal?.removeEventListener('abort', s.onAbort);
    steps.delete(s.id);
    if (error) s.reject(error);
    else s.resolve(result);
  }

  const mine = (worker, stepId) => {
    const s = steps.get(stepId);
    return s && s.state === 'leased' && s.worker === worker ? s : null;
  };

  return {
    /**
     * Hand a step to the next free worker; resolves with what it sends back.
     * @param {object} job  serializable: everything a worker needs
     * @param {{ signal?: AbortSignal, onEvent?: (e: object) => void }} [options]
     */
    dispatch(job, { signal, onEvent } = {}) {
      return new Promise((resolve, reject) => {
        const id = `step-${crypto.randomUUID().slice(0, 8)}`;
        const s = { id, job: { ...job, stepId: id }, state: 'queued', worker: null, attempt: 0, beatAt: 0, lost: new Set(), onEvent, signal, resolve, reject, stop: null, onAbort: null };
        if (signal) {
          s.onAbort = () => {
            s.stop = 'cancelled';
            if (s.state === 'queued') finish(s, null, new Error('interrupted'));
          };
          signal.addEventListener('abort', s.onAbort);
        }
        steps.set(id, s);
      });
    },

    /** A worker asks for work. */
    lease(worker) {
      expire();
      const s = [...steps.values()].find((x) => x.state === 'queued');
      if (!s) return null;
      Object.assign(s, { state: 'leased', worker, attempt: s.attempt + 1, beatAt: clock.now() });
      log(`step ${s.id} → ${worker} (attempt ${s.attempt})`);
      return { ...s.job, attempt: s.attempt, leaseMs };
    },

    /** "Still working." Tells the worker to stop if the run was cancelled or the lease moved on. */
    heartbeat(worker, stepId) {
      expire();
      const s = mine(worker, stepId);
      if (!s) return { ok: false, stop: 'lease lost' };
      s.beatAt = clock.now();
      return s.stop ? { ok: false, stop: s.stop } : { ok: true };
    },

    /** Agent output, streamed back. Only from the worker that holds the step. */
    events(worker, stepId, events) {
      const s = mine(worker, stepId);
      if (!s) return false;
      s.beatAt = clock.now();
      for (const e of events) s.onEvent?.(e);
      return true;
    },

    /** The step's result. From a worker that lost its lease, it's ignored: another worker has the step now. */
    complete(worker, stepId, result) {
      const s = mine(worker, stepId);
      if (!s) return false;
      finish(s, { ...result, worker }, null);
      return true;
    },

    /** The worker couldn't run it (its own problem, e.g. no provider key): let another worker try. */
    fail(worker, stepId, reason) {
      const s = mine(worker, stepId);
      if (!s) return false;
      log(`step ${s.id}: ${worker} failed it (${reason})`);
      if (s.attempt < maxAttempts) Object.assign(s, { state: 'queued', worker: null });
      else finish(s, null, new Error(`the step failed on worker ${worker}: ${reason}`));
      return true;
    },

    expire,
    /** For the dashboard and tests. */
    get pending() {
      return [...steps.values()].map((s) => ({ id: s.id, state: s.state, worker: s.worker, attempt: s.attempt }));
    },
  };
}
