// Stage 4 · UI design: GET /ui (items), screens per device, design-system reuse, accessibility checks, the handoff
// preview and plan, Send to Software Factory (people only, passed to the NooblyJS lifecycle engine), and the UI agent's drafts.
import { peopleOnly, etagOf } from '../util/http.js';
import { draftHandler } from './drafts.js';

export function uiRoutes({ host, ui, drafting, kindKeys, mountPath }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const ifMatch = (req) => ({ ifMatch: req.get('if-match') });

  router.get('/ui', read, async (req, res) => {
    res.json({ items: await ui.items() });
  });

  router.get('/ui/:itemId', read, async (req, res) => {
    res.json(await ui.overview(req.params.itemId));
  });

  router.get('/ui/:itemId/screens', read, async (req, res) => {
    const device = typeof req.query.device === 'string' ? req.query.device : undefined;
    res.json(await ui.screens(req.params.itemId, { device }));
  });

  router.put('/ui/:itemId/screens/:screen', draft, async (req, res) => {
    const s = await ui.saveScreen(req.params.itemId, req.params.screen, req.body, req.person, ifMatch(req));
    res.set('ETag', s.etag).json(s);
  });

  router.get('/ui/:itemId/design-system', read, async (req, res) => {
    res.json(await ui.designSystem(req.params.itemId));
  });

  router.get('/ui/:itemId/accessibility-checks', read, async (req, res) => {
    res.json(await ui.accessibility(req.params.itemId));
  });

  router.get('/ui/:itemId/handoff-preview', read, async (req, res) => {
    const h = await ui.handoffPreview(req.params.itemId);
    res.set('ETag', etagOf({ id: `${req.params.itemId}.handoff`, version: h.version })).json(h);
  });

  router.put('/ui/:itemId/handoff-preview', draft, async (req, res) => {
    const h = await ui.saveHandoffPlan(req.params.itemId, req.body, req.person, ifMatch(req));
    res.set('ETag', etagOf({ id: `${req.params.itemId}.handoff`, version: h.version })).json(h);
  });

  // The UI handoff is an approval rule (Design lead): Approvers and up, people only.
  router.post('/ui/:itemId/handoff', host.requireRole('approve'), peopleOnly(host, 'send work to the Software Factory'), async (req, res) => {
    res.status(202).json(await ui.sendToFactory(req.params.itemId, req.body, req.person));
  });

  router.post('/ui/:itemId/drafts', draft, draftHandler(drafting, kindKeys, mountPath));

  return router;
}
