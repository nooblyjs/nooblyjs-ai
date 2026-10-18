// Authentication for the JSON API: the person the host signed in (host.auth puts them on req.person; plus a CSRF
// header on changes) or an API key (teammate calls only). Role checks are the host's (host.requireRole).
import { HttpError } from '../utils/errors.js';
import { atLeast, roleFromAccess } from '../services/auth.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The signed-in person as the app sees them, from the host's person record. */
export const actorFromPerson = (person) => {
  const email = person.email ?? person.id;
  return { type: 'user', id: email, name: person.name || email, role: roleFromAccess(person.accessRole), accessRole: person.accessRole, username: email };
};

/**
 * Works out who is calling and sets req.actor. An API key is checked here; anyone else goes through the host's
 * `auth`, which answers 401 itself when nobody is signed in.
 */
export function authenticate({ auth, hostAuth, hostChecksCsrf = false }) {
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
    } catch (err) {
      return next(err);
    }
    hostAuth(req, res, (err) => {
      if (err) return next(err);
      if (!req.person) return next(new HttpError(401, 'unauthenticated', 'Sign in to continue.'));
      req.actor = actorFromPerson(req.person);
      // NooblyJS checks a CSRF token on every change before any app sees the request (host.checksCsrf); a host that
      // doesn't leaves it to the app's own token (GET /api/v1/session hands it out).
      if (hostChecksCsrf) req.csrfByHost = true;
      else req.csrf = auth.csrfFor(req.sessionID);
      next();
    });
  };
}

function checkCsrf(req) {
  if (req.csrfByHost) return;
  if (UNSAFE.has(req.method) && (!req.csrf || req.get('x-csrf-token') !== req.csrf)) {
    throw new HttpError(403, 'csrf_failed', 'Your session has expired. Refresh the page and try again.');
  }
}

/** A signed-in person required (plus the CSRF header on changes). */
export function requireUser(req, res, next) {
  if (req.actor?.type === 'key') return next(new HttpError(403, 'key_not_allowed', 'API keys can only call teammates (POST <mount path>/api/v1/teammates/:id/tasks).'));
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

/**
 * Signed-in user with at least `role` (viewer < manager < owner). Use after requireUser. The host decides, through
 * the permission for that role (req.roleGates, set by the app's router); without one, the Teammates role decides.
 */
export const requireRole = (role) => (req, res, next) => {
  if (req.actor?.type !== 'user') return next();
  const gate = req.roleGates?.[role];
  if (gate) return gate(req, res, next);
  if (!atLeast(req.actor, role)) {
    return next(new HttpError(403, 'forbidden', `This needs the ${role} role. You are signed in as a ${req.actor.role}.`));
  }
  next();
};

/** Owner session plus role check in one step. */
export const requireUserWithRole = (role) => (req, res, next) => requireUser(req, res, (err) => (err ? next(err) : requireRole(role)(req, res, next)));
