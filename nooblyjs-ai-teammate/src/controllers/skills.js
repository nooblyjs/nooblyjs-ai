// The shared skill library, and saved hire drafts.
import { HttpError } from '../utils/errors.js';
import { recorder } from '../utils/request.js';

export function skillsController({ team, repos, audit }) {
  const record = recorder(audit);
  return {
    async create(req, res) {
      const skill = await team.createSkill(req.body ?? {});
      await record(req, 'skill.create', skill.id);
      res.status(201).json(skill);
    },
    async show(req, res) {
      res.json(await team.skill(req.params.id));
    },
    async update(req, res) {
      const skill = await team.updateSkill(req.params.id, req.body ?? {});
      await record(req, 'skill.update', skill.id, { fields: Object.keys(req.body ?? {}) });
      res.json(skill);
    },

    async saveDraft(req, res) {
      res.status(201).json(await repos.drafts.save(req.body ?? {}));
    },
    async draft(req, res) {
      const draft = await repos.drafts.get(req.params.id);
      if (!draft) throw new HttpError(404, 'not_found', 'Draft not found');
      res.json(draft);
    },
  };
}
