// The app's one router, mounted once at the mount path by register(): the browser files from public/, the API under
// /api/v1 (so /teammates/api/v1/… on the site), uploaded images, and the host's frame for every other page URL, so
// deep links and refresh land on the right screen of the UI module (public/js/module.js).
import { authenticate, requireUser, requireUserWithRole } from '../middleware/auth.js';
import { securityHeaders } from '../middleware/security.js';
import { serveStatic } from '../middleware/static.js';
import { requestMetrics } from '../middleware/metrics.js';
import { errorHandler, notFoundJson } from '../middleware/errors.js';
import { uploadsController } from '../controllers/uploads.js';
import { sessionRouter } from './session.js';
import { adminRouter } from './admin.js';
import { billingRouter } from './billing.js';
import { apiRouter } from './api.js';
import { boardRouter } from './board.js';

export const API_BASE = '/api/v1';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** `s` is everything register() built: the host's members, the services and models, `log` and `metrics`. */
export function createRouter(s) {
  const { express, host, auth, log, metrics, providers, roleGates } = s;
  const router = express.Router();
  router.use(securityHeaders);
  router.use(serveStatic({ express }));

  const api = express.Router();
  api.use(requestMetrics({ metrics, log, base: API_BASE }));
  api.use(express.json({ limit: '2mb' }));
  api.get('/health', (req, res) => res.json({ ok: true, provider: providers.describe() }));
  // Everything else needs a signed-in person (host.auth) or an API key, and every write goes past host.audit.
  api.use(authenticate({ auth, hostAuth: host.auth, hostChecksCsrf: Boolean(host.checksCsrf) }));
  api.use((req, res, next) => {
    req.roleGates = roleGates;
    if (host.audit && UNSAFE.has(req.method) && req.actor?.type === 'user') return host.audit(req, res, next);
    next();
  });
  api.use('/session', sessionRouter({ ...s, signOut: host.signOut }));
  api.use('/admin', requireUserWithRole('owner'), adminRouter(s));
  api.use(billingRouter(s));
  api.use('/board', boardRouter(s));
  api.use(apiRouter(s));
  api.use(notFoundJson);
  router.use(API_BASE, api);

  router.get('/uploads/:file', authenticate({ auth, hostAuth: host.auth }), requireUser, uploadsController(s).serve);
  // A page URL (no file extension) is a screen of the UI module: the host's frame answers (signed-in only).
  router.get('/{*rest}', (req, res, next) => (/\.[A-Za-z0-9]+$/.test(req.path) ? next() : host.frame(req, res, next)));
  router.use(errorHandler({ log }));
  return router;
}
