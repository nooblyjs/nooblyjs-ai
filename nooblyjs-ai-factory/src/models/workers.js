// @ts-check
// Phase F23: the WORKER REGISTRY, a projection of the `workers` stream.
//
// TOKENS (Phase F24's "per-worker tokens"): registering gives each worker its OWN token.
// The factory keeps only its hash (worker.registered), so the log never holds a credential,
// and `factory worker revoke <id>` (worker.revoked) cuts off one machine without
// touching the others.
import crypto from 'node:crypto';

/** What the log stores instead of a token. */
export const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** The known workers, from the event log. */
export function workersFrom(store) {
  const workers = new Map();
  for (const e of store.read({ stream: 'workers' })) {
    if (e.type === 'worker.registered') workers.set(e.data.workerId, { id: e.data.workerId, name: e.data.name, tokenHash: e.data.tokenHash, registeredAt: e.at, revoked: false });
    if (e.type === 'worker.revoked' && workers.has(e.data.workerId)) workers.get(e.data.workerId).revoked = true;
  }
  return [...workers.values()];
}

export function registerWorker(store, { workerId, name, token }) {
  store.append('workers', 'worker.registered', { workerId, name: String(name ?? workerId).slice(0, 60), tokenHash: hashToken(token) });
}

export function revokeWorker(store, workerId, by = process.env.USER ?? 'operator') {
  if (!workersFrom(store).some((w) => w.id === workerId)) throw new Error(`No worker "${workerId}".`);
  store.append('workers', 'worker.revoked', { workerId, by });
}
