// Asking an agent to draft, and following the job: POST /specs/:id/drafts (and the other stages' draft routes,
// which share this handler), GET /drafts/:id, GET /drafts?itemId=. Progress also arrives as draft.progressed events.
import { draftView } from '../services/drafting.js';
import { notFound } from '../util/errors.js';

/**
 * The POST handler for one stage's drafts: `kinds` are the draft kinds that route offers.
 * Answers 202 with the job and where to follow it.
 */
export function draftHandler(drafting, kinds, mountPath) {
  return async (req, res) => {
    const draft = await drafting.request(req.params.id ?? req.params.itemId, req.body, req.person, kinds);
    res.status(202).set('Location', `${mountPath}/api/v1/drafts/${draft.id}`).json({ draftId: draft.id, ...draftView(draft) });
  };
}

export function draftRoutes({ host, repos, drafting, specKindKeys, mountPath }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');

  router.post('/specs/:id/drafts', draft, draftHandler(drafting, specKindKeys, mountPath));

  router.get('/drafts/:id', read, async (req, res) => {
    const job = await drafting.get(req.params.id);
    if (!job) throw notFound(`There is no draft ${req.params.id}.`);
    res.json(draftView(job));
  });

  router.get('/drafts', read, async (req, res) => {
    const { itemId, status } = req.query;
    const jobs = (await repos.drafts.list())
      .filter((d) => (typeof itemId !== 'string' || d.itemId === itemId) && (typeof status !== 'string' || d.status === status))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ drafts: jobs.map(draftView) });
  });

  return router;
}
