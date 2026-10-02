// Sign-in, first-run setup, sign-out and changing your own password.
import express from 'express';
import { HttpError } from '../util/errors.js';
import { sessionCookie, clearSessionCookie, isSecureRequest, requireUser } from '../middleware/auth.js';

const LOGIN_ATTEMPTS = 10; // per IP per 15 minutes

export function sessionRouter({ auth, audit, repos, limiter, cookieSecure = false }) {
  const r = express.Router();
  const setCookie = (req, res, session) => res.set('Set-Cookie', sessionCookie(session.token, { maxAgeMs: session.maxAgeMs, secure: isSecureRequest(req, cookieSecure) }));
  const throttle = (req) => {
    const rate = limiter.take(`login:${req.ip}`, LOGIN_ATTEMPTS);
    if (!rate.ok) throw new HttpError(429, 'rate_limited', `Too many attempts. Try again in ${Math.ceil(rate.retryAfter / 60)} minutes.`);
  };

  r.get('/', async (req, res) => {
    const { owner } = await repos.config.getSettings();
    const signedIn = req.actor?.type === 'user';
    res.json({
      authenticated: signedIn,
      setupRequired: auth.setupRequired,
      owner: { name: owner?.name ?? 'Owner' },
      user: signedIn ? { id: req.actor.id, name: req.actor.name, username: req.actor.username, role: req.actor.role, mustChangePassword: Boolean(req.session.user.mustChangePassword) } : undefined,
      csrf: signedIn ? req.session.csrf : undefined,
    });
  });

  // Any signed-in user can change their own password (this signs out their other sessions).
  r.post('/password', requireUser, async (req, res) => {
    const session = await auth.changePassword(req.actor.id, req.body?.current, req.body?.next);
    setCookie(req, res, session);
    await audit.record(req.actor, 'user.password_change', req.actor.id);
    res.json({ csrf: session.csrf });
  });

  r.post('/', async (req, res) => {
    throttle(req);
    try {
      const session = await auth.login(req.body?.password, req.body?.username);
      limiter.reset(`login:${req.ip}`);
      setCookie(req, res, session);
      const who = await auth.verifySession(session.token);
      await audit.record({ type: 'user', name: who.user.name }, 'session.login', who.user.username, req.ip);
      res.json({ csrf: session.csrf });
    } catch (err) {
      if (err.status === 401) await audit.record({ type: 'anonymous', ip: req.ip }, 'session.login_failed', String(req.body?.username ?? '').slice(0, 40));
      throw err;
    }
  });

  r.post('/setup', async (req, res) => {
    throttle(req);
    const session = await auth.setup(req.body?.code, req.body?.password);
    setCookie(req, res, session);
    const { owner } = await repos.config.getSettings();
    await audit.record({ type: 'user', name: owner?.name ?? 'owner' }, 'session.setup', '', req.ip);
    res.json({ csrf: session.csrf });
  });

  r.delete('/', requireUser, async (req, res) => {
    res.set('Set-Cookie', clearSessionCookie({ secure: isSecureRequest(req, cookieSecure) }));
    await audit.record(req.actor, 'session.logout');
    res.status(204).end();
  });

  return r;
}
