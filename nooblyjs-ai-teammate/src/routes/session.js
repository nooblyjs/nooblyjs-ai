// Who is signed in, and signing out. Signing in happens on nooblyjs-core's login page (see src/core); this app only
// reads the core session that page creates.
import express from 'express';
import { requireUser } from '../middleware/auth.js';
import { LOGIN_PATH, PROFILE_PATH, USERS_PATH } from '../core/index.js';

export function sessionRouter({ auth, audit, repos, coreAuth, cookieSecure = false }) {
  const r = express.Router();

  r.get('/', async (req, res) => {
    const { owner } = await repos.config.getSettings();
    const signedIn = req.actor?.type === 'user';
    res.json({
      authenticated: signedIn,
      owner: { name: owner?.name ?? 'Owner' },
      user: signedIn ? { id: req.actor.id, name: req.actor.name, username: req.actor.username, role: req.actor.role } : undefined,
      csrf: signedIn ? req.csrf : undefined,
      // Core's pages for signing in, your own account (password) and people and roles (core admins).
      links: { signIn: LOGIN_PATH, account: PROFILE_PATH, people: USERS_PATH },
    });
  });

  // Ends the core session. The browser also sends core's bearer token (kept by its login page) so it stops working too.
  r.delete('/', requireUser, async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : null;
    if (token) await coreAuth.logout(token).catch(() => {});
    await audit.record(req.actor, 'session.logout');
    await new Promise((resolve) => (req.logout ? req.logout(() => resolve()) : resolve()));
    await new Promise((resolve) => (req.session ? req.session.destroy(() => resolve()) : resolve()));
    res.clearCookie('nooblyjs.sid', { path: '/', httpOnly: true, sameSite: 'lax', secure: cookieSecure });
    res.status(204).end();
  });

  return r;
}

/** GET /api/auth/check: core's login page asks the host app whether its session is still signed in. */
export const authCheck = (req, res) => res.json({ authenticated: req.actor?.type === 'user' });
