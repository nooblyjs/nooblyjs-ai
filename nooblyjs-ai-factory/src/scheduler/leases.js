// @ts-check
// Phase F06: LEASES. "This run is mine, until <time>, unless I say so again."
//
// Two workers must never execute the same run at once. A lock would do it,
// but a lock held by a process that dies is held forever. A LEASE expires:
//
//   acquire   INSERT the lease if the run has none, or only an EXPIRED one  (atomic: one transaction)
//   renew     every heartbeat: push expires_at forward, IF the lease is still ours
//   lost      renew finds another lease_id (or none): someone took over. Stop at once.
//   expired   nobody renewed in time: the scheduler may give the run to someone else
//
// Every lease has its own random lease_id, so a worker that was frozen for a
// minute (a laptop lid, a debugger) and wakes up can't renew a lease that was
// meanwhile given to another worker: the ids no longer match.
//
// And the rule that makes it safe: CHECK THE LEASE BEFORE ANY SIDE EFFECT
// (push, PR). A worker that lost its lease must not deliver.
import crypto from 'node:crypto';
import os from 'node:os';
import { transaction } from '../store/db.js';
import { systemClock } from '../util/clock.js';

/** @typedef {{ runId: string, leaseId: string, worker: string, host: string, pid: number, expiresAt: number }} Lease */

export function workerName(kind = 'serve') {
  return `${kind}:${os.hostname()}:${process.pid}`;
}

/**
 * Take the lease on a run, if it is free (no lease, or an expired one).
 * @param {import('node:sqlite').DatabaseSync} db
 * @returns {Lease | null}
 */
export function acquireLease(db, runId, { worker = workerName(), ttlMs = 60_000, clock = systemClock } = {}) {
  return transaction(db, () => {
    const now = clock.now();
    const current = /** @type {any} */ (db.prepare('SELECT * FROM leases WHERE run_id = ?').get(runId));
    if (current && current.expires_at > now) return null; // someone holds it
    const lease = { runId, leaseId: crypto.randomUUID(), worker, host: os.hostname(), pid: process.pid, expiresAt: now + ttlMs };
    db.prepare('INSERT OR REPLACE INTO leases (run_id, lease_id, worker, host, pid, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(runId, lease.leaseId, worker, lease.host, lease.pid, lease.expiresAt);
    return lease;
  });
}

/** Extend OUR lease. false = it's no longer ours (expired and taken, or released). */
export function renewLease(db, lease, { ttlMs = 60_000, clock = systemClock } = {}) {
  const expiresAt = clock.now() + ttlMs;
  const { changes } = db.prepare('UPDATE leases SET expires_at = ? WHERE run_id = ? AND lease_id = ?').run(expiresAt, lease.runId, lease.leaseId);
  if (changes) lease.expiresAt = expiresAt;
  return changes > 0;
}

/** Is this lease still ours and unexpired? Ask before every side effect. */
export function holdsLease(db, lease, { clock = systemClock } = {}) {
  const row = /** @type {any} */ (db.prepare('SELECT lease_id, expires_at FROM leases WHERE run_id = ?').get(lease.runId));
  return Boolean(row && row.lease_id === lease.leaseId && row.expires_at > clock.now());
}

export function releaseLease(db, lease) {
  db.prepare('DELETE FROM leases WHERE run_id = ? AND lease_id = ?').run(lease.runId, lease.leaseId);
}

/** @returns {Lease | null} */
export function getLease(db, runId) {
  const row = /** @type {any} */ (db.prepare('SELECT * FROM leases WHERE run_id = ?').get(runId));
  return row && { runId: row.run_id, leaseId: row.lease_id, worker: row.worker, host: row.host, pid: row.pid, expiresAt: row.expires_at };
}
