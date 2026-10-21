// The API router, mounted at <mountPath>/api/v1 (noobly structure.md §2a). Signed in only, every write audited, and every
// answer (including unknown routes and errors) in the one error shape. Reads need `read`; the services check what each
// action needs (draft to make a release and ask for its approval; deploy-production, people only, to move or roll it;
// draft, people only, to declare, resolve and review incidents).
import { apiNotFound, apiErrors, forbidden } from '../util/errors.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Other apps this one talks to. Any may be missing (standalone, or not started), so /about says which. */
const PARTNERS = ['workflows', 'infrastructure', 'security', 'quality', 'teammates', 'devtools'];

export function createApi({ host, log, about, seed, releases, policies, summary, slos, incidents, outcomes }) {
  const api = host.express.Router();
  api.use(host.auth);
  api.use((req, res, next) => (READS.has(req.method) ? next() : host.audit(req, res, next)));
  api.use(host.requireRole('read'));

  api.get('/about', (req, res) => {
    res.json({ ...about, connected: Object.fromEntries(PARTNERS.map((name) => [name, Boolean(host.service(name))])) });
  });
  api.get('/summary', async (req, res) => res.json(await summary.status()));
  // Rewrites data/operations/ with the seed. Owner only, and never in production.
  api.post('/seed', host.requireRole('change-guardrails'), async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw forbidden('Resetting to the seed is not allowed in production.');
    const result = await seed({ reset: req.body?.reset === true });
    res.status(result.seeded ? 201 : 200).json(result);
  });

  api.get('/releases', async (req, res) => res.json({ releases: await releases.list() }));
  api.post('/releases', async (req, res) => res.status(201).json(await releases.create(req.body ?? {}, req.person)));
  api.get('/releases/:id', async (req, res) => res.json(await releases.get(req.params.id)));
  api.post('/releases/:id/approval', async (req, res) => res.json(await releases.requestApproval(req.params.id, req.person)));
  api.post('/releases/:id/advance', async (req, res) => res.json(await releases.advance(req.params.id, req.person)));
  api.post('/releases/:id/rollback', async (req, res) => res.json(await releases.rollback(req.params.id, req.body ?? {}, req.person)));
  api.get('/deployments', async (req, res) => res.json({ deployments: await releases.deployments() }));
  api.get('/policies', async (req, res) => res.json(await policies.view()));

  // Phase 23: SLOs (burning one by hand is the mock monitor's, for development), incidents, outcome reviews.
  api.get('/slos', async (req, res) => res.json({ slos: await slos.list({ itemId: req.query.itemId }) }));
  api.get('/slos/:id', async (req, res) => res.json(await slos.get(req.params.id)));
  api.post('/slos/:id/burn', host.requireRole('draft'), async (req, res) => res.json(await slos.burn(req.params.id, req.body?.minutes)));
  api.post('/slos/:id/incident', async (req, res) => res.status(201).json(await incidents.declare({ ...(req.body ?? {}), sloId: req.params.id }, req.person)));
  api.get('/incidents', async (req, res) => res.json({ incidents: await incidents.list() }));
  api.post('/incidents', async (req, res) => res.status(201).json(await incidents.declare(req.body ?? {}, req.person)));
  api.get('/incidents/:id', async (req, res) => res.json(await incidents.get(req.params.id)));
  api.post('/incidents/:id/notes', async (req, res) => res.json(await incidents.note(req.params.id, req.body ?? {}, req.person)));
  api.post('/incidents/:id/resolve', async (req, res) => res.json(await incidents.resolve(req.params.id, req.body ?? {}, req.person)));
  api.post('/incidents/:id/review', async (req, res) => res.json(await incidents.acceptReview(req.params.id, req.body ?? {}, req.person)));
  api.post('/incidents/:id/follow-ups', async (req, res) => res.status(201).json(await incidents.followUp(req.params.id, req.body ?? {}, req.person)));
  api.get('/outcome-reviews', async (req, res) => res.json({ outcomeReviews: await outcomes.list() }));
  api.get('/outcome-reviews/:id', async (req, res) => res.json(await outcomes.view(req.params.id)));
  api.post('/outcome-reviews/:id/idea', async (req, res) => res.status(201).json(await outcomes.openIdea(req.params.id, req.body ?? {}, req.person)));

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
