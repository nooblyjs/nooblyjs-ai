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
// Tokens: src/middleware/worker-auth.js. The registry: src/models/workers.js.
// Handlers: src/controllers/workers.js.
import { createWorkersController } from '../controllers/workers.js';
import { workerAuthorizer } from '../middleware/worker-auth.js';

/**
 * @param {{ store: import('../models/store/events.js').Store, dispatcher: ReturnType<typeof import('../services/remote/dispatcher.js').createDispatcher>, enrollToken: string }} options
 * @returns {{ routes: Array<[string, string, Function]>, authorize: (given: string | null) => any }}
 */
export function workerApi({ store, dispatcher, enrollToken }) {
  const authorize = workerAuthorizer({ store, enrollToken });
  const workers = createWorkersController({ store, dispatcher });
  return {
    authorize,
    routes: [
      ['POST', '/worker/register', workers.register],
      ['POST', '/worker/lease', workers.lease],
      ['POST', '/worker/heartbeat', workers.heartbeat],
      ['POST', '/worker/events', workers.events],
      ['POST', '/worker/complete', workers.complete],
      ['POST', '/worker/fail', workers.fail],
    ],
  };
}
