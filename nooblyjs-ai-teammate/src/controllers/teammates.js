// Teammates: the roster, hiring, profiles and their config, skills on a teammate, logged work, the workspace
// metadata the pages start from, and the work timeline.
import { HttpError, badRequest } from '../utils/errors.js';
import { recorder } from '../utils/request.js';

export function teammatesController({ team, repos, audit }) {
  const record = recorder(audit);
  return {
    async meta(req, res) {
      res.json(await team.meta());
    },
    async roster(req, res) {
      res.json(await team.roster());
    },
    async hire(req, res) {
      const t = await team.hire(req.body ?? {});
      await record(req, 'teammate.hire', t.id, { name: t.name, model: t.model, rate: t.rate });
      res.status(201).json(t);
    },
    async profile(req, res) {
      res.json(await team.profile(req.params.id));
    },
    async update(req, res) {
      const t = await team.update(req.params.id, req.body ?? {});
      const fields = Object.keys(req.body ?? {});
      const summary = Object.fromEntries(fields.filter((f) => !['instructions', 'about', 'avatar'].includes(f)).map((f) => [f, req.body[f]]));
      await record(req, fields.length === 1 && fields[0] === 'instructions' ? 'teammate.persona_edit' : 'teammate.update', t.id, { fields, ...summary });
      res.json(t);
    },
    async retire(req, res) {
      const t = await team.retire(req.params.id);
      await record(req, 'teammate.retire', t.id);
      res.json(t);
    },
    async reinstate(req, res) {
      const t = await team.reinstate(req.params.id);
      await record(req, 'teammate.reinstate', t.id);
      res.json(t);
    },
    async resetPersona(req, res) {
      const t = await team.resetPersona(req.params.id);
      await record(req, 'teammate.persona_reset', t.id);
      res.json(t);
    },

    async addSkill(req, res) {
      const t = await team.addSkill(req.params.id, req.body ?? {});
      await record(req, 'teammate.skill_add', t.id, { skill: req.body?.skillId ?? req.body?.name, level: req.body?.level });
      res.json(t);
    },
    async setSkillLevel(req, res) {
      const t = await team.setSkillLevel(req.params.id, req.params.skillId, req.body?.level);
      await record(req, 'teammate.skill_level', t.id, { skill: req.params.skillId, level: req.body?.level });
      res.json(t);
    },
    async removeSkill(req, res) {
      const t = await team.removeSkill(req.params.id, req.params.skillId);
      await record(req, 'teammate.skill_remove', t.id, { skill: req.params.skillId });
      res.json(t);
    },

    async workItem(req, res) {
      await team.teammateOr404(req.params.id);
      if (!/^wk_[\w]+$/.test(req.params.workId)) throw badRequest('Invalid work id');
      const work = await repos.work.get(req.params.id, req.params.workId);
      if (!work) throw new HttpError(404, 'not_found', 'Work item not found');
      res.json(work);
    },

    // Work timeline: tasks, handoffs and outcomes over time
    async timeline(req, res) {
      res.json(await team.timeline({ teammate: req.query.teammate || null, days: req.query.days }));
    },
  };
}
