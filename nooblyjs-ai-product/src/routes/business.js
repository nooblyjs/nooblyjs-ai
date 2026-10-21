// NooblyJS Phase 17: the work hierarchy, business cases and accepting an idea.
//   GET  /hierarchy                       portfolio epics, epics and features, each with where it sits
//   POST /catalogue/epics                 { kind: portfolio-epic | epic, name, portfolio, valueStream?, parent? } (draft)
//   POST /catalogue/features              { name, epic } (draft)
//   GET  /business-cases/:id              an idea's or epic's business case, with what is missing in words
//   PUT  /business-cases/:id              a person's edit (draft; agents refused)
//   POST /business-cases/:id/draft        an agent drafts it, with the estimate from the factory's history (draft)
//   POST /ideas/:id/accept                { override? }: the Discover exit, a person's; the lifecycle engine checks
//                                         the business case ("Business case complete") and the person
import { HttpError } from '../util/errors.js';
import { isAgent } from '../util/http.js';

export function businessRoutes({ host, hierarchy, businessCases, ideas, repos }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');

  router.get('/hierarchy', read, async (req, res) => res.json(await hierarchy.view()));

  router.post('/catalogue/epics', draft, async (req, res) => {
    const { kind, name, portfolio, valueStream, parent } = req.body ?? {};
    res.status(201).json({ epic: await hierarchy.addEpic({ kind, name, portfolio, valueStream, parent }, req.person), hierarchy: await hierarchy.view() });
  });

  router.post('/catalogue/features', draft, async (req, res) => {
    const { name, epic } = req.body ?? {};
    res.status(201).json({ feature: await hierarchy.addFeature({ name, epic }, req.person), hierarchy: await hierarchy.view() });
  });

  router.get('/business-cases/:id', read, async (req, res) => res.json(await businessCases.get(req.params.id)));
  router.put('/business-cases/:id', draft, async (req, res) => res.json(await businessCases.save(req.params.id, req.body, req.person)));
  router.post('/business-cases/:id/draft', draft, async (req, res) => res.json(await businessCases.draft(req.params.id, req.person)));

  router.post('/ideas/:id/accept', draft, async (req, res) => {
    if (isAgent(req.person)) throw new HttpError(403, 'people_only', 'Agents propose and people decide: an agent can\'t accept an idea.');
    const idea = await repos.ideas.get(req.params.id);
    if (!idea) throw new HttpError(404, 'not_found', `There is no idea ${req.params.id}.`);
    const workflows = host.service?.('workflows');
    if (typeof workflows?.acceptIdea !== 'function') throw new HttpError(503, 'unavailable', 'The lifecycle engine is not running here, so an idea can\'t be accepted.');
    const reason = typeof req.body?.override?.reason === 'string' ? req.body.override.reason.trim().slice(0, 500) : '';
    const result = await workflows.acceptIdea({ itemId: idea.id, title: idea.title, actor: req.person, ...(reason ? { override: { reason } } : {}) });
    if (result.outcome === 'approved') await ideas.markAccepted(idea.id, req.person);
    res.json({ outcome: result.outcome, text: result.text, item: { id: result.item?.id, stage: result.item?.stage } });
  });

  return router;
}
