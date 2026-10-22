// The API router, mounted at <mountPath>/api/v1 (noobly structure.md §2a). Signed in only, every write audited, and every
// answer (including unknown routes and errors) in the one error shape. Role checks are per route.
import { systemRoutes } from './system.js';
import { boardRoutes } from './board.js';
import { specRoutes } from './specs.js';
import { draftRoutes } from './drafts.js';
import { architectureRoutes } from './architecture.js';
import { uxRoutes } from './ux.js';
import { uiRoutes } from './ui.js';
import { flowRoutes } from './flow.js';
import { strategyRoutes } from './strategy.js';
import { businessRoutes } from './business.js';
import { elicitationRoutes } from './elicitation.js';
import { feedbackRoutes } from './feedback.js';
import { apiNotFound, apiErrors } from '../util/errors.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApi({ host, log, about, seed, repos, people, catalogue, documents, templates, ideas, hierarchy = null, businessCases = null, elicitation = null, specWrites, drafting, summary, architecture, ux, ui, flow, kindKeys, mountPath, stageAgents = null, feedback = null, portal = null }) {
  const api = host.express.Router();
  api.use(host.auth);
  // NooblyJS audits every write app-wide and its host.audit passes through; the stand-in host records here.
  api.use((req, res, next) => (READS.has(req.method) ? next() : host.audit(req, res, next)));

  api.use(systemRoutes({ host, about, seed, summary }));
  api.use(boardRoutes({ host, repos, people, ideas, catalogue }));
  api.use(strategyRoutes({ host, repos, people, catalogue, documents, templates }));
  // NooblyJS Phase 17: the work hierarchy, business cases, accepting an idea.
  if (hierarchy && businessCases) api.use(businessRoutes({ host, hierarchy, businessCases, ideas, repos }));
  // NooblyJS Phase 18: requirements elicitation.
  if (elicitation) api.use(elicitationRoutes({ host, elicitation }));
  // NooblyJS Phase 25a: feedback notes, the feedback form's links, and the ideas portal.
  if (feedback && portal) api.use(feedbackRoutes({ host, repos, people, feedback, portal, mountPath }));
  api.use(specRoutes({ host, repos, people, specWrites, stageAgents, elicitation }));
  // Who drafts each stage: a hired teammate. GET for the screens; PUT /drafters/:stage { teammateId } (draft).
  if (stageAgents) {
    api.get('/drafters', host.requireRole('read'), async (req, res) => res.json(await stageAgents.all()));
    api.put('/drafters/:stage', host.requireRole('draft'), async (req, res) => {
      res.json(await stageAgents.assign(req.params.stage, req.body?.teammateId, req.person));
    });
  }
  api.use(draftRoutes({ host, repos, drafting, specKindKeys: kindKeys.spec, mountPath }));
  api.use(architectureRoutes({ host, architecture, drafting, kindKeys: kindKeys.architecture, mountPath }));
  api.use(uxRoutes({ host, ux, drafting, kindKeys: kindKeys.ux, mountPath }));
  api.use(uiRoutes({ host, ui, drafting, kindKeys: kindKeys.ui, mountPath }));
  api.use(flowRoutes({ host, flow }));

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
