// /api/v1/home and /api/v1/activity: what the Home screens need that no single app owns (product.md §5.2).
// Overview joins the lifecycle engine counts with a card per system and the recent activity; Activity reads the
// event log. The lifecycle screens themselves (Lifecycle, Approvals) call the NooblyJS lifecycle engine at /workflows/api/v1.
import { FILTERS } from '../services/activity.js';

// The five systems on Overview, in the mockup's order. `app` is the shell name of the app that reports its status. The
// Product Factory is the Software Factory's Product section since 2026-10-19: one app, two cards.
const SYSTEMS = [
  { key: 'product', app: 'factory', label: 'Product Factory', icon: 'product', href: '/factory/product', purpose: 'Product, architecture, UX and UI design, from signal to handoff.' },
  { key: 'factory', app: 'factory', label: 'Software Factory', icon: 'factory', href: '/factory', purpose: 'Runs specs through stations to reviewed pull requests.' },
  { key: 'teammates', app: 'teammates', label: 'Digital Teammates', icon: 'team', href: '/teammates', purpose: 'Named agents with skills, memory, rates and timesheets.' },
  { key: 'knowledge', app: 'wiki', label: 'Knowledge Repository', icon: 'book', href: '/wiki', purpose: 'One searchable memory of decisions, code, specs and customers.' },
  { key: 'platform', app: 'platform', label: 'Platform', icon: 'layers', href: '/platform', purpose: 'Repositories, containers, models, budgets and policies.' },
];

/** Up to two lines from an app's status card, in the words the app chose. */
function cardLines(card) {
  if (!card) return [];
  return [
    card.items?.[0] ? `${card.items[0].value}` : card.pill?.text,
    card.meter ? `${card.meter.value} ${String(card.meter.label ?? '').toLowerCase()}`.trim() : card.lines?.[0] ?? (card.items?.[0] ? card.pill?.text : null),
  ].filter(Boolean).slice(0, 2);
}

export function homeRoutes({ express, shell, services, activity, metrics, forYou, teams, agents, events, onInvited, clock, requireSignIn, requireRole }) {
  const router = express.Router();
  const read = [requireSignIn, requireRole('read')];

  router.get('/api/v1/home/overview', ...read, async (req, res, next) => {
    try {
      const workflows = services.get('workflows');
      const [lifecycle, status, recent] = await Promise.all([
        workflows?.overview ? workflows.overview(req.person) : null,
        shell.statusFor(req),
        activity.list({ limit: 5 }),
      ]);
      const apps = new Map(shell.list().map((a) => [a.name, a]));
      const systems = SYSTEMS.map((s) => {
        const app = apps.get(s.app);
        let stats;
        if (!app || app.state === 'not-installed') stats = ['Not installed yet', app?.phase ? `Joins NooblyJS in Phase ${app.phase}` : null];
        else if (app.state !== 'ready') stats = ['Unavailable', 'It did not start: check the NooblyJS log'];
        else if (s.key === 'product' && lifecycle) stats = [`${lifecycle.productStats.inDesign} items in design`, `${lifecycle.productStats.approvalsPending} approvals pending`];
        else stats = cardLines(status[s.app]?.card);
        return { key: s.key, label: s.label, icon: s.icon, href: s.href, purpose: s.purpose, stats: stats.filter(Boolean) };
      });
      res.json({ now: recent.now, lifecycle, systems, recent: recent.rows });
    } catch (err) {
      next(err);
    }
  });

  router.get('/api/v1/activity', ...read, async (req, res, next) => {
    try {
      const filter = FILTERS.includes(req.query.filter) ? req.query.filter : 'everything';
      const before = typeof req.query.before === 'string' && !Number.isNaN(Date.parse(req.query.before)) ? req.query.before : null;
      const [page, today, live] = await Promise.all([
        activity.list({ filter, q: String(req.query.q ?? '').slice(0, 100), before, limit: req.query.limit }),
        before ? null : activity.today(),
        before ? null : services.get('workflows')?.live?.() ?? [],
      ]);
      res.json({ ...page, filters: FILTERS, ...(before ? {} : { today, live }) });
    } catch (err) {
      next(err);
    }
  });

  // Metrics: the tiles, the weekly chart, spend by system and the stage table for a range, computed from the event
  // log (src/services/metrics/). ?range=7d|30d|quarter, 30 days when it is left out.
  router.get('/api/v1/home/metrics', ...read, async (req, res, next) => {
    try {
      const range = req.query.range === undefined || req.query.range === '' ? '30d' : String(req.query.range);
      res.json({ ...await metrics.get(range), ranges: metrics.ranges });
    } catch (err) {
      next(err);
    }
  });

  // For you: the home for the person's work role, scoped to their teams, or everything with ?scope=all.
  router.get('/api/v1/home/for-you', ...read, async (req, res, next) => {
    try {
      res.json(await forYou.build(req.person, { scope: req.query.scope === 'all' ? 'all' : 'mine' }));
    } catch (err) {
      next(err);
    }
  });

  // An item's Software Factory work (Phase 7): the runs its work items became, each with its status, gates, PR and
  // cost, and the work items still waiting (no repository mapped, or no agent to do them).
  router.get('/api/v1/home/items/:id/runs', ...read, async (req, res, next) => {
    try {
      const factory = services.get('factory');
      if (typeof factory?.runsForItem !== 'function') return res.json({ itemId: req.params.id, running: false, runs: [], waiting: [] });
      const [runs, waiting] = await Promise.all([factory.runsForItem(req.params.id), factory.waitingWork?.(req.params.id) ?? []]);
      // Each run with the Jira issues linked to its work item (NooblyJS keeps the links; the keys only, no Jira call here).
      const links = services.get('devtools')?.links;
      const withIssues = links ? await Promise.all(runs.map(async (r) => ({ ...r, jiraIssues: r.workItemId ? await links.keys(r.workItemId).catch(() => []) : [] }))) : runs;
      res.json({ itemId: req.params.id, running: true, runs: withIssues, waiting });
    } catch (err) {
      next(err);
    }
  });

  // An item's gate list: the quality attributes from its architecture (the Product Factory's artefact), which the
  // Software Factory checks on every PR. While an architecture decision is still proposed, they are not final.
  router.get('/api/v1/home/items/:id/gates', ...read, async (req, res, next) => {
    try {
      const summary = await services.get('product')?.architectureFor?.(req.params.id) ?? null;
      const gates = summary?.gates ?? [];
      const pending = summary?.proposedAdrs ?? [];
      res.json({
        itemId: req.params.id,
        gates,
        pendingDecisions: pending,
        final: gates.length > 0 && pending.length === 0,
        text: !gates.length
          ? 'No quality attributes yet. They are set in Architecture.'
          : pending.length
            ? `Not final: ${pending.join(', ')} ${pending.length === 1 ? 'is' : 'are'} still proposed. Once decided, these are the gates on every PR.`
            : `${gates.length} gate${gates.length === 1 ? '' : 's'} the Software Factory checks on every PR for this item.`,
      });
    } catch (err) {
      next(err);
    }
  });

  // Teams & roles: the teams, the permissions matrix, the members and the approval rules (read-only here).
  router.get('/api/v1/home/teams', ...read, async (req, res, next) => {
    try {
      const decisions = await activity.countByActor({ types: ['approval.decided'], days: 30 });
      const [list, matrix, members, rules, roster] = await Promise.all([teams.list(), teams.matrix(), teams.members({ decisions }), services.get('workflows')?.rules?.() ?? null, agents.roster()]);
      // An agent is named and described by Digital Teammates ("Agent · Opus"); with it off, by its id alone.
      const known = new Map(roster.map((a) => [a.id, a]));
      const named = (a) => {
        const t = known.get(a.id);
        return t ? { ...a, name: t.name, role: t.role, status: t.statusText, model: t.model?.name ?? null } : a;
      };
      const modelOf = (id) => known.get(id)?.model?.name?.replace(/^Claude /, '') ?? null;
      res.json({
        teams: list.map((t) => ({ ...t, agents: t.agents.map(named) })),
        matrix,
        members: { ...members, rows: members.rows.map((r) => (r.kind === 'agent' ? { ...named(r), kindText: modelOf(r.id) ? `Agent · ${modelOf(r.id)}` : r.kindText } : r)) },
        rules: rules?.rules ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  // Invite a person: their record, their team and their sign-in account. Owners only (the closest permission in
  // the matrix is hire-teammates), and the access role is the inviter's choice, never the invitee's.
  router.post('/api/v1/home/people', requireSignIn, requireRole('hire-teammates'), async (req, res, next) => {
    try {
      const body = req.body ?? {};
      res.locals.audit = { action: 'person.invited', target: String(body.email ?? '').toLowerCase(), accessRole: body.accessRole ?? null, team: body.team ?? null };
      const person = await teams.invite(body, { now: new Date(clock.now()).toISOString() });
      await onInvited?.(person);
      res.locals.audit.target = person.id;
      await events.emit('person.invited', { personId: person.id, accessRole: person.accessRole, team: body.team ?? null, summary: `invited ${person.name} as ${person.accessRole}` }, { actor: req.person.id });
      res.status(201).json({ person: { id: person.id, name: person.name, email: person.email, accessRole: person.accessRole } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
