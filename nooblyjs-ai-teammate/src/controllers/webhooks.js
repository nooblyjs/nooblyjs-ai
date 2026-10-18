// Webhooks: endpoints subscribed to events, each with its own signing secret (shown once).
import { WEBHOOK_EVENTS } from '../services/webhooks.js';
import { recorder } from '../utils/request.js';

export function webhooksController({ webhooks, audit }) {
  const record = recorder(audit);
  return {
    async list(req, res) {
      res.json({ endpoints: await webhooks.list(), events: WEBHOOK_EVENTS });
    },
    async create(req, res) {
      const created = await webhooks.create(req.body ?? {});
      await record(req, 'webhook.create', created.endpoint.id, { name: created.endpoint.name, events: created.endpoint.events });
      res.status(201).json(created);
    },
    async update(req, res) {
      const endpoint = await webhooks.edit(req.params.id, req.body ?? {});
      await record(req, 'webhook.update', endpoint.id, { fields: Object.keys(req.body ?? {}) });
      res.json(endpoint);
    },
    async remove(req, res) {
      const endpoint = await webhooks.remove(req.params.id);
      await record(req, 'webhook.delete', endpoint.id, { name: endpoint.name });
      res.status(204).end();
    },
    async test(req, res) {
      res.json(await webhooks.test(req.params.id));
    },
  };
}
