// Phase 16d: the Test section's API, mounted at <mountPath>/api/v1. Signed in only; reads need `read`, writes `draft`
// (a test analyst's work). Marking a case ready is a person's: an agent is refused in the service, and audited. The
// host audits every write. Phase 20: test runs, coverage and defects (deciding a defect is a person's: the lifecycle
// engine checks who).
import { apiNotFound, apiErrors } from './util/errors.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApi({ host, log, analysis, runs, coverage, defects, envRuns, about }) {
  const api = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  api.use(host.auth);
  api.use((req, res, next) => (READS.has(req.method) ? next() : host.audit(req, res, next)));

  api.get('/about', read, (req, res) => res.json(about));
  api.get('/policy', read, asyncRoute(async (req, res) => res.json(await analysis.policy())));
  api.get('/stories', read, asyncRoute(async (req, res) => res.json({ stories: await analysis.stories() })));
  api.get('/stories/:id', read, asyncRoute(async (req, res) => res.json(await analysis.view(req.params.id))));
  api.post('/stories/:id/draft', draft, asyncRoute(async (req, res) => res.json(await analysis.draft(req.params.id, req.person))));
  api.post('/stories/:id/cases', draft, asyncRoute(async (req, res) => res.status(201).json(await analysis.addCase(req.params.id, req.body, req.person))));
  api.patch('/stories/:id/cases/:caseId', draft, asyncRoute(async (req, res) => res.json(await analysis.editCase(req.params.id, req.params.caseId, req.body, req.person))));
  api.delete('/stories/:id/cases/:caseId', draft, asyncRoute(async (req, res) => res.json(await analysis.removeCase(req.params.id, req.params.caseId, req.person))));
  api.post('/stories/:id/cases/:caseId/ready', draft, asyncRoute(async (req, res) => res.json(await analysis.markReady(req.params.id, req.params.caseId, req.person))));

  // Phase 20: test runs (the line's, at the Build level), coverage and defects.
  api.get('/test-runs', read, asyncRoute(async (req, res) => res.json({ testRuns: await runs.list({ storyId: req.query.storyId ?? null, itemId: req.query.itemId ?? null }) })));
  api.get('/test-runs/:id', read, asyncRoute(async (req, res) => res.json(await runs.get(req.params.id))));
  api.post('/test-runs/:id/defects', draft, asyncRoute(async (req, res) => res.status(201).json(await defects.raiseFromRun(req.params.id, req.body, req.person))));
  api.post('/stories/:id/defects', draft, asyncRoute(async (req, res) => res.status(201).json(await defects.raiseOnStory(req.params.id, req.body, req.person))));
  api.get('/defects', read, asyncRoute(async (req, res) => res.json({ defects: await defects.list({ itemId: req.query.itemId ?? null, storyId: req.query.storyId ?? null, state: req.query.state ?? null }) })));
  api.get('/defects/:id', read, asyncRoute(async (req, res) => res.json(await defects.one(req.params.id))));
  api.post('/defects/:id/decision', draft, asyncRoute(async (req, res) => res.json(await defects.decide(req.params.id, req.body, req.person))));
  api.get('/coverage', read, asyncRoute(async (req, res) => res.json({ items: await coverage.all() })));
  api.get('/coverage/:itemId', read, asyncRoute(async (req, res) => {
    const found = await coverage.coverageOf(req.params.itemId);
    if (!found) return res.status(404).json({ error: { code: 'not_found', message: `There is no item ${req.params.itemId}.` } });
    res.json(found);
  }));

  // Phase 21: an environment's suites, run now (a person with draft), and the environment runs.
  api.post('/environments/:name/runs', draft, asyncRoute(async (req, res) => res.status(201).json(await envRuns.runEnvironment({ environment: req.params.name, storyIds: Array.isArray(req.body?.storyIds) ? req.body.storyIds.map(String).slice(0, 50) : null, actor: req.person }))));
  api.get('/environment-runs', read, asyncRoute(async (req, res) => res.json({ testRuns: await envRuns.environmentRuns({ environment: req.query.environment ?? null, prId: req.query.prId ?? null }) })));

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
