// @ts-check
// Phase F23: who is calling the WORKER API? One ENROLLMENT token lets a new machine
// register, and nothing else. Every other call needs that worker's own, unrevoked token.
import crypto from 'node:crypto';
import { hashToken, workersFrom } from '../models/workers.js';

/**
 * @param {{ store: import('../models/store/events.js').Store, enrollToken: string }} options
 * @returns {(given: string | null) => ({ role: 'enroll' } | { role: 'worker', workerId: string, name: string } | null)}
 */
export function workerAuthorizer({ store, enrollToken }) {
  if (!enrollToken) throw new Error('Workers need an enrollment token (FACTORY_WORKER_ENROLL_TOKEN).');
  const enrollHash = hashToken(enrollToken);
  return (given) => {
    if (!given) return null;
    const h = hashToken(given);
    if (crypto.timingSafeEqual(Buffer.from(h), Buffer.from(enrollHash))) return { role: 'enroll' };
    const w = workersFrom(store).find((x) => x.tokenHash === h && !x.revoked);
    return w ? { role: 'worker', workerId: w.id, name: w.name } : null;
  };
}

/** The calling worker's id, or a 403 for anyone who isn't a registered worker. */
export function requireWorker(principal) {
  if (principal?.role !== 'worker') throw Object.assign(new Error('A worker token is needed (register first).'), { status: 403 });
  return principal.workerId;
}

/** A 403 unless the caller holds the enrollment token. */
export function requireEnroll(principal) {
  if (principal?.role !== 'enroll') throw Object.assign(new Error('Registering needs the enrollment token.'), { status: 403 });
}
