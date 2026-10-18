// The hosted app's API, mounted at <mountPath>/api/v1 behind the host's sign-in (noobly structure.md §2a). Errors use the one
// NooblyJS shape: { error: { code, message, details } }.
//
// The platform's own routes are mounted beside this one by src/hosted/platform.cjs.

/**
 * @param {object} o
 * @param {object} o.host    the host's shared services (express, auth, …)
 * @param {{ name: string, version: string, mountPath: string }} o.about
 */
export function createApi({ host, about }) {
  const api = host.express.Router();

  /** What is running, for the UI and for a quick check that the app is mounted. */
  api.get('/about', (req, res) => {
    res.json(about);
  });
  return api;
}

/** The last handler under /api/v1: an unknown API URL answers in the NooblyJS error shape, never with the frame. */
export function apiNotFound(req, res) {
  res.status(404).json({ error: { code: 'not_found', message: `No ${req.method} ${req.baseUrl}${req.path} in the wiki API.`, details: null } });
}
