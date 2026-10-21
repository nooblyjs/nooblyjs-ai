// Phase 16d: the Test section's API, mounted at <mountPath>/api/v1. Signed in only; reads need `read`, writes `draft`
// (a test analyst's work). Marking a case ready is a person's: an agent is refused in the service, and audited. The
// host audits every write.
import { apiNotFound, apiErrors } from './util/errors.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApi({ host, log, analysis, about }) {
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

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
