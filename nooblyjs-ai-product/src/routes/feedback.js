// NooblyJS Phase 25a: Product · Feedback and Product · Ideas portal.
//   GET  /feedback/notes            the inbox (?portfolio, valueStream, product, source, unlinked, signal)
//   POST /feedback/notes            log a note (draft)
//   POST /feedback/notes/:id/insights            link a snippet to an idea, feature or spec (draft, people only)
//   DELETE /feedback/notes/:id/insights/:insight  unlink it (draft, people only)
//   PUT  /feedback/notes/:id/signal              the signal it belongs to, or a new one (draft)
//   POST /feedback/suggest          Ada suggests where the unlinked notes belong (draft; a teammate task)
//   POST /feedback/notes/:id/suggestions/:sid/decision   accept or decline one (draft, people only)
//   GET  /feedback/importance?ids=  customer importance by id
//   GET  /signals/:id/notes         a signal's notes
//   GET|POST /feedback/links, PATCH /feedback/links/:id   the feedback form's links (draft)
//   GET  /feedback/home             the PM's home rows
//   GET  /portal/ideas, POST /portal/ideas, …/votes, …/comments, …/follow (suggest, people only); …/merge, …/promote (draft, people only)
import { viewContext } from '../services/views.js';
import { peopleOnly } from '../util/http.js';

const one = (v, max = 64) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const truthy = (v) => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());

export function feedbackRoutes({ host, repos, people, feedback, portal, mountPath }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const suggest = host.requireRole('suggest');
  const person = (action) => peopleOnly(host, action);

  // ---------- the inbox ----------
  router.get('/feedback/notes', read, async (req, res) => {
    const q = req.query;
    res.json(await feedback.list({ portfolio: one(q.portfolio), valueStream: one(q.valueStream), product: one(q.product), source: one(q.source), unlinked: truthy(q.unlinked), signal: one(q.signal) }));
  });
  router.post('/feedback/notes', draft, async (req, res) => {
    res.status(201).json(await feedback.log(req.body ?? {}, req.person));
  });
  router.post('/feedback/notes/:id/insights', draft, person('decide what feedback is evidence for'), async (req, res) => {
    res.status(201).json(await feedback.link(req.params.id, req.body ?? {}, req.person));
  });
  router.delete('/feedback/notes/:id/insights/:insight', draft, person('unlink feedback'), async (req, res) => {
    res.json(await feedback.unlink(req.params.id, req.params.insight, req.person));
  });
  router.put('/feedback/notes/:id/signal', draft, async (req, res) => {
    res.json(await feedback.setSignal(req.params.id, req.body ?? {}, req.person));
  });
  router.post('/feedback/suggest', draft, async (req, res) => {
    res.json(await feedback.suggest(req.person));
  });
  router.post('/feedback/notes/:id/suggestions/:sid/decision', draft, person("accept an agent's suggestion"), async (req, res) => {
    res.json(await feedback.decide(req.params.id, req.params.sid, req.body ?? {}, req.person));
  });
  router.get('/feedback/importance', read, async (req, res) => {
    const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
    res.json(await feedback.importance(ids));
  });
  router.get('/signals/:id/notes', read, async (req, res) => {
    res.json(await feedback.signalNotes(req.params.id));
  });
  router.get('/feedback/home', read, async (req, res) => res.json(await feedback.home()));

  // ---------- the feedback form's links ----------
  router.get('/feedback/links', draft, async (req, res) => res.json({ links: await feedback.links(mountPath) }));
  router.post('/feedback/links', draft, person('make a feedback link'), async (req, res) => {
    res.status(201).json(await feedback.createLink(req.body ?? {}, req.person, mountPath));
  });
  router.patch('/feedback/links/:id', draft, person('change a feedback link'), async (req, res) => {
    res.json(await feedback.changeLink(req.params.id, req.body ?? {}, req.person, mountPath));
  });

  // ---------- the ideas portal ----------
  const ctxFor = (req) => viewContext({ people, repos }, req.person);
  router.get('/portal/ideas', read, async (req, res) => {
    res.json(await portal.list(await ctxFor(req), { portfolio: one(req.query.portfolio), product: one(req.query.product), status: one(req.query.status) }));
  });
  router.post('/portal/ideas', suggest, person('put an idea forward'), async (req, res) => {
    res.status(201).json(await portal.submit(req.body ?? {}, req.person));
  });
  router.post('/portal/ideas/:id/votes', suggest, person('vote'), async (req, res) => {
    res.status(201).json(await portal.vote(req.params.id, req.body ?? {}, req.person));
  });
  router.delete('/portal/ideas/:id/votes/:vote', suggest, person('vote'), async (req, res) => {
    res.json(await portal.unvote(req.params.id, req.params.vote, req.person));
  });
  router.post('/portal/ideas/:id/comments', suggest, person('comment in the ideas portal'), async (req, res) => {
    res.status(201).json(await portal.comment(req.params.id, req.body ?? {}, req.person));
  });
  router.put('/portal/ideas/:id/follow', suggest, person('follow an idea'), async (req, res) => res.json(await portal.follow(req.params.id, true, req.person)));
  router.delete('/portal/ideas/:id/follow', suggest, person('follow an idea'), async (req, res) => res.json(await portal.follow(req.params.id, false, req.person)));
  router.post('/portal/ideas/:id/merge', draft, person('merge ideas'), async (req, res) => {
    res.json(await portal.merge(req.params.id, String(req.body?.into ?? ''), req.person));
  });
  router.post('/portal/ideas/:id/promote', draft, person('put an idea on the board'), async (req, res) => {
    res.json(await portal.promote(req.params.id, req.person));
  });

  return router;
}
