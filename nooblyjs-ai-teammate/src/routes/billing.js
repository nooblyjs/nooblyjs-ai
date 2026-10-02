// Owner-only billing administration: month close and invoices, task approvals, cap/budget alerts,
// the token view of billing, settings, and models & pricing.
import express from 'express';
import { requireRole, requireUser } from '../middleware/auth.js';
import { WEBHOOK_EVENTS } from '../services/webhooks.js';

export function billingRouter({ billing, invocation, alerts, webhooks, audit }) {
  const r = express.Router();
  // Mounted on /api next to the main router, so only guard our own paths (API keys still reach the task routes).
  r.use(['/billing/tokens', '/alerts', '/invoices', '/approvals', '/settings', '/models', '/webhooks'], requireUser);
  const owner = requireRole('owner');
  const manager = requireRole('manager');
  const record = (req, action, target, detail) => audit.record(req.actor, action, target, detail);
  const offsetOf = (q) => Math.max(-120, Math.min(120, Number.parseInt(q.offset ?? '0', 10) || 0));

  r.get('/billing/tokens', async (req, res) => res.json(await billing.tokens(req.query.period ?? 'month', offsetOf(req.query))));
  r.get('/alerts', async (req, res) => res.json(await alerts.current()));

  // Month close & invoices
  r.get('/invoices/close-preview', async (req, res) => res.json(await billing.closePreview(req.query.month)));
  r.post('/invoices', owner, async (req, res) => {
    const { invoice, regenerated } = await billing.closeMonth(req.body?.month, { excludePending: req.body?.excludePending === true });
    await record(req, regenerated ? 'invoice.regenerate' : 'invoice.create', invoice.id, { month: invoice.month, amount: invoice.amount, entries: invoice.entries, excludedPending: invoice.excludedPending?.count });
    res.status(regenerated ? 200 : 201).json(invoice);
  });
  r.get('/invoices/:id', async (req, res) => res.json(await billing.invoice(req.params.id)));
  r.patch('/invoices/:id', owner, async (req, res) => {
    const invoice = await billing.setInvoiceStatus(req.params.id, req.body?.status);
    await record(req, invoice.status === 'paid' ? 'invoice.paid' : 'invoice.reopen', invoice.id, { amount: invoice.amount });
    res.json(invoice);
  });
  r.get('/invoices/:id/csv', async (req, res) => {
    const { filename, csv } = await billing.invoiceCsv(req.params.id);
    res.set('Content-Type', 'text/csv; charset=utf-8').attachment(filename).send(csv);
  });
  r.get('/invoices/:id/pdf', async (req, res) => {
    const { filename, pdf } = await billing.invoicePdf(req.params.id);
    res.set('Content-Type', 'application/pdf').attachment(filename).send(pdf);
  });

  // Tasks waiting for approval (estimated over a teammate's approval threshold)
  r.get('/approvals', async (req, res) => {
    const status = ['pending', 'approved', 'declined'].includes(req.query.status) ? req.query.status : undefined;
    res.json({ approvals: await invocation.repos.approvals.list({ status }) });
  });
  r.post('/approvals/:id/approve', manager, async (req, res) => {
    const approval = await invocation.approve(req.params.id, req.actor);
    await record(req, 'approval.approve', approval.teammateId, { work: approval.id, estimate: approval.estimate?.amount });
    res.status(202).json(approval);
  });
  r.post('/approvals/:id/decline', manager, async (req, res) => {
    const approval = await invocation.decline(req.params.id, req.actor, req.body?.reason);
    await record(req, 'approval.decline', approval.teammateId, { work: approval.id, reason: approval.reason });
    res.json(approval);
  });

  // Settings: budgets, cost centres, owner, billing conversion, alerts
  r.get('/settings', owner, async (req, res) => res.json(await billing.settings()));
  r.patch('/settings', owner, async (req, res) => {
    const { settings, changed } = await billing.updateSettings(req.body ?? {});
    await record(req, 'settings.update', 'settings', { fields: changed });
    res.json(settings);
  });

  // Webhooks: endpoints subscribed to events, each with its own signing secret (shown once)
  r.get('/webhooks', owner, async (req, res) => res.json({ endpoints: await webhooks.list(), events: WEBHOOK_EVENTS }));
  r.post('/webhooks', owner, async (req, res) => {
    const created = await webhooks.create(req.body ?? {});
    await record(req, 'webhook.create', created.endpoint.id, { name: created.endpoint.name, events: created.endpoint.events });
    res.status(201).json(created);
  });
  r.patch('/webhooks/:id', owner, async (req, res) => {
    const endpoint = await webhooks.edit(req.params.id, req.body ?? {});
    await record(req, 'webhook.update', endpoint.id, { fields: Object.keys(req.body ?? {}) });
    res.json(endpoint);
  });
  r.delete('/webhooks/:id', owner, async (req, res) => {
    const endpoint = await webhooks.remove(req.params.id);
    await record(req, 'webhook.delete', endpoint.id, { name: endpoint.name });
    res.status(204).end();
  });
  r.post('/webhooks/:id/test', owner, async (req, res) => res.json(await webhooks.test(req.params.id)));

  // Models & pricing
  r.get('/models', async (req, res) => res.json({ models: await billing.models() }));
  r.patch('/models/:id', owner, async (req, res) => {
    const model = await billing.updateModel(req.params.id, req.body ?? {});
    await record(req, 'model.update', model.id, { fields: Object.keys(req.body ?? {}) });
    res.json(model);
  });

  return r;
}
