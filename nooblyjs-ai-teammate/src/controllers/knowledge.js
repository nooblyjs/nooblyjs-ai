// Knowledge documents a teammate retrieves from when working.
import { recorder } from '../utils/request.js';

export function knowledgeController({ team, audit }) {
  const record = recorder(audit);
  return {
    async list(req, res) {
      res.json({ docs: await team.knowledge(req.params.id) });
    },
    async create(req, res) {
      const doc = await team.addKnowledge(req.params.id, req.body ?? {});
      await record(req, 'knowledge.create', req.params.id, { doc: doc.id, title: doc.title, project: doc.project, chars: doc.chars });
      res.status(201).json(doc);
    },
    async show(req, res) {
      res.json(await team.knowledgeDoc(req.params.id, req.params.docId));
    },
    async update(req, res) {
      const doc = await team.updateKnowledge(req.params.id, req.params.docId, req.body ?? {});
      await record(req, 'knowledge.update', req.params.id, { doc: doc.id, fields: Object.keys(req.body ?? {}) });
      res.json(doc);
    },
    async remove(req, res) {
      const doc = await team.removeKnowledge(req.params.id, req.params.docId);
      await record(req, 'knowledge.delete', req.params.id, { doc: doc.id, title: doc.title });
      res.status(204).end();
    },
  };
}
