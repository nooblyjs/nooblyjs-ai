// Billing: the timesheet view and its CSV, the token view, cap/budget alerts, and month close with its invoices.
import { offsetOf, recorder } from '../utils/request.js';

export function billingController({ team, billing, alerts, audit }) {
  const record = recorder(audit);
  return {
    async view(req, res) {
      res.json(await team.billing(req.query.period ?? 'month', offsetOf(req.query)));
    },
    async exportCsv(req, res) {
      const { filename, csv } = await team.exportCsv(req.query.period ?? 'month', offsetOf(req.query));
      res.set('Content-Type', 'text/csv; charset=utf-8').attachment(filename).send(csv);
    },
    async tokens(req, res) {
      res.json(await billing.tokens(req.query.period ?? 'month', offsetOf(req.query)));
    },
    async alerts(req, res) {
      res.json(await alerts.current());
    },

    // Month close & invoices
    async closePreview(req, res) {
      res.json(await billing.closePreview(req.query.month));
    },
    async closeMonth(req, res) {
      const { invoice, regenerated } = await billing.closeMonth(req.body?.month, { excludePending: req.body?.excludePending === true });
      await record(req, regenerated ? 'invoice.regenerate' : 'invoice.create', invoice.id, { month: invoice.month, amount: invoice.amount, entries: invoice.entries, excludedPending: invoice.excludedPending?.count });
      res.status(regenerated ? 200 : 201).json(invoice);
    },
    async invoice(req, res) {
      res.json(await billing.invoice(req.params.id));
    },
    async setInvoiceStatus(req, res) {
      const invoice = await billing.setInvoiceStatus(req.params.id, req.body?.status);
      await record(req, invoice.status === 'paid' ? 'invoice.paid' : 'invoice.reopen', invoice.id, { amount: invoice.amount });
      res.json(invoice);
    },
    async invoiceCsv(req, res) {
      const { filename, csv } = await billing.invoiceCsv(req.params.id);
      res.set('Content-Type', 'text/csv; charset=utf-8').attachment(filename).send(csv);
    },
    async invoicePdf(req, res) {
      const { filename, pdf } = await billing.invoicePdf(req.params.id);
      res.set('Content-Type', 'application/pdf').attachment(filename).send(pdf);
    },
  };
}
