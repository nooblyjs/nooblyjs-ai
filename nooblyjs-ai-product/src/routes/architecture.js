// Stage 2 · Architecture: GET /architecture (the items in the stage), the container view as code, ADRs (accept is
// people only, with accept-decisions), the standards check, quality attributes, and Rhea Voss's drafts.
import { peopleOnly, etagOf } from '../util/http.js';
import { draftHandler } from './drafts.js';

export function architectureRoutes({ host, architecture, drafting, kindKeys, mountPath }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const ifMatch = (req) => ({ ifMatch: req.get('if-match') });

  router.get('/architecture', read, async (req, res) => {
    res.json({ items: await architecture.items() });
  });

  // Knowledge the item is built with: files and folders from the Knowledge Repository, each with a person's note.
  router.get('/architecture/:itemId/knowledge', read, async (req, res) => {
    res.json(await architecture.knowledgeLinks(req.params.itemId));
  });

  router.get('/architecture/:itemId/knowledge/search', read, async (req, res) => {
    res.json(await architecture.searchKnowledge(req.params.itemId, req.query.q));
  });

  router.post('/architecture/:itemId/knowledge', draft, peopleOnly(host, 'link knowledge to an item'), async (req, res) => {
    res.status(201).json(await architecture.addKnowledge(req.params.itemId, req.body, req.person));
  });

  router.patch('/architecture/:itemId/knowledge/:linkId', draft, peopleOnly(host, 'change a knowledge link'), async (req, res) => {
    res.json(await architecture.noteKnowledge(req.params.itemId, req.params.linkId, req.body, req.person));
  });

  router.delete('/architecture/:itemId/knowledge/:linkId', draft, peopleOnly(host, 'remove a knowledge link'), async (req, res) => {
    res.json(await architecture.removeKnowledge(req.params.itemId, req.params.linkId, req.person));
  });

  // Where the item is built (NooblyJS Phase 11): its repositories, confirmed or narrowed by a person.
  router.get('/architecture/:itemId/repositories', read, async (req, res) => {
    res.json(await architecture.repositories(req.params.itemId));
  });

  router.put('/architecture/:itemId/repositories', draft, peopleOnly(host, 'choose where an item is built'), async (req, res) => {
    res.json(await architecture.setRepositories(req.params.itemId, req.body, req.person));
  });

  router.get('/architecture/:itemId/diagram', read, async (req, res) => {
    const d = await architecture.diagram(req.params.itemId);
    res.set('ETag', etagOf(d)).json(d);
  });

  router.put('/architecture/:itemId/diagram', draft, async (req, res) => {
    const d = await architecture.saveDiagram(req.params.itemId, req.body, req.person, ifMatch(req));
    res.set('ETag', etagOf(d)).json(d);
  });

  router.get('/architecture/:itemId/adrs', read, async (req, res) => {
    res.json({ adrs: await architecture.adrs(req.params.itemId) });
  });

  router.post('/architecture/:itemId/adrs', draft, async (req, res) => {
    res.status(201).json(await architecture.proposeAdr(req.params.itemId, req.body, req.person));
  });

  router.post('/adrs/:id/accept', host.requireRole('accept-decisions'), peopleOnly(host, 'accept an architecture decision'), async (req, res) => {
    res.json(await architecture.acceptAdr(req.params.id, req.person));
  });

  router.post('/adrs/:id/discuss', draft, async (req, res) => {
    res.json(await architecture.discussAdr(req.params.id, req.body, req.person));
  });

  router.get('/architecture/:itemId/standards-check', read, async (req, res) => {
    res.json(await architecture.standardsCheck(req.params.itemId));
  });

  router.get('/architecture/:itemId/quality-attributes', read, async (req, res) => {
    const q = await architecture.qualityAttributes(req.params.itemId);
    res.set('ETag', etagOf(q)).json(q);
  });

  router.put('/architecture/:itemId/quality-attributes', draft, async (req, res) => {
    const q = await architecture.saveQualityAttributes(req.params.itemId, req.body, req.person, ifMatch(req));
    res.set('ETag', etagOf(q)).json(q);
  });

  router.post('/architecture/:itemId/drafts', draft, draftHandler(drafting, kindKeys, mountPath));

  return router;
}
