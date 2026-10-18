// /api/v1/chat: threads, messages and cards (tech.md §7.2). Reading needs `read`, posting needs `draft`. A card's
// decision is checked in the service against the card's own permission, and an agent is always refused there.
// Every write is audited by the host; res.locals.audit names the action and what it was about.
export function chatRoutes({ express, chat, requireSignIn, requireRole }) {
  const router = express.Router();
  const read = [requireSignIn, requireRole('read')];
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
    // A refusal keeps the action the route named and adds why (the audit record is written when the answer has gone).
    if (err?.status === 403) res.locals.audit = { ...(res.locals.audit ?? {}), action: 'access.refused', attempted: res.locals.audit?.action ?? null, code: err.code, permission: err.details?.permission, reason: err.message };
    next(err);
  });

  router.get('/api/v1/chat/thread', ...read, wrap(async (req, res) => {
    res.json(await chat.thread(String(req.query.kind ?? ''), String(req.query.id ?? ''), req.person));
  }));

  router.post('/api/v1/chat/threads/:id/messages', requireSignIn, requireRole('draft'), wrap(async (req, res) => {
    res.locals.audit = { action: 'chat.message_posted', target: req.params.id };
    const message = await chat.post(req.params.id, req.body, req.person);
    res.locals.audit.messageId = message.id;
    res.status(201).json({ message });
  }));

  router.post('/api/v1/chat/threads/:id/actions', ...read, wrap(async (req, res) => {
    res.locals.audit = { action: 'chat.action', target: req.params.id, which: req.body?.action ?? null };
    res.status(201).json({ message: await chat.action(req.params.id, req.body, req.person) });
  }));

  router.post('/api/v1/chat/cards/:id/decision', requireSignIn, wrap(async (req, res) => {
    res.locals.audit = { action: 'chat.card_decided', target: req.params.id, decision: req.body?.decision ?? null };
    const result = await chat.decideCard(req.params.id, req.body, req.person);
    Object.assign(res.locals.audit, { itemId: result.card.itemId, requires: result.card.requires, resource: result.card.resource, requestedBy: result.card.requestedBy.id });
    res.json(result);
  }));

  router.post('/api/v1/chat/cards/:id/apply', requireSignIn, wrap(async (req, res) => {
    res.locals.audit = { action: 'chat.card_applied', target: req.params.id };
    const result = await chat.applyCard(req.params.id, req.person);
    Object.assign(res.locals.audit, { itemId: result.card.itemId, version: result.version });
    res.json(result);
  }));

  return router;
}
