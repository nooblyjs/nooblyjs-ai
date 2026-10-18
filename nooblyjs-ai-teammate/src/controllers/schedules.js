// Scheduled tasks: a teammate runs a task on chosen days at a set time.
import { recorder } from '../utils/request.js';

export function schedulesController({ scheduler, audit }) {
  const record = recorder(audit);
  return {
    async list(req, res) {
      res.json({ schedules: await scheduler.list({ teammateId: req.query.teammate || undefined }) });
    },
    async create(req, res) {
      const s = await scheduler.create(req.body ?? {}, req.actor);
      await record(req, 'schedule.create', s.teammateId, { schedule: s.id, name: s.name, cadence: s.cadenceLabel });
      res.status(201).json(s);
    },
    async update(req, res) {
      const s = await scheduler.update(req.params.id, req.body ?? {});
      await record(req, 'schedule.update', s.teammateId, { schedule: s.id, fields: Object.keys(req.body ?? {}) });
      res.json(s);
    },
    async remove(req, res) {
      const s = await scheduler.remove(req.params.id);
      await record(req, 'schedule.delete', s.teammateId, { schedule: s.id, name: s.name });
      res.status(204).end();
    },
    async runNow(req, res) {
      const s = await scheduler.runNow(req.params.id);
      await record(req, 'schedule.run', s.teammateId, { schedule: s.id });
      res.status(202).json(s);
    },
  };
}
