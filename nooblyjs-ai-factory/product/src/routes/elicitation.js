// NooblyJS Phase 18: requirements elicitation for an item (services/elicitation.js).
//   GET  /elicitation/:id                                 stakeholders, sessions, candidates, requirements, the NFR walk, questions
//   POST /elicitation/:id/stakeholders                    { name, personId?, teamId?, role } (draft)
//   POST /elicitation/:id/sessions                        { kind, title, with, notes } (draft)
//   POST /elicitation/:id/candidates/draft                Ada drafts candidates from the notes (draft)
//   POST /elicitation/:id/candidates/:cid/accept|merge|reject   { into } · { reason } (accept-requirement; people only)
//   POST /elicitation/:id/requirements/:rid/criteria      { text } (draft)
//   PUT  /elicitation/:id/nfr/:category                   { answers: [{ text, target }] } or { notApplicable, reason } (draft)
//   POST /elicitation/:id/questions                       { text, owner, kind } (draft) · PUT …/questions/:qid { answer }
//   GET  /nfr-catalogue                                   the Design section's catalogue, with each category's prompt
import { peopleOnly } from '../util/http.js';

export function elicitationRoutes({ host, elicitation }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const decide = [host.requireRole('accept-requirement'), peopleOnly(host, 'decide a candidate requirement')];

  router.get('/elicitation/:id', read, async (req, res) => res.json(await elicitation.view(req.params.id)));
  router.post('/elicitation/:id/stakeholders', draft, async (req, res) => res.status(201).json(await elicitation.addStakeholder(req.params.id, req.body, req.person)));
  router.post('/elicitation/:id/sessions', draft, async (req, res) => res.status(201).json(await elicitation.addSession(req.params.id, req.body, req.person)));
  router.post('/elicitation/:id/candidates/draft', draft, async (req, res) => res.json({ candidates: await elicitation.draftCandidates(req.params.id, req.person) }));
  router.post('/elicitation/:id/candidates/:cid/accept', ...decide, async (req, res) => res.json(await elicitation.accept(req.params.id, req.params.cid, req.person, req.body ?? {})));
  router.post('/elicitation/:id/candidates/:cid/merge', ...decide, async (req, res) => res.json(await elicitation.merge(req.params.id, req.params.cid, req.body?.into, req.person)));
  router.post('/elicitation/:id/candidates/:cid/reject', ...decide, async (req, res) => res.json(await elicitation.reject(req.params.id, req.params.cid, req.body?.reason, req.person)));
  router.post('/elicitation/:id/requirements/:rid/criteria', draft, async (req, res) => res.status(201).json(await elicitation.addCriterion(req.params.id, req.params.rid, req.body, req.person)));
  router.put('/elicitation/:id/nfr/:category', draft, async (req, res) => res.json(await elicitation.walk(req.params.id, req.params.category, req.body, req.person)));
  router.post('/elicitation/:id/questions', draft, async (req, res) => res.status(201).json(await elicitation.addQuestion(req.params.id, req.body, req.person)));
  router.put('/elicitation/:id/questions/:qid', draft, async (req, res) => res.json(await elicitation.answerQuestion(req.params.id, req.params.qid, req.body, req.person)));
  router.get('/nfr-catalogue', read, async (req, res) => res.json({ categories: await elicitation.catalogue() }));
  return router;
}
