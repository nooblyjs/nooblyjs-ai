// Settings (budgets, cost centres, owner, billing conversion, alerts) and models & pricing.
import { recorder } from '../utils/request.js';

export function settingsController({ billing, audit }) {
  const record = recorder(audit);
  return {
    async show(req, res) {
      res.json(await billing.settings());
    },
    async update(req, res) {
      const { settings, changed } = await billing.updateSettings(req.body ?? {});
      await record(req, 'settings.update', 'settings', { fields: changed });
      res.json(settings);
    },
    async models(req, res) {
      res.json({ models: await billing.models() });
    },
    async availableModels(req, res) {
      res.json(await billing.availableModels({ refresh: req.query.refresh === '1' }));
    },
    async addModel(req, res) {
      const model = await billing.addModel(req.body ?? {});
      await audit?.record?.(req, 'model.added', { model: model.id, provider: model.provider, modelId: model.modelId, tier: model.tier, priceSource: model.priceSource });
      res.status(201).json(model);
    },
    async removeModel(req, res) {
      const result = await billing.removeModel(req.params.id);
      await audit?.record?.(req, 'model.removed', { model: req.params.id });
      res.json(result);
    },
    async updateModel(req, res) {
      const model = await billing.updateModel(req.params.id, req.body ?? {});
      await record(req, 'model.update', model.id, { fields: Object.keys(req.body ?? {}) });
      res.json(model);
    },
  };
}
