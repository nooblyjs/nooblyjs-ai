// Stage 3 · UX design: GET /ux (the items with UX work), the journey, flows, research, open questions, and the
// design agent's drafts (journey, flow, quick test).
import { etagOf } from '../util/http.js';
import { draftHandler } from './drafts.js';

export function uxRoutes({ host, ux, drafting, kindKeys, mountPath }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const ifMatch = (req) => ({ ifMatch: req.get('if-match') });

  router.get('/ux', read, async (req, res) => {
    res.json({ items: await ux.items() });
  });

  router.get('/ux/:itemId/journey', read, async (req, res) => {
    const j = await ux.journey(req.params.itemId);
    res.set('ETag', etagOf(j)).json(j);
  });

  router.put('/ux/:itemId/journey', draft, async (req, res) => {
    const j = await ux.saveJourney(req.params.itemId, req.body, req.person, ifMatch(req));
    res.set('ETag', etagOf(j)).json(j);
  });

  router.get('/ux/:itemId/flows', read, async (req, res) => {
    res.json({ flows: await ux.flows(req.params.itemId) });
  });

  router.get('/ux/:itemId/flows/:flow', read, async (req, res) => {
    const f = await ux.flow(req.params.itemId, req.params.flow);
    res.set('ETag', f.etag).json(f);
  });

  router.put('/ux/:itemId/flows/:flow', draft, async (req, res) => {
    const f = await ux.saveFlow(req.params.itemId, req.params.flow, req.body, req.person, ifMatch(req));
    res.set('ETag', f.etag).json(f);
  });

  router.get('/ux/:itemId/research', read, async (req, res) => {
    res.json(await ux.research(req.params.itemId));
  });

  router.put('/ux/:itemId/research', draft, async (req, res) => {
    res.json(await ux.saveResearch(req.params.itemId, req.body, req.person));
  });

  router.get('/ux/:itemId/questions', read, async (req, res) => {
    const q = await ux.questions(req.params.itemId);
    res.set('ETag', etagOf(q)).json(q);
  });

  router.put('/ux/:itemId/questions', draft, async (req, res) => {
    const q = await ux.saveQuestions(req.params.itemId, req.body, req.person, ifMatch(req));
    res.set('ETag', etagOf(q)).json(q);
  });

  router.post('/ux/:itemId/drafts', draft, draftHandler(drafting, kindKeys, mountPath));

  return router;
}
