// Billing administration: month close and invoices, task approvals, cap/budget alerts, the token view of billing,
// settings, webhooks, and models & pricing.
import { requireRole, requireUser } from '../middleware/auth.js';
import { billingController } from '../controllers/billing.js';
import { approvalsController } from '../controllers/approvals.js';
import { settingsController } from '../controllers/settings.js';
import { webhooksController } from '../controllers/webhooks.js';

export function billingRouter({ express, team, billing, invocation, alerts, webhooks, audit }) {
  const r = express.Router();
  // Mounted on /api next to the main router, so only guard our own paths (API keys still reach the task routes).
  r.use(['/billing', '/alerts', '/invoices', '/approvals', '/settings', '/models', '/webhooks'], requireUser);
  const owner = requireRole('owner');
  const manager = requireRole('manager');
  const bill = billingController({ team, billing, alerts, audit });
  const approvals = approvalsController({ invocation, team, audit });
  const settings = settingsController({ billing, audit });
  const hooks = webhooksController({ webhooks, audit });

  r.get('/billing', bill.view);
  r.get('/billing/export.csv', bill.exportCsv);
  r.get('/billing/tokens', bill.tokens);
  r.get('/alerts', bill.alerts);

  // Month close & invoices
  r.get('/invoices/close-preview', bill.closePreview);
  r.post('/invoices', owner, bill.closeMonth);
  r.get('/invoices/:id', bill.invoice);
  r.patch('/invoices/:id', owner, bill.setInvoiceStatus);
  r.get('/invoices/:id/csv', bill.invoiceCsv);
  r.get('/invoices/:id/pdf', bill.invoicePdf);

  // Tasks waiting for approval (estimated over a teammate's approval threshold)
  r.get('/approvals', approvals.list);
  r.post('/approvals/:id/approve', manager, approvals.approve);
  r.post('/approvals/:id/decline', manager, approvals.decline);

  r.get('/settings', owner, settings.show);
  r.patch('/settings', owner, settings.update);

  r.get('/webhooks', owner, hooks.list);
  r.post('/webhooks', owner, hooks.create);
  r.patch('/webhooks/:id', owner, hooks.update);
  r.delete('/webhooks/:id', owner, hooks.remove);
  r.post('/webhooks/:id/test', owner, hooks.test);

  r.get('/models', settings.models);
  r.get('/models/available', owner, settings.availableModels);
  r.post('/models', owner, settings.addModel);
  r.patch('/models/:id', owner, settings.updateModel);
  r.delete('/models/:id', owner, settings.removeModel);

  return r;
}
