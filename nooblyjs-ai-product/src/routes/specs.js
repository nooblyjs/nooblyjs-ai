// Specs: GET /specs, /specs/:id, /specs/:id/versions; the Stage 1 writes POST /specs, PUT /specs/:id (If-Match),
// PUT /specs/:id/knowledge; and POST /specs/:id/decision, which only a person may make.
import { viewContext, specSummary } from '../services/views.js';
import { specDetail, specEtag, versionsView } from '../services/specs.js';
import { notFound } from '../util/errors.js';
import { peopleOnly } from '../util/http.js';

export function specRoutes({ host, repos, people, specWrites, stageAgents = null, elicitation = null }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const ctxFor = (req) => viewContext({ people, repos }, req.person);

  async function specOr404(id) {
    const spec = await repos.specs.get(id);
    if (!spec) throw notFound(`There is no spec ${id}.`);
    return spec;
  }

  /** The spec as the Spec screen shows it, with its ETag. */
  const sendSpec = async (req, res, status, spec) => {
    // Who would draft it now: a hired teammate, or nobody (with why). Older specs stored a fixed name.
    const drafter = stageAgents ? await stageAgents.forStage('product') : null;
    const current = drafter ? { ...spec, agent: drafter.teammate } : spec;
    // NooblyJS Phase 18: the spec reads its accepted requirements from its elicitation.
    const requirements = elicitation ? await elicitation.requirementsFor(spec.id).catch(() => []) : [];
    res.status(status).set('ETag', specEtag(spec)).json({ ...specDetail(await ctxFor(req), current), drafter, requirements });
  };

  router.get('/specs', read, async (req, res) => {
    const ctx = await ctxFor(req);
    const { status, product, portfolio } = req.query;
    const is = (a, b) => String(a ?? '').toLowerCase() === String(b).toLowerCase();
    const specs = (await repos.specs.list())
      .filter((s) => (typeof status !== 'string' || s.status === status)
        && (typeof product !== 'string' || is(s.product, product))
        && (typeof portfolio !== 'string' || is(ctx.products.get(String(s.product ?? '').toLowerCase()), portfolio)))
      .sort((a, b) => b.id.localeCompare(a.id, 'en', { numeric: true }));
    res.json({ specs: specs.map((s) => specSummary(ctx, s)) });
  });

  router.post('/specs', draft, async (req, res) => {
    await sendSpec(req, res, 201, await specWrites.create(req.body, req.person));
  });

  router.get('/specs/:id', read, async (req, res) => {
    await sendSpec(req, res, 200, await specOr404(req.params.id));
  });

  router.put('/specs/:id', draft, async (req, res) => {
    const { spec } = await specWrites.update(req.params.id, req.body, req.person, { ifMatch: req.get('if-match') });
    await sendSpec(req, res, 200, spec);
  });

  router.put('/specs/:id/knowledge', draft, async (req, res) => {
    await sendSpec(req, res, 200, await specWrites.setKnowledge(req.params.id, req.body, req.person, { ifMatch: req.get('if-match') }));
  });

  router.post('/specs/:id/review', draft, peopleOnly(host, 'send a spec for review'), async (req, res) => {
    await sendSpec(req, res, 200, await specWrites.requestReview(req.params.id, req.person));
  });

  router.post('/specs/:id/decision', host.requireRole('approve'), peopleOnly(host, 'approve a spec or request changes'), async (req, res) => {
    res.status(202).json(await specWrites.decide(req.params.id, req.body, req.person));
  });

  router.get('/specs/:id/versions', read, async (req, res) => {
    const spec = await specOr404(req.params.id);
    const earlier = await repos.specs.versions(spec.id);
    res.json({ id: spec.id, versions: versionsView(await ctxFor(req), spec, earlier) });
  });

  return router;
}
