// /api/v1/me: the signed-in person's profile and onboarding (tech.md §7.1), and the /onboarding page itself.
// A profile shapes the home; it is never read by a permission check.
import { onboardingPage } from '../pages/onboarding.js';
import { toolKey } from '../services/profiles.js';
import { withTeammate } from '../services/work-roles.js';

export function meRoutes({ express, profiles, workRoles, teams, agents = null, requireSignIn }) {
  const router = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  router.get('/api/v1/me/profile', requireSignIn, wrap(async (req, res) => {
    res.json({ profile: await profiles.get(req.person.id), firstWeek: await profiles.firstWeek(req.person.id) });
  }));

  router.put('/api/v1/me/profile', requireSignIn, wrap(async (req, res) => {
    res.locals.audit = { action: 'profile.updated', target: req.person.id, fields: Object.keys(req.body ?? {}) };
    res.json({ profile: await profiles.update(req.person.id, req.body ?? {}), firstWeek: await profiles.firstWeek(req.person.id) });
  }));

  // Everything the four steps show: the roles and their copy, the role guessed from the job title, the teams.
  router.get('/api/v1/me/onboarding', requireSignIn, wrap(async (req, res) => {
    const [listed, allTeams, profile, suggested, roster] = await Promise.all([workRoles.list(), teams.list(), profiles.get(req.person.id), workRoles.suggest(req.person.jobTitle), agents?.roster?.().catch(() => []) ?? []]);
    // The copy names the teammate actually hired here, not the example it was written with.
    const roles = listed.map((r) => withTeammate(r, roster));
    res.json({
      person: { id: req.person.id, name: req.person.name, jobTitle: req.person.jobTitle },
      suggested: suggested ? { role: suggested, jobTitle: req.person.jobTitle } : null,
      roles: roles.map((r) => ({
        key: r.key, name: r.name, initials: r.initials, blurb: r.blurb, promise: r.promise, tasks: r.tasks ?? [], leadsWith: r.leadsWith ?? [], agents: r.agents ?? '',
        tools: (r.tools ?? []).map((name) => ({ key: toolKey(name), name })),
        firstThings: (r.firstWeek ?? []).map((t) => t.text), home: r.home ?? '/',
      })),
      teams: allTeams.map((t) => ({ id: t.id, name: t.name, counts: t.counts, focus: t.focus, suggested: t.people.some((p) => p.id === req.person.id) })),
      profile,
    });
  }));

  router.post('/api/v1/me/onboarding', requireSignIn, wrap(async (req, res) => {
    const body = req.body ?? {};
    res.locals.audit = { action: 'profile.onboarded', target: req.person.id, workRole: body.workRole ?? null, teams: body.teams ?? [] };
    const profile = await profiles.complete(req.person.id, { workRole: body.workRole, teams: body.teams, tools: body.tools, notifications: { approvalsInTeams: body.approvalsInTeams === true } });
    res.json({ profile, home: (await workRoles.get(profile.workRole))?.home ?? '/' });
  }));

  router.post('/api/v1/me/onboarding/skip', requireSignIn, wrap(async (req, res) => {
    res.locals.audit = { action: 'profile.onboarding_skipped', target: req.person.id };
    const profile = await profiles.skip(req.person.id, { suggestedRole: await workRoles.suggest(req.person.jobTitle) });
    res.json({ profile, home: '/' });
  }));

  // The page: no rail, its own layout (structure.md §3.2). Its module loads the data above.
  router.get('/onboarding', requireSignIn, (req, res) => {
    res.set('Cache-Control', 'no-store').type('html').send(String(onboardingPage({ name: req.person.name })));
  });

  return router;
}
