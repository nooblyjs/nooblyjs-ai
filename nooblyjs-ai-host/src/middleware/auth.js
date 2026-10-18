// Who is signed in. nooblyjs-core's Passport puts the core user on req.user; NooblyJS's own record of the person
// (data/people/<id>/PERSON.md) supplies the access role. Pages send a signed-out person to /login; APIs get 401.
import { sendError, wantsJson } from '../util/errors.js';

/**
 * Sets req.person when someone active is signed in. Never refuses. NooblyJS runs it once per request, before
 * audit and CSRF, so even a refused request records who made it.
 *
 * Someone signed in to nooblyjs-core (e.g. through Microsoft Entra ID) with no NooblyJS record yet gets one created by
 * `onNewPerson(coreUser)`. A record that exists but is inactive is never replaced: that person stays signed out.
 */
export function identify({ people, onNewPerson }) {
  return async (req, res, next) => {
    if (req.identified) return next();
    try {
      const user = req.user?.isActive === false ? null : req.user;
      let person = user?.email ? await people.getByEmail(user.email) : null;
      if (!person && user?.email && onNewPerson) person = await onNewPerson(user);
      if (person?.active) req.person = person;
      req.identified = true;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Requires a signed-in person: `host.auth` for hosted apps. */
export function requireSignIn({ people, onNewPerson }) {
  const who = identify({ people, onNewPerson });
  return (req, res, next) => who(req, res, (err) => {
    if (err) return next(err);
    if (req.person) return next();
    // Signed in to nooblyjs-core, but NooblyJS has this person switched off: say so instead of sending them back to
    // /login, which would loop.
    if (req.user?.email) {
      const message = `You are signed in as ${req.user.email}, but your NooblyJS access is switched off. Ask an Owner to turn it back on.`;
      if (wantsJson(req)) return sendError(res, 403, 'person_inactive', message);
      return res.status(403).type('text').send(message);
    }
    if (wantsJson(req)) return sendError(res, 401, 'unauthenticated', 'Sign in to continue.');
    res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  });
}
