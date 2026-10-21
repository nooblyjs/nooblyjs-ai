// The API router, mounted at <mountPath>/api/v1 (noobly structure.md §2a). Signed in only, every write audited, and every
// answer (including unknown routes and errors) in the one error shape. Reads need `read`; the services check what each
// action needs (draft to make a release and ask for its approval; deploy-production, people only, to move or roll it).
import { apiNotFound, apiErrors, forbidden } from '../util/errors.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Other apps this one talks to. Any may be missing (standalone, or not started), so /about says which. */
const PARTNERS = ['workflows', 'infrastructure', 'security', 'quality', 'teammates', 'devtools'];

export function createApi({ host, log, about, seed, releases, policies, summary }) {
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

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
