// @ts-check
// Phase F23: the WORKER API's HANDLERS. Remote workers register, lease agent steps, report
// heartbeats and events, and hand back results; the dispatcher does the bookkeeping.
// Which URL reaches which handler is in src/routes/workers.js.
import crypto from 'node:crypto';
import { requireEnroll, requireWorker } from '../middleware/worker-auth.js';
import { registerWorker } from '../models/workers.js';
import { newId } from '../utils/ids.js';

/**
 * @param {{ store: import('../models/store/events.js').Store, dispatcher: ReturnType<typeof import('../services/remote/dispatcher.js').createDispatcher> }} options
 */
export function createWorkersController({ store, dispatcher }) {
  return {
    register({ principal, body }) {
      requireEnroll(principal);
      const workerId = newId('worker');
      const token = crypto.randomBytes(24).toString('base64url');
      registerWorker(store, { workerId, name: body?.name, token });
      return { json: { workerId, token } };
    },
    lease: ({ principal }) => ({ json: { job: dispatcher.lease(requireWorker(principal)) } }),
    heartbeat: ({ principal, body }) => ({ json: dispatcher.heartbeat(requireWorker(principal), body?.stepId) }),
    events: ({ principal, body }) => ({ json: { ok: dispatcher.events(requireWorker(principal), body?.stepId, Array.isArray(body?.events) ? body.events : []) } }),
    complete: ({ principal, body }) => ({ json: { ok: dispatcher.complete(requireWorker(principal), body?.stepId, body?.result ?? {}) } }),
    fail: ({ principal, body }) => ({ json: { ok: dispatcher.fail(requireWorker(principal), body?.stepId, String(body?.reason ?? 'unknown')) } }),
  };
}
