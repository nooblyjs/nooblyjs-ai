// Signing in and out, and who you are. The dev person picker is only mounted when NOOBLY_DEV_LOGIN=true, which
// config.js refuses in production.
import { loginPage } from '../pages/login.js';
import { sendError } from '../util/errors.js';
import { SESSION_COOKIE } from '../config.js';

/** Only same-site paths: "/x" yes, "//evil.example" or "https://…" no. */
const safeNext = (value) => (typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : '/');

export function sessionRoutes({ express, config, people, authservice, events, identify, requireSignIn }) {
  const router = express.Router();

  router.get('/login', identify, async (req, res, next) => {
    try {
      if (req.person) return res.redirect(302, safeNext(req.query.next));
      // With Microsoft Entra ID on (AUTH_METHOD=azure) and no dev picker, sign-in is Microsoft's.
      if (!config.devLogin && config.authMethod === 'azure' && !req.user) {
        return res.redirect(302, `/services/authservice/api/azure?returnUrl=${encodeURIComponent(safeNext(req.query.next))}`);
      }
      // Likewise Google's with AUTH_METHOD=google: app.js starts it at Google's callback path.
      if (!config.devLogin && config.authMethod === 'google' && !req.user) {
        return res.redirect(302, `/services/authservice/openid?returnUrl=${encodeURIComponent(safeNext(req.query.next))}`);
      }
      const everyone = config.devLogin ? (await people.list()).filter((p) => p.active) : [];
      res.type('html').send(String(loginPage({ people: everyone, csrfToken: req.csrfToken, next: safeNext(req.query.next), devLogin: config.devLogin })));
    } catch (err) {
      next(err);
    }
  });

  if (config.devLogin) {
    router.post('/login', async (req, res, next) => {
      try {
        const person = await people.get(String(req.body?.personId ?? ''));
        if (!person?.active) {
          res.locals.audit = { action: 'session.refused', reason: 'unknown or inactive person', target: String(req.body?.personId ?? '') };
          return res.status(400).type('text').send('Pick one of the people on the list.');
        }
        const user = await authservice.getUser(person.email).catch(() => null);
        if (!user || user.isActive === false) {
          res.locals.audit = { action: 'session.refused', reason: 'no active nooblyjs-core account', target: person.id };
          return res.status(409).type('text').send(`${person.name} has no active sign-in account. Restart NooblyJS to create it.`);
        }
        await new Promise((resolve, reject) => req.login(user, (err) => (err ? reject(err) : resolve())));
        res.locals.audit = { action: 'session.signed_in', actor: person.id, target: person.id, method: 'dev-login' };
        await events.emit('session.signed_in', { personId: person.id, method: 'dev-login' }, { actor: person.id });
        res.redirect(302, safeNext(req.body?.next));
      } catch (err) {
        next(err);
      }
    });
  }

  router.post('/logout', identify, async (req, res, next) => {
    try {
      const personId = req.person?.id ?? null;
      res.locals.audit = { action: 'session.signed_out', actor: personId, target: personId };
      await new Promise((resolve) => (req.logout ? req.logout(() => resolve()) : resolve()));
      await new Promise((resolve) => (req.session ? req.session.destroy(() => resolve()) : resolve()));
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      if (personId) await events.emit('session.signed_out', { personId }, { actor: personId });
      res.redirect(302, '/login');
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/v1/me', requireSignIn, (req, res) => {
    const { id, name, email, accessRole, workRole, teams, jobTitle, hasProfile } = req.person;
    res.json({ person: { id, name, email, accessRole, workRole, teams, jobTitle, hasProfile } });
  });

  // An unknown method on /login (e.g. POST without dev login) gets the standard shape.
  router.post('/login', (req, res) => sendError(res, 404, 'not_found', 'Development sign-in is turned off. Set NOOBLY_DEV_LOGIN=true to use it.'));

  return router;
}

export function healthRoutes({ express, config, version }) {
  const router = express.Router();
  // Open to anyone (a load balancer, the desktop window, the Edge extension), so it says only that NooblyJS is up and
  // its version: nothing about the machine, such as where its data folder is (Phase 13 security review).
  router.get('/healthz', (req, res) => res.json({ status: 'ok', version }));
  return router;
}
