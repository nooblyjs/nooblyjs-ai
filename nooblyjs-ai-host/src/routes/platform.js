// /api/v1/platform: repositories, containers, settings (models, budgets, guardrails, integrations, organisation),
// environments, secrets, members and the audit log (product.md §5.7). Reading needs `read` (the audit log needs
// `read-audit`); each write needs the permission named on its route, and an agent is refused every write whatever
// its role. Every write is audited by the host; res.locals.audit names the action, what changed and why.
import { HttpError } from '../util/errors.js';
import { now as nowIso } from '../util/dates.js';
import { claudeModels, CLOUD_PROVIDERS, PROVIDER_TEXT } from '../services/platform/routes.js';
import { money } from '../services/platform/budgets.js';

// Integrations and the environment variables that connect them (tech.md §9). Bitbucket and Jira are read through
// the devtools service (Phase 11), which says what its tokens can read; the others arrive with their phase.
const INTEGRATIONS = [
  { key: 'bitbucket', label: 'Bitbucket', devtools: true },
  { key: 'jira', label: 'Jira', devtools: true },
  { key: 'teams', label: 'Microsoft Teams / Outlook', microsoft: true },
];

const READS = { issues: 'issues', sprints: 'boards and sprints', repositories: 'repositories, branches, commits and files', pullRequests: 'pull requests', pipelines: 'pipelines' };

/** A devtools status as an Integrations row: what it reads, what its token cannot, and a warning when it could write. */
function devtoolsRow(i, status) {
  const s = status?.[i.key];
  if (!s?.connected) return { key: i.key, label: i.label, state: 'not-connected', stateText: 'Not connected', detail: s?.text ?? 'Not connected.', readOnly: true };
  const can = Object.entries(s.reads ?? {}).filter(([, r]) => r?.ok).map(([k]) => READS[k]);
  const cannot = Object.entries(s.reads ?? {}).filter(([, r]) => r && !r.ok).map(([k, r]) => `${READS[k]}${r.scope ? ` (needs ${r.scope})` : ''}`);
  const where = i.key === 'jira'
    ? `${s.site}; projects ${s.projects.map((p) => (p.name ? `${p.key} (${p.name})` : `${p.key} (not readable)`)).join(', ') || 'none chosen'}`
    : `workspace ${s.workspace}; ${[...s.projects.map((p) => `project ${p}`), ...s.repositories].join(', ') || 'no repositories chosen'}`;
  const warning = s.tokenCanWrite === true ? 'This read token can also write. NooblyJS never writes with it (writing has its own token), but a read-only token is safer.'
    : i.key === 'jira' && s.accountMayWrite ? 'The account behind this read token may edit issues in Jira. NooblyJS never writes with it: writing has its own token and is off until an Owner switches it on.' : null;
  return {
    key: i.key, label: i.label, state: 'connected', stateText: 'Connected · read only', readOnly: true,
    detail: where, account: s.account ?? null, reads: can, cannotRead: cannot, scopes: s.scopes ?? null, warning,
  };
}

export function platformRoutes({ express, platform, devtools, notify = null, teamsConfig = null, members, auditQuery, events, store, clock, roles, requireSignIn, requireRole, env = process.env }) {
  const router = express.Router();
  const read = [requireSignIn, requireRole('read')];
  const at = () => nowIso(clock);
  // Agents never change Platform (product.md §3): refused before the permission check, whatever their role.
  const noAgents = (req, res, next) => (req.person?.kind === 'agent'
    ? next(new HttpError(403, 'agents_refused', 'Agents cannot change Platform settings. People decide.'))
    : next());
  const write = (permission) => [requireSignIn, noAgents, requireRole(permission)];
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    if (err?.status === 403) res.locals.audit = { ...(res.locals.audit ?? {}), action: 'access.refused', attempted: res.locals.audit?.action ?? null, code: err.code, reason: err.message };
    // A change that was refused is recorded as refused, so a record named for the change always means it happened.
    else if (res.locals.audit && err?.status) Object.assign(res.locals.audit, { action: 'platform.change_refused', attempted: res.locals.audit.action, code: err.code, reason: err.message });
    next(err);
  });
  const by = (req) => ({ id: req.person.id, name: req.person.name });

  // ---------- The status card ----------

  router.get('/api/v1/platform/status', ...read, wrap(async (req, res) => {
    const usage = await platform.containers.usage();
    res.json({ cluster: usage.healthText, usage });
  }));

  // ---------- Repositories ----------

  const FILTERS = {
    all: () => true,
    factory: (r) => r.factoryEnabled,
    'read-only': (r) => r.access === 'read',
    'not-indexed': (r) => !r.indexed,
  };

  router.get('/api/v1/platform/repositories', ...read, wrap(async (req, res) => {
    const all = await platform.repositories.list();
    const filter = FILTERS[req.query.filter] ? String(req.query.filter) : 'all';
    const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, all.filter(f).length]));
    res.json({ filter, counts, repositories: all.filter(FILTERS[filter]) });
  }));

  router.get('/api/v1/platform/repositories/:id', ...read, wrap(async (req, res) => {
    const repository = await platform.repository(req.params.id);
    if (!repository) throw new HttpError(404, 'repository_not_found', `No connected repository "${req.params.id}".`);
    const secrets = (await platform.secrets.list()).filter((s) => s.repo === repository.name);
    // Live from Bitbucket for an imported repository: branches, commits and open pull requests, or why not.
    const live = repository.source === 'bitbucket' && !repository.gone && devtools ? await devtools.repository(repository.shortName) : null;
    res.json({ repository, secrets, ...(live ? { live } : {}) });
  }));

  // Refreshes Platform's list from Bitbucket (the projects and repositories chosen in Settings · Integrations).
  // It reads Bitbucket and writes only NooblyJS's own files.
  router.post('/api/v1/platform/repositories/import', ...write('change-repo-access'), wrap(async (req, res) => {
    res.locals.audit = { action: 'repo.imported', target: 'bitbucket' };
    const result = await platform.importRepositories({ fresh: true });
    if (!result.ok) throw new HttpError(result.reason === 'not-configured' ? 409 : 502, `bitbucket_${String(result.reason).replace(/-/g, '_')}`, result.message);
    Object.assign(res.locals.audit, { added: result.added, updated: result.updated.length, gone: result.gone, missing: result.missing });
    if (result.added.length || result.gone.length) {
      await events.emit('repo.imported', { system: 'platform', summary: `imported from Bitbucket: ${result.added.length} new, ${result.updated.length} refreshed${result.gone.length ? `, ${result.gone.length} no longer there` : ''}` }, { actor: req.person.id });
    }
    res.json(result);
  }));

  router.post('/api/v1/platform/repositories', ...write('change-repo-access'), wrap(async (req, res) => {
    res.locals.audit = { action: 'repo.connected', target: String(req.body?.name ?? '') };
    const repository = await platform.repositories.connect(req.body ?? {}, { now: at() });
    await events.emit('repo.connected', { system: 'platform', repo: repository.name, access: repository.access, summary: `connected ${repository.name} (agents: ${repository.accessText.toLowerCase()})` }, { actor: req.person.id });
    res.status(201).json({ repository });
  }));

  router.patch('/api/v1/platform/repositories/:id', ...write('change-repo-access'), wrap(async (req, res) => {
    res.locals.audit = { action: 'repo.access_changed', target: req.params.id };
    const { before, after } = await platform.repositories.update(req.params.id, req.body ?? {});
    const from = { access: before.access, ...before.may };
    const to = { access: after.access, ...after.may };
    Object.assign(res.locals.audit, { target: after.name, from, to, reason: textOf(req.body?.reason) });
    await events.emit('repo.access_changed', { system: 'platform', repo: after.name, from, to, summary: `set agent access on ${after.name} to ${after.accessText.toLowerCase()}` }, { actor: req.person.id });
    res.json({ repository: after });
  }));

  // ---------- Containers (the simulated runtime: services/platform/containers.js) ----------

  router.get('/api/v1/platform/containers', ...read, wrap(async (req, res) => {
    res.json(await platform.containers.overview());
  }));

  router.get('/api/v1/platform/containers/:id/logs', ...read, wrap(async (req, res) => {
    res.json({ id: req.params.id, lines: await platform.containers.logs(req.params.id) });
  }));

  router.post('/api/v1/platform/containers/stop-all', ...write('change-guardrails'), wrap(async (req, res) => {
    res.locals.audit = { action: 'containers.stopped_all', target: 'containers', reason: textOf(req.body?.reason) };
    const result = await platform.containers.stopAll({ by: by(req), reason: textOf(req.body?.reason) });
    res.locals.audit.stopped = result.stopped.map((w) => w.id);
    res.json(result);
  }));

  router.post('/api/v1/platform/containers/:id/stop', ...write('change-guardrails'), wrap(async (req, res) => {
    res.locals.audit = { action: 'container.stopped', target: req.params.id, reason: textOf(req.body?.reason) };
    res.json(await platform.containers.stop(req.params.id, { by: by(req), reason: textOf(req.body?.reason) }));
  }));

  // ---------- Settings ----------

  router.get('/api/v1/platform/settings', ...read, wrap(async (req, res) => {
    const now = at();
    const [routes, spend, budgets, guardrails, organisation, tools] = await Promise.all([
      platform.routes.list(), platform.budgets.routeSpend(now), platform.budgets.status(now), platform.guardrails.list(),
      store.readYaml(['config', 'organisation.yaml']),
      devtools ? devtools.status().catch(() => null) : null,
    ]);
    res.json({
      models: {
        routes: routes.map((r) => ({ ...r, spend30: spend[r.id] ?? 0 })),
        choices: claudeModels(),
        providers: CLOUD_PROVIDERS.map((p) => ({ id: p, label: PROVIDER_TEXT[p] })),
      },
      budgets,
      guardrails,
      integrations: INTEGRATIONS.map((i) => {
        if (i.devtools) return devtoolsRow(i, tools);
        if (i.microsoft) {
          // The Teams bot (its Entra app) and approval emails (Microsoft Graph, app-only): Phase 12.
          const bot = Boolean(teamsConfig?.appId && teamsConfig?.secret);
          const mail = notify?.status?.() ?? { email: false };
          const reads = [bot ? 'the NooblyJS bot in Teams chats and meetings; approval messages in Teams' : null, mail.email ? `approval emails, sent from ${mail.sender}` : null].filter(Boolean);
          const missing = [bot ? null : 'the Teams bot (TEAMS_BOT_APP_ID, TEAMS_BOT_APP_SECRET, TEAMS_BOT_TENANT_ID)', mail.email ? null : 'approval emails (MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET, MS_GRAPH_SENDER)'].filter(Boolean);
          return {
            key: i.key, label: i.label,
            state: bot || mail.email ? 'connected' : 'not-connected',
            stateText: bot && mail.email ? 'Connected' : bot || mail.email ? 'Partly connected' : 'Not connected',
            detail: reads.length ? `Sends ${reads.join('; ')}.` : 'Not set up.',
            ...(missing.length ? { cannotRead: missing.map((m) => `not set up: ${m}`) } : {}),
            ...(teamsConfig?.devUnsigned ? { warning: `Development: unsigned activities from the Agents Playground are accepted, as ${teamsConfig.devPerson}.` } : {}),
          };
        }
        const connected = i.env.some((k) => env[k]);
        return { key: i.key, label: i.label, state: connected ? 'connected' : 'not-connected', stateText: connected ? 'Connected' : `Not connected (arrives in Phase ${i.phase})` };
      }),
      organisation: organisation ?? {},
    });
  }));

  router.patch('/api/v1/platform/settings/routes/:id', ...write('change-guardrails'), wrap(async (req, res) => {
    res.locals.audit = { action: 'model_route.changed', target: `route:${req.params.id}` };
    const { model, fallback, provider } = req.body ?? {};
    const { before, after } = await platform.routes.update(req.params.id, { model, fallback, provider });
    Object.assign(res.locals.audit, { from: before, to: after, reason: textOf(req.body?.reason) });
    const route = (await platform.routes.list()).find((r) => r.id === req.params.id);
    await events.emit('model_route.changed', { system: 'platform', route: req.params.id, from: before, to: after, summary: `routed "${route.label}" to ${route.modelLabel} on ${route.providerText}${route.fallbackLabel ? `, falling back to ${route.fallbackLabel}` : ''}` }, { actor: req.person.id });
    res.json({ route });
  }));

  router.patch('/api/v1/platform/settings/budgets', ...write('set-budgets'), wrap(async (req, res) => {
    res.locals.audit = { action: 'budget.changed', target: 'budgets' };
    const { total, pauseOnLimit, systems } = req.body ?? {};
    const change = await platform.budgets.update({ total, pauseOnLimit, systems });
    const summary = { total: change.after.total, pauseOnLimit: change.after.pauseOnLimit !== false, systems: Object.fromEntries(Object.entries(change.after.systems ?? {}).map(([k, s]) => [k, s.daily ?? s.monthly])) };
    Object.assign(res.locals.audit, { changed: change.changed, to: summary, reason: textOf(req.body?.reason) });
    await events.emit('budget.changed', { system: 'platform', changed: change.changed, ...summary, summary: `changed budgets: ${change.changed.map((k) => (k === 'total' ? `total ${money(summary.total)}` : `${change.after.systems[k]?.label ?? k} ${money(summary.systems[k])}`)).join(', ') || (summary.pauseOnLimit ? 'agents pause when a budget is reached' : 'agents keep working past a budget')}` }, { actor: req.person.id });
    // A budget lowered to (or below) what is already spent is reached now, and is said now.
    const reached = await platform.sayReached({ again: change.changed, actor: req.person.id });
    res.json({ budgets: await platform.budgets.status(at()), reached: reached.map((r) => ({ budget: r.key, text: `${r.label} has reached its ${money(r.limit)} ${r.period === 'day' ? 'daily cap' : 'budget'}` })) });
  }));

  router.patch('/api/v1/platform/settings/guardrails/:key', ...write('change-guardrails'), wrap(async (req, res) => {
    res.locals.audit = { action: 'guardrail.changed', target: `guardrail:${req.params.key}`, reason: textOf(req.body?.reason) };
    const result = await platform.guardrails.set(req.params.key, { on: req.body?.on, reason: req.body?.reason });
    if (result.unchanged) {
      res.locals.audit.action = 'guardrail.unchanged';
      return res.json({ guardrail: result.guardrail, unchanged: true });
    }
    Object.assign(res.locals.audit, { label: result.guardrail.label, from: result.before, to: result.after, reason: result.reason });
    await events.emit('guardrail.changed', { system: 'platform', guardrail: req.params.key, label: result.guardrail.label, from: result.before, to: result.after, reason: result.reason, summary: `turned ${result.after ? 'on' : 'off'} "${result.guardrail.label}": ${result.reason}` }, { actor: req.person.id });
    res.json({ guardrail: result.guardrail });
  }));

  // Policy history: the audit log's guardrail changes (the last 92 days), so the two can never disagree.
  router.get('/api/v1/platform/guardrails/history', ...read, wrap(async (req, res) => {
    const to = at().slice(0, 10);
    const from = shift(to, -91);
    const { records } = await auditQuery({ action: 'guardrail.changed', from, to, limit: 100 });
    const people = new Map();
    res.json({
      history: await Promise.all(records.map(async (r) => ({
        at: r.at, actor: r.actor, actorName: await nameOf(r.actor, people), guardrail: r.record.target?.replace(/^guardrail:/, '') ?? null,
        label: r.record.label ?? null, from: r.record.from ?? null, to: r.record.to ?? null, reason: r.record.reason ?? null,
      }))),
    });
  }));

  // ---------- Environments and secrets ----------

  // Infrastructure owns environments (decided 2026-10-10): its list when it is hosted, else Platform's file.
  router.get('/api/v1/platform/environments', ...read, wrap(async (req, res) => res.json(await platform.environments())));

  router.get('/api/v1/platform/secrets', ...read, wrap(async (req, res) => res.json({ secrets: await platform.secrets.list() })));

  router.post('/api/v1/platform/secrets', ...write('change-repo-access'), wrap(async (req, res) => {
    res.locals.audit = { action: 'secret.mapped', target: `${req.body?.repo ?? ''}:${req.body?.name ?? ''}` };
    const secret = await platform.secrets.add(req.body ?? {});
    Object.assign(res.locals.audit, { target: `${secret.repo}:${secret.name}`, ref: secret.ref });
    await events.emit('secret.mapped', { system: 'platform', repo: secret.repo, name: secret.name, ref: secret.ref, summary: `mapped ${secret.name} → ${secret.ref} on ${secret.repo}` }, { actor: req.person.id });
    res.status(201).json({ secret });
  }));

  router.delete('/api/v1/platform/secrets', ...write('change-repo-access'), wrap(async (req, res) => {
    const repo = String(req.query.repo ?? '');
    const name = String(req.query.name ?? '');
    res.locals.audit = { action: 'secret.unmapped', target: `${repo}:${name}` };
    const secret = await platform.secrets.remove({ repo, name });
    await events.emit('secret.unmapped', { system: 'platform', repo: secret.repo, name: secret.name, summary: `removed ${secret.name} from ${secret.repo}` }, { actor: req.person.id });
    res.json({ secret });
  }));

  // ---------- Members ----------

  router.get('/api/v1/platform/members', ...read, wrap(async (req, res) => {
    res.json({ roles: await roles.roleNames(), members: await members.list() });
  }));

  router.patch('/api/v1/platform/members/:id', ...write('manage-members'), wrap(async (req, res) => {
    res.locals.audit = { action: 'member.access_role_changed', target: req.params.id, reason: textOf(req.body?.reason) };
    const result = await members.setRole(req.params.id, req.body ?? {}, { roleNames: await roles.roleNames() });
    if (!result.unchanged) {
      Object.assign(res.locals.audit, { from: result.before, to: result.after, reason: result.reason });
      await events.emit('member.access_role_changed', { system: 'platform', personId: req.params.id, from: result.before, to: result.after, summary: `changed ${result.person.name}'s access role from ${result.before} to ${result.after}` }, { actor: req.person.id });
    }
    res.json({ member: result.person });
  }));

  // ---------- Audit log ----------

  router.get('/api/v1/platform/audit', requireSignIn, requireRole('read-audit'), wrap(async (req, res) => {
    const q = req.query;
    res.json(await auditQuery({ actor: str(q.actor), action: str(q.action), text: str(q.text), from: str(q.from), to: str(q.to), cursor: str(q.cursor) }));
  }));

  async function nameOf(id, cache) {
    if (!id) return null;
    if (!cache.has(id)) cache.set(id, (await members.list()).find((m) => m.id === id)?.name ?? id);
    return cache.get(id);
  }

  return router;
}

const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
const textOf = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null);
function shift(day, n) {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
