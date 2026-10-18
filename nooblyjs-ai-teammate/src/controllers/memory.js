// Memory: each teammate's own, and the shared team memory (teammates in "team" memory mode read and add to it).
import { recorder } from '../utils/request.js';

export function memoryController({ team, audit }) {
  const record = recorder(audit);
  return {
    async list(req, res) {
      res.json({ items: await team.memory(req.params.id) });
    },
    async reset(req, res) {
      await team.resetMemory(req.params.id);
      await record(req, 'memory.reset', req.params.id);
      res.status(204).end();
    },
    async remove(req, res) {
      await team.deleteMemory(req.params.id, req.params.memoryId);
      await record(req, 'memory.delete', req.params.id, { memory: req.params.memoryId });
      res.status(204).end();
    },
    async pin(req, res) {
      const item = await team.pinMemory(req.params.id, req.params.memoryId, req.body?.pinned);
      await record(req, item.pinned ? 'memory.pin' : 'memory.unpin', req.params.id, { memory: item.id });
      res.json(item);
    },

    async teamMemory(req, res) {
      res.json(await team.teamMemory());
    },
    async pinTeamMemory(req, res) {
      const item = await team.pinTeamMemory(req.params.memoryId, req.body?.pinned);
      await record(req, item.pinned ? 'memory.pin' : 'memory.unpin', 'team-memory', { memory: item.id });
      res.json(item);
    },
    async removeTeamMemory(req, res) {
      await team.deleteTeamMemory(req.params.memoryId);
      await record(req, 'memory.delete', 'team-memory', { memory: req.params.memoryId });
      res.status(204).end();
    },
  };
}
