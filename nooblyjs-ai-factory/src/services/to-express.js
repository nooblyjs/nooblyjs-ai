// @ts-check
// Phase F26: the factory's ROUTE TABLE, served by Express. The table and its handlers
// (src/routes/api.js, src/controllers/api.js) were written for the node:http router in
// src/routes/http.js. When NooblyJS hosts the factory there is no server of our own: NooblyJS hands
// over ITS express, and this turns each row into a route on one of its routers.
//
//   ['GET', '/api/runs/:id', handler]   →   router.get('/runs/:id', …before, adapter(handler))
//
// The handler contract doesn't change: it gets { params, query, body, req, res, principal }
// and returns { status?, json }. What changes is the edges: sign-in, permissions and the
// audit log come from the host (`before`), and errors use NooblyJS's one shape:
//
//   { "error": { "code": "not_found", "message": "No run \"x\"." } }

const CODES = { 400: 'bad_request', 401: 'unauthenticated', 403: 'forbidden', 404: 'not_found', 409: 'conflict', 422: 'unprocessable' };

/** @param {any} res  @param {number} status  @param {string} message */
export function sendError(res, status, message) {
  res.status(status).json({ error: { code: CODES[status] ?? 'error', message } });
}

/**
 * @param {Array<[string, string, (ctx: any) => any]>} routes
 * @param {object} options
 * @param {any} options.express                the HOST's express module, never a copy of our own
 * @param {string} [options.strip]             the prefix the table's patterns carry and the mount point replaces
 * @param {(method: string, pattern: string) => Function[]} [options.before]   middleware for one route (permission, audit)
 * @param {(req: any) => any} [options.principal]   who is calling, as the handlers know it
 */
export function toExpressRouter(routes, { express, strip = '/api', before = () => [], principal = () => undefined }) {
  const router = express.Router();
  for (const [method, pattern, handler] of routes) {
    if (!pattern.startsWith(`${strip}/`)) throw new Error(`Route ${pattern} is not under ${strip}/.`);
    router[method.toLowerCase()](pattern.slice(strip.length), ...before(method, pattern), async (req, res) => {
      try {
        const out = await handler({ params: req.params, query: req.query ?? {}, body: req.body ?? {}, req, res, principal: principal(req) });
        if (out?.stream) return; // the handler owns the response
        res.status(out?.status ?? 200).json(out?.json ?? {});
      } catch (error) {
        if (res.headersSent) return res.end();
        sendError(res, /** @type {any} */ (error).status ?? 400, error instanceof Error ? error.message : String(error));
      }
    });
  }
  router.use((req, res) => sendError(res, 404, `No route ${req.method} ${req.originalUrl.split('?')[0]}`));
  return router;
}
