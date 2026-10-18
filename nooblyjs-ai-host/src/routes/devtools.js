// /api/v1/devtools: what NooblyJS reads from Bitbucket and Jira (Phase 11), and what people decide about writing to
// them (Phase 13). No route here takes a write to send: a write is made by NooblyJS from its own facts (a handoff, a
// run, a merge) and goes through the write gate. People can see the outbox, switch a system between Record only and
// Send, set a kind's rule, and send or discard an entry that is waiting. Those four are an Owner's.
import { HttpError } from '../util/errors.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const STATUS = { 'not-configured': 503, unauthorised: 502, scope: 403, 'not-found': 404, 'rate-limited': 429, unreachable: 502, refused: 400, failed: 502 };

/** A connector's refusal as an API error, in words that say which tool and why. */
function fail(tool, r) {
  const scope = r.scope ? ` (it needs ${r.scope})` : '';
  const message = r.reason === 'scope' ? `NooblyJS's ${tool} token cannot read this${scope}.` : r.message;
  return new HttpError(STATUS[r.reason] ?? 502, `${tool.toLowerCase()}_${String(r.reason).replace(/-/g, '_')}`, message, { tool, reason: r.reason, ...(r.scope ? { scope: r.scope } : {}) });
}

export function devtoolsRoutes({ express, devtools, auditLog, events, requireSignIn, requireRole }) {
  const router = express.Router();
  const read = [requireSignIn, requireRole('read')];
  const fresh = (req) => ({ fresh: req.query.fresh === '1' });

  router.get('/api/v1/devtools/status', ...read, wrap(async (req, res) => {
    res.json({ ...await devtools.status(fresh(req)), config: await devtools.config() });
  }));

  // Which Bitbucket projects and repositories are imported and which Jira projects are searched. Owners only.
  router.patch('/api/v1/devtools/config', requireSignIn, requireRole('change-repo-access'), wrap(async (req, res) => {
    res.locals.audit = { action: 'devtools.config_changed', target: 'config/devtools.yaml' };
    const { before, after } = await devtools.setConfig(req.body ?? {});
    Object.assign(res.locals.audit, { from: before, to: after });
    await events.emit('devtools.config_changed', {
      system: 'platform',
      summary: `changed what NooblyJS reads: Jira ${after.jira.projects.join(', ') || 'nothing'}; Bitbucket ${[...after.bitbucket.projects, ...after.bitbucket.repositories].join(', ') || 'nothing'}`,
    }, { actor: req.person.id });
    res.json({ config: after });
  }));

  // Jira projects the account can see, to choose from when configuring.
  router.get('/api/v1/devtools/jira/projects', requireSignIn, requireRole('change-repo-access'), wrap(async (req, res) => {
    const r = await devtools.jira.projects({ q: String(req.query.q ?? ''), limit: 20 });
    if (!r.ok) throw fail('Jira', r);
    res.json({ total: r.total, projects: r.projects });
  }));

  // Issues in the configured projects: ?q= text, ?project=, ?type=Story&type=Task, ?open=1, ?keys=DTE-1,DTE-2.
  router.get('/api/v1/devtools/jira/issues', ...read, wrap(async (req, res) => {
    const keys = String(req.query.keys ?? '').split(',').map((k) => k.trim()).filter(Boolean).slice(0, 100);
    const r = keys.length ? await devtools.jira.issues(keys, fresh(req)) : await devtools.jira.search({
      text: String(req.query.q ?? '').slice(0, 200),
      project: req.query.project ? String(req.query.project) : null,
      types: [].concat(req.query.type ?? []).map(String).slice(0, 10),
      open: req.query.open === '1',
      limit: Number(req.query.limit) || 20,
    }, fresh(req));
    if (!r.ok) throw fail('Jira', r);
    res.json({ issues: r.issues, more: r.more === true });
  }));

  router.get('/api/v1/devtools/jira/issues/:key', ...read, wrap(async (req, res) => {
    const r = await devtools.jira.issue(req.params.key, fresh(req));
    if (!r.ok) throw fail('Jira', r);
    res.json({ issue: r.issue });
  }));

  // Jira issues linked to an item, an idea or a work item. NooblyJS keeps the link; Jira is only read.
  router.get('/api/v1/devtools/links/:target', ...read, wrap(async (req, res) => {
    res.json(await devtools.links.linked(req.params.target, fresh(req)));
  }));

  router.post('/api/v1/devtools/links/:target', requireSignIn, requireRole('draft'), wrap(async (req, res) => {
    res.locals.audit = { action: 'jira.issue_linked', target: req.params.target, issue: String(req.body?.key ?? '').toUpperCase() };
    const { added, issue } = await devtools.links.link(req.params.target, req.body?.key, req.person);
    if (added) {
      await events.emit('jira.issue_linked', { itemId: req.params.target, issue: issue.key, system: 'lifecycle', summary: `linked ${issue.key} · ${issue.summary} to ${req.params.target}` }, { actor: req.person.id });
    }
    res.status(added ? 201 : 200).json({ added, issue, ...(await devtools.links.linked(req.params.target)) });
  }));

  router.delete('/api/v1/devtools/links/:target/:key', requireSignIn, requireRole('draft'), wrap(async (req, res) => {
    res.locals.audit = { action: 'jira.issue_unlinked', target: req.params.target, issue: String(req.params.key).toUpperCase() };
    const { removed } = await devtools.links.unlink(req.params.target, req.params.key);
    if (removed) await events.emit('jira.issue_unlinked', { itemId: req.params.target, issue: String(req.params.key).toUpperCase(), system: 'lifecycle', summary: `unlinked ${String(req.params.key).toUpperCase()} from ${req.params.target}` }, { actor: req.person.id });
    res.json({ removed, ...(await devtools.links.linked(req.params.target)) });
  }));

  // ---------- writes (Phase 13) ----------
  const owner = [requireSignIn, requireRole('change-guardrails')];

  // How writing is set, and the outbox: ?state=recorded&system=jira&itemId=PRD-031
  router.get('/api/v1/devtools/writes', ...read, wrap(async (req, res) => {
    const filter = { state: req.query.state ? String(req.query.state) : null, system: req.query.system ? String(req.query.system) : null, itemId: req.query.itemId ? String(req.query.itemId) : null, limit: Number(req.query.limit) || 50 };
    res.json({ ...await devtools.writes.status(), outbox: await devtools.writes.outbox(filter) });
  }));

  // Record only ↔ Send, for Jira or Bitbucket. Sending also needs DEVTOOLS_WRITES=true and a write credential.
  router.patch('/api/v1/devtools/writes/mode', ...owner, wrap(async (req, res) => {
    res.locals.audit = { action: 'devtools.write_mode_change', target: String(req.body?.system ?? '') };
    res.json(await devtools.writes.setMode(String(req.body?.system ?? ''), String(req.body?.mode ?? ''), req.person));
  }));

  // A kind's rule: automatic, approval (an Approver decides each one) or off.
  router.patch('/api/v1/devtools/writes/rules', ...owner, wrap(async (req, res) => {
    res.locals.audit = { action: 'devtools.write_rule_change', target: String(req.body?.kind ?? '') };
    res.json(await devtools.writes.setRule(String(req.body?.kind ?? ''), String(req.body?.rule ?? ''), req.person));
  }));

  router.get('/api/v1/devtools/writes/:id', ...read, wrap(async (req, res) => {
    res.json({ write: await devtools.writes.get(req.params.id) });
  }));

  // Send a recorded or failed write now. Refused (409) while a lock is closed: nothing is sent.
  router.post('/api/v1/devtools/writes/:id/send', ...owner, wrap(async (req, res) => {
    res.locals.audit = { action: 'devtools.write_send', target: req.params.id };
    const r = await devtools.writes.retry(req.params.id, req.person);
    if (!r.ok) throw new HttpError(502, 'write_failed', `It could not be sent: ${r.message}`);
    res.json({ state: r.state, write: await devtools.writes.get(req.params.id) });
  }));

  router.post('/api/v1/devtools/writes/:id/discard', ...owner, wrap(async (req, res) => {
    res.locals.audit = { action: 'devtools.write_discard', target: req.params.id };
    await devtools.writes.discard(req.params.id, req.person);
    res.json({ write: await devtools.writes.get(req.params.id) });
  }));

  // Read the linked Jira issues and the open pull requests now (the timer does this every few minutes).
  router.post('/api/v1/devtools/sync', requireSignIn, requireRole('draft'), wrap(async (req, res) => {
    res.locals.audit = { action: 'devtools.sync_requested', target: 'devtools' };
    devtools.forget();
    res.json(await devtools.sync.poll());
  }));

  // An item's work items, each with its Jira issue, its pull request, and what NooblyJS wrote or would write.
  router.get('/api/v1/devtools/work/:itemId', ...read, wrap(async (req, res) => {
    res.json(await devtools.sync.workFor(req.params.itemId));
  }));

  // A repository NooblyJS sees, live from Bitbucket: branches, the latest commits and open pull requests.
  router.get('/api/v1/devtools/bitbucket/repositories/:slug', ...read, wrap(async (req, res) => {
    const r = await devtools.repository(req.params.slug, fresh(req));
    if (!r.ok) throw fail('Bitbucket', r);
    res.json(r);
  }));

  return router;
}
