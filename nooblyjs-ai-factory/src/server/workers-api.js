// @ts-check
// Phase F23: the WORKER API, served by `factory serve --workers`.
//
//   POST /worker/register   (enrollment token)  { name }            → { workerId, token }
//   POST /worker/lease      (worker token)      { name }            → { job } | { job: null }
//   POST /worker/heartbeat                      { stepId }          → { ok } | { ok: false, stop }
//   POST /worker/events                         { stepId, events }  → { ok }
//   POST /worker/complete                       { stepId, result }  → { ok }
//   POST /worker/fail                           { stepId, reason }  → { ok }
//
// TOKENS (Phase F24's "per-worker tokens", needed here): one ENROLLMENT token lets a new
// machine register, and nothing else. Registering gives that worker its OWN token. The
// factory keeps only its hash (worker.registered), so the log never holds a credential,
// and `factory worker revoke <id>` (worker.revoked) cuts off one machine without
// touching the others.
import crypto from 'node:crypto';
import { newId } from '../util/ids.js';

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

/** The known workers, from the event log. */
export function workersFrom(store) {
  const workers = new Map();
  for (const e of store.read({ stream: 'workers' })) {
    if (e.type === 'worker.registered') workers.set(e.data.workerId, { id: e.data.workerId, name: e.data.name, tokenHash: e.data.tokenHash, registeredAt: e.at, revoked: false });
    if (e.type === 'worker.revoked' && workers.has(e.data.workerId)) workers.get(e.data.workerId).revoked = true;
  }
  return [...workers.values()];
}

export function revokeWorker(store, workerId, by = process.env.USER ?? 'operator') {
  if (!workersFrom(store).some((w) => w.id === workerId)) throw new Error(`No worker "${workerId}".`);
  store.append('workers', 'worker.revoked', { workerId, by });
}

/**
 * @param {{ store: import('../store/events.js').Store, dispatcher: ReturnType<typeof import('../remote/dispatcher.js').createDispatcher>, enrollToken: string }} options
 * @returns {{ routes: Array<[string, string, Function]>, authorize: (given: string | null) => any }}
 */
export function workerApi({ store, dispatcher, enrollToken }) {
  if (!enrollToken) throw new Error('Workers need an enrollment token (FACTORY_WORKER_ENROLL_TOKEN).');
  const enrollHash = hash(enrollToken);
  const authorize = (given) => {
    if (!given) return null;
    const h = hash(given);
    if (crypto.timingSafeEqual(Buffer.from(h), Buffer.from(enrollHash))) return { role: 'enroll' };
    const w = workersFrom(store).find((x) => x.tokenHash === h && !x.revoked);
    return w ? { role: 'worker', workerId: w.id, name: w.name } : null;
  };
  const worker = (principal) => {
    if (principal?.role !== 'worker') throw Object.assign(new Error('A worker token is needed (register first).'), { status: 403 });
    return principal.workerId;
  };
  return {
    authorize,
    routes: [
      ['POST', '/worker/register', ({ principal, body }) => {
        if (principal.role !== 'enroll') throw Object.assign(new Error('Registering needs the enrollment token.'), { status: 403 });
        const workerId = newId('worker');
        const token = crypto.randomBytes(24).toString('base64url');
        store.append('workers', 'worker.registered', { workerId, name: String(body?.name ?? workerId).slice(0, 60), tokenHash: hash(token) });
        return { json: { workerId, token } };
      }],
      ['POST', '/worker/lease', ({ principal }) => ({ json: { job: dispatcher.lease(worker(principal)) } })],
      ['POST', '/worker/heartbeat', ({ principal, body }) => ({ json: dispatcher.heartbeat(worker(principal), body?.stepId) })],
      ['POST', '/worker/events', ({ principal, body }) => ({ json: { ok: dispatcher.events(worker(principal), body?.stepId, Array.isArray(body?.events) ? body.events : []) } })],
      ['POST', '/worker/complete', ({ principal, body }) => ({ json: { ok: dispatcher.complete(worker(principal), body?.stepId, body?.result ?? {}) } })],
      ['POST', '/worker/fail', ({ principal, body }) => ({ json: { ok: dispatcher.fail(worker(principal), body?.stepId, String(body?.reason ?? 'unknown')) } })],
    ],
  };
}
