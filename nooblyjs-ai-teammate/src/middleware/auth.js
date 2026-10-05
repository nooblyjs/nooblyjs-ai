// Authentication for the JSON API: the nooblyjs-core sign-in (session cookie, plus a CSRF header on changes) or an
// API key (teammate calls only). People sign in on core's login page; see src/core.
import { HttpError } from '../util/errors.js';
import { atLeast, roleFromCore } from '../services/auth.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The signed-in person as the app sees them, from core's user record. */
export const actorFromCoreUser = (user) => ({
  type: 'user', id: user.email, name: user.fullName || user.email, role: roleFromCore(user.roles ?? user.role), username: user.email,
});

/**
 * Works out who is calling and sets req.actor. Does not reject anything by itself. Runs after coreSession(), which
 * puts the person signed in with core on req.user.
 */
export function identify({ auth }) {
  return async (req, res, next) => {
    try {
      const header = req.get('authorization') ?? '';
      const raw = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-api-key');
      if (raw) {
        const key = await auth.authenticateKey(raw);
        if (!key) throw new HttpError(401, 'invalid_api_key', 'That API key is not valid or has been revoked.');
        req.actor = { type: 'key', id: key.id, name: key.name, key };
        return next();
      }
      if (req.user?.email && req.user.isActive !== false) {
        req.actor = actorFromCoreUser(req.user);
        req.csrf = auth.csrfFor(req.sessionID);
      } else {
        req.actor = { type: 'anonymous', ip: req.ip };
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function checkCsrf(req) {
  if (UNSAFE.has(req.method) && (!req.csrf || req.get('x-csrf-token') !== req.csrf)) {
    throw new HttpError(403, 'csrf_failed', 'Your session has expired. Refresh the page and try again.');
  }
}

/** A signed-in person required (plus the CSRF header on changes). */
export function requireUser(req, res, next) {
  if (req.actor?.type === 'key') return next(new HttpError(403, 'key_not_allowed', 'API keys can only call teammates (POST /api/teammates/:id/tasks).'));
  if (req.actor?.type !== 'user') return next(new HttpError(401, 'unauthenticated', 'Sign in to continue.'));
  try {
    checkCsrf(req);
    next();
  } catch (err) {
    next(err);
  }
}

/** Owner session, or an API key whose scope includes :id and that is within its rate limit. */
export function requireUserOrKey({ auth, limiter }) {
  return async (req, res, next) => {
    if (req.actor?.type !== 'key') return requireUser(req, res, (err) => (err || req.method === 'GET' ? next(err) : requireRole('manager')(req, res, next)));
    const { key } = req.actor;
    if (!auth.keyAllows(key, req.params.id)) return next(new HttpError(403, 'key_scope', `This API key cannot call ${req.params.id}.`));
    const rate = limiter.take(`key:${key.id}`, key.rateLimit ?? 30);
    res.set('X-RateLimit-Limit', String(key.rateLimit ?? 30));
    res.set('X-RateLimit-Remaining', String(rate.remaining));
    if (!rate.ok) {
      res.set('Retry-After', String(rate.retryAfter));
      return next(new HttpError(429, 'rate_limited', `Rate limit reached for this key. Try again in ${rate.retryAfter}s.`));
    }
    auth.recordUse(key.id).catch(() => {});
    next();
  };
}

/** Signed-in user with at least `role` (viewer < manager < owner). Use after requireUser. */
export const requireRole = (role) => (req, res, next) => {
  if (req.actor?.type === 'user' && !atLeast(req.actor, role)) {
    return next(new HttpError(403, 'forbidden', `This needs the ${role} role. You are signed in as a ${req.actor.role}.`));
  }
  next();
};

/** Owner session plus role check in one step. */
export const requireUserWithRole = (role) => (req, res, next) => requireUser(req, res, (err) => (err ? next(err) : requireRole(role)(req, res, next)));
