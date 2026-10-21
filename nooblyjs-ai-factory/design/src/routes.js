// Phase 16c: the Design section's API, mounted at <mountPath>/api/v1. Signed in only; reads need `read`, writes
// `draft`, accepting a business requirement `accept-requirement`, and a story's Design handoff is the lifecycle engine's
// decision (it checks the person). The host audits every write; agents are refused every acceptance and handoff here
// as well as in the services, and the refusal is audited.
import { apiNotFound, apiErrors } from './util/errors.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApi({ host, log, design, catalogue, drafter, about }) {
  const api = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  api.use(host.auth);
  api.use((req, res, next) => (READS.has(req.method) ? next() : host.audit(req, res, next)));

  api.get('/about', read, (req, res) => res.json(about));
  api.get('/catalogue', read, asyncRoute(async (req, res) => res.json(await catalogue.read())));
  api.get('/drafters', read, asyncRoute(async (req, res) => res.json(await drafter.all())));
  api.get('/items', read, asyncRoute(async (req, res) => res.json({ items: await design.items() })));
  api.get('/items/:id', read, asyncRoute(async (req, res) => res.json(await design.view(req.params.id))));

  // NooblyJS Phase 19: ask Security's agent for the item's threat model (Security checks the person and records it).
  api.post('/items/:id/threat-model', draft, asyncRoute(async (req, res) => {
    const security = host.service?.('security');
    if (typeof security?.draftThreatModel !== 'function') return res.status(503).json({ error: { code: 'security_unavailable', message: 'The Security app is not running here, so no threat model can be drafted.' } });
    res.status(201).json(await security.draftThreatModel({ itemId: req.params.id, actor: req.person }));
  }));
  api.post('/items/:id/draft/:part', draft, asyncRoute(async (req, res) => res.json(await design.draft(req.params.id, req.params.part, req.person))));

  api.post('/items/:id/requirements/:brId/accept', host.requireRole('accept-requirement'), asyncRoute(async (req, res) => {
    res.json(await design.acceptRequirement(req.params.id, req.params.brId, req.person));
  }));
  api.patch('/items/:id/requirements/:brId', draft, asyncRoute(async (req, res) => res.json(await design.editRequirement(req.params.id, req.params.brId, req.body, req.person))));

  api.put('/items/:id/systems', draft, asyncRoute(async (req, res) => res.json(await design.setSystems(req.params.id, req.body, req.person))));

  api.post('/items/:id/interfaces', draft, asyncRoute(async (req, res) => res.status(201).json(await design.addInterface(req.params.id, req.body, req.person))));
  api.patch('/items/:id/interfaces/:ifId', draft, asyncRoute(async (req, res) => res.json(await design.updateInterface(req.params.id, req.params.ifId, req.body, req.person))));
  api.delete('/items/:id/interfaces/:ifId', draft, asyncRoute(async (req, res) => res.json(await design.removeInterface(req.params.id, req.params.ifId, req.person))));

  api.patch('/items/:id/features/:featureId', draft, asyncRoute(async (req, res) => res.json(await design.updateFeature(req.params.id, req.params.featureId, req.body, req.person))));

  api.post('/items/:id/stories/merge', draft, asyncRoute(async (req, res) => res.json(await design.mergeStories(req.params.id, req.body, req.person))));
  // NooblyJS Phase 20: one acceptance criterion of a story changes (with a reason), also after its handoff.
  api.patch('/items/:id/stories/:storyId/criteria/:n', draft, asyncRoute(async (req, res) => res.json(await design.changeCriterion(req.params.id, req.params.storyId, req.params.n, req.body, req.person))));
  api.patch('/items/:id/stories/:storyId', draft, asyncRoute(async (req, res) => res.json(await design.updateStory(req.params.id, req.params.storyId, req.body, req.person))));
  api.post('/items/:id/stories/:storyId/split', draft, asyncRoute(async (req, res) => res.json(await design.splitStory(req.params.id, req.params.storyId, req.body, req.person))));
  // The lifecycle engine decides who may give it (any person but a Viewer; never an agent).
  api.post('/items/:id/stories/:storyId/handoff', read, asyncRoute(async (req, res) => {
    res.locals.audit = { action: 'design.story_handed_off', target: req.params.storyId, itemId: req.params.id, override: req.body?.override?.reason ?? null };
    res.json(await design.handoff(req.params.id, req.params.storyId, req.body, req.person));
  }));

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
