// The API, mounted at <mountPath>/api/v1 (NooblyJS tech.md §4.2). Signed in only. Reads need the "read" permission;
// decisions check the rule's permission in the engine (a hidden button is not a control). The host audits every
// write; res.locals.audit names the action and adds what the audit log should say about it.
import { apiNotFound, apiErrors } from './errors.js';

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApi({ host, log, engine, views, about }) {
  const api = host.express.Router();
  const read = host.requireRole('read');
  api.use(host.auth);
  api.use((req, res, next) => (['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? next() : host.audit(req, res, next)));

  api.get('/about', read, (req, res) => res.json(about));
  api.get('/rules', read, asyncRoute(async (req, res) => res.json(await views.rulesTable())));
  api.get('/overview', read, asyncRoute(async (req, res) => res.json(await views.overview(req.person))));
  api.get('/counts', read, asyncRoute(async (req, res) => res.json(await views.counts(req.person))));
  api.get('/flow', read, asyncRoute(async (req, res) => res.json(await views.flow())));
  api.get('/live', read, asyncRoute(async (req, res) => res.json({ agents: await views.live() })));

  api.get('/items', read, asyncRoute(async (req, res) => res.json(await views.lifecycle(req.person, { filter: String(req.query.filter ?? 'all') }))));
  api.get('/items/:id', read, asyncRoute(async (req, res) => res.json(await views.item(req.params.id, req.person))));
  api.post('/items/:id/send-back', asyncRoute(async (req, res) => {
    res.locals.audit = { action: 'item.sent_back', target: req.params.id, to: req.body?.to ?? null, reason: req.body?.reason ?? null };
    res.json(await engine.sendBack(req.params.id, req.body ?? {}, req.person));
  }));
  api.post('/items/:id/nudge', asyncRoute(async (req, res) => {
    res.locals.audit = { action: 'item.nudged', target: req.params.id };
    res.json(await engine.nudge(req.params.id, req.person));
  }));
  api.post('/items/:id/advance', asyncRoute(async (req, res) => {
    res.locals.audit = { action: 'item.advanced', target: req.params.id, override: req.body?.override?.reason ?? null };
    const result = await engine.advance(req.params.id, req.body ?? {}, req.person);
    res.locals.audit.outcome = result.outcome;
    res.json(result);
  }));

  api.get('/approvals', read, asyncRoute(async (req, res) => res.json(await views.approvals(req.person, { tab: String(req.query.tab ?? 'mine') }))));
  api.get('/approvals/:id', read, asyncRoute(async (req, res) => res.json(await views.approval(req.params.id, req.person))));
  api.post('/approvals/:id/decision', asyncRoute(async (req, res) => {
    const body = req.body ?? {};
    res.locals.audit = { action: 'approval.decided', target: req.params.id, decision: body.decision ?? null, comment: body.comment ?? null, override: body.override?.reason ?? null };
    const result = await engine.decideApproval(req.params.id, body, req.person);
    Object.assign(res.locals.audit, { itemId: result.approval.itemId, outcome: result.outcome });
    res.json(result);
  }));
  api.post('/approvals/:id/reassign', asyncRoute(async (req, res) => {
    res.locals.audit = { action: 'approval.reassigned', target: req.params.id, to: req.body?.to ?? null, reason: req.body?.reason ?? null };
    res.json(await engine.reassign(req.params.id, req.body ?? {}, req.person));
  }));

  api.use(apiNotFound);
  // A refusal keeps the action the route named and adds why, so the audit log says what was refused and the reason.
  api.use((err, req, res, next) => {
    if (err?.status === 403 || err?.status === 422) {
      res.locals.audit = { ...(res.locals.audit ?? {}), action: err.status === 403 ? 'access.refused' : 'rule.refused', attempted: res.locals.audit?.action ?? null, code: err.code, reason: err.message };
    }
    next(err);
  });
  api.use(apiErrors({ log }));
  return api;
}
