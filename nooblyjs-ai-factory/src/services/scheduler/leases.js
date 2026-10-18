// @ts-check
// Phase F06: LEASES. "This run is mine, until <time>, unless I say so again."
//
// Two workers must never execute the same run at once. A lock would do it,
// but a lock held by a process that dies is held forever. A LEASE expires:
//
//   acquire   write the lease if the run has none, or only an EXPIRED one  (atomic: under the store's lock)
//   renew     every heartbeat: push expiresAt forward, IF the lease is still ours
//   lost      renew finds another leaseId (or none): someone took over. Stop at once.
//   expired   nobody renewed in time: the scheduler may give the run to someone else
//
// Every lease has its own random leaseId, so a worker that was frozen for a
// minute (a laptop lid, a debugger) and wakes up can't renew a lease that was
// meanwhile given to another worker: the ids no longer match.
//
// And the rule that makes it safe: CHECK THE LEASE BEFORE ANY SIDE EFFECT
// (push, PR). A worker that lost its lease must not deliver.
//
// NooblyJS Phase 7: leases are a small file next to the log (leases.yaml), not a database
// table. store.leases(fn) reads it, lets fn change the map, and writes it back, all under
// the lock that appends take, so two processes still can't both get the same run.
import crypto from 'node:crypto';
import os from 'node:os';
import { systemClock } from '../../utils/clock.js';

/** @typedef {{ runId: string, leaseId: string, worker: string, host: string, pid: number, expiresAt: number }} Lease */
/** @typedef {import('../../models/store/events.js').Store} Store */

export function workerName(kind = 'serve') {
  return `${kind}:${os.hostname()}:${process.pid}`;
}

/**
 * Take the lease on a run, if it is free (no lease, or an expired one).
 * @param {Store} store
 * @returns {Lease | null}
 */
export function acquireLease(store, runId, { worker = workerName(), ttlMs = 60_000, clock = systemClock } = {}) {
  return store.leases((leases) => {
    const now = clock.now();
    const current = leases.get(runId);
    if (current && current.expiresAt > now) return null; // someone holds it
    const lease = { runId, leaseId: crypto.randomUUID(), worker, host: os.hostname(), pid: process.pid, expiresAt: now + ttlMs };
    leases.set(runId, lease);
    return { ...lease };
  });
}

/** Extend OUR lease. false = it's no longer ours (expired and taken, or released). */
export function renewLease(store, lease, { ttlMs = 60_000, clock = systemClock } = {}) {
  return store.leases((leases) => {
    const current = leases.get(lease.runId);
    if (!current || current.leaseId !== lease.leaseId) return false;
    lease.expiresAt = clock.now() + ttlMs;
    leases.set(lease.runId, { ...current, expiresAt: lease.expiresAt });
    return true;
  });
}

/** Is this lease still ours and unexpired? Ask before every side effect. */
export function holdsLease(store, lease, { clock = systemClock } = {}) {
  return store.leases((leases) => {
    const current = leases.get(lease.runId);
    return Boolean(current && current.leaseId === lease.leaseId && current.expiresAt > clock.now());
  });
}

export function releaseLease(store, lease) {
  store.leases((leases) => {
    if (leases.get(lease.runId)?.leaseId === lease.leaseId) leases.delete(lease.runId);
  });
}

/** @returns {Lease | null} */
export function getLease(store, runId) {
  return store.leases((leases) => (leases.has(runId) ? { ...leases.get(runId) } : null));
}

/** How many leases are held right now. */
export function countLeases(store) {
  return store.leases((leases) => leases.size);
}
