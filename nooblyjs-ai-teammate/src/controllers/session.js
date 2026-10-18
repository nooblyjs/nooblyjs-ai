// Who is signed in, and signing out, for the app's own page (transitional "document" mode: until the NooblyJS frame
// draws the shell, this app has its own sidebar and sign-out button). The host owns signing in.
import { LOGIN_PATH, PROFILE_PATH, USERS_PATH } from '../config/app.js';

export function sessionController({ audit, repos, signOut }) {
  return {
    async show(req, res) {
      const { owner } = await repos.config.getSettings();
      const signedIn = req.actor?.type === 'user';
      res.json({
        authenticated: signedIn,
        owner: { name: owner?.name ?? 'Owner' },
        user: signedIn ? { id: req.actor.id, name: req.actor.name, username: req.actor.username, role: req.actor.role, accessRole: req.actor.accessRole } : undefined,
        csrf: signedIn ? req.csrf : undefined,
        // nooblyjs-core's pages for signing in, your own account (password) and people and roles.
        links: { signIn: LOGIN_PATH, account: PROFILE_PATH, people: USERS_PATH },
      });
    },

    // Ends the session: the host's sign-out when it has one, otherwise Passport's logout and the session's end. The
    // browser also sends the bearer token core's login page keeps, so the host can revoke it too.
    async signOut(req, res) {
      const token = typeof req.body?.token === 'string' ? req.body.token : null;
      await audit.record(req.actor, 'session.logout');
      if (signOut) {
        await signOut(req, res, { token });
      } else {
        await new Promise((resolve) => (req.logout ? req.logout(() => resolve()) : resolve()));
        await new Promise((resolve) => (req.session ? req.session.destroy(() => resolve()) : resolve()));
      }
      res.status(204).end();
    },
  };
}
