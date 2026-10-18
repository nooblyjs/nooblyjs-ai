// The API router, mounted at <mountPath>/api/v1 (noobly structure.md §2a). Signed in only, every write audited, and every
// answer (including unknown routes and errors) in the one error shape. Reads need the `read` permission; who may
// change what depends on the apply rules, so the services check that and record every refusal.
import { KINDS, isKind } from '../util/ids.js';
import { apiNotFound, apiErrors, forbidden, badRequest } from '../util/errors.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Other apps this one talks to. Any may be missing (standalone, or not started), so /about says which. */
const PARTNERS = ['workflows', 'product', 'factory', 'teammates'];

export function createApi({ host, log, about, seed, designs, environments, runs, drift, policies, cost, summary }) {
  const api = host.express.Router();
  api.use(host.auth);
  // NooblyJS audits every write app-wide and its host.audit passes through; the stand-in host records here.
  api.use((req, res, next) => (READS.has(req.method) ? next() : host.audit(req, res, next)));
  api.use(host.requireRole('read'));

  const kindOf = (req, fallback = 'test') => {
    const kind = req.query.kind ?? fallback;
    if (!isKind(kind)) throw badRequest(`kind must be one of ${KINDS.join(', ')}.`);
    return kind;
  };

  // ---------- system ----------
  api.get('/about', (req, res) => {
    // Resolved per request, not at register(): the other apps may mount after this one.
    res.json({ ...about, connected: Object.fromEntries(PARTNERS.map((name) => [name, Boolean(host.service(name))])) });
  });
  api.get('/summary', async (req, res) => res.json(await summary.summary()));
  // Rewrites data/infrastructure/ with the seed story. Owner only, and never in production.
  api.post('/seed', host.requireRole('change-guardrails'), async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw forbidden('Resetting to the seed story is not allowed in production.');
    const result = await seed({ reset: req.body?.reset === true });
    res.status(result.seeded ? 201 : 200).json(result);
  });

  // ---------- environments ----------
  api.get('/environments', async (req, res) => {
    const { kind, product } = req.query;
    if (kind !== undefined && !isKind(kind)) throw badRequest(`kind must be one of ${KINDS.join(', ')}.`);
    res.json({ environments: await environments.list({ kind, product }) });
  });
  api.post('/environments', async (req, res) => res.status(201).json(await environments.create(req.body ?? {}, req.person)));
  api.get('/environments/:name', async (req, res) => res.json(await environments.get(req.params.name)));
  api.post('/environments/:name/destroy', async (req, res) => res.json(await environments.destroy(req.params.name, req.body ?? {}, req.person)));
  api.post('/environments/:name/drift-check', host.requireRole('draft'), async (req, res) => res.json(await drift.check(req.params.name, req.person)));
  api.get('/promotion-paths/:product', async (req, res) => res.json(await environments.promotionPath(req.params.product)));

  // ---------- designs ----------
  api.get('/designs', async (req, res) => res.json({ designs: await designs.list(req.person) }));
  api.get('/designs/:id', async (req, res) => {
    const design = await designs.detail(req.params.id, kindOf(req), req.person);
    res.set('ETag', design.etag).json(design);
  });
  api.get('/designs/:id/versions', async (req, res) => res.json({ versions: await designs.versions(req.params.id) }));
  api.post('/designs/:id/decision', async (req, res) => {
    res.json(await designs.decide(req.params.id, req.body ?? {}, req.person, req.get('if-match')));
  });

  // ---------- runs and drift ----------
  api.get('/runs', async (req, res) => res.json({ runs: await runs.list({ status: req.query.status, environment: req.query.environment }) }));
  api.get('/runs/:id', async (req, res) => res.json(await runs.get(req.params.id)));
  api.post('/runs/:id/cancel', async (req, res) => res.json({ run: await runs.cancel(req.params.id, req.person) }));
  api.get('/drift', async (req, res) => res.json({ drift: await drift.list({ status: req.query.status }) }));
  api.post('/drift/:id/restore', async (req, res) => res.status(202).json(await drift.restore(req.params.id, req.person)));
  api.post('/drift/:id/keep', async (req, res) => res.json(await drift.keep(req.params.id, req.person)));

  // ---------- govern ----------
  api.get('/blueprints', async (req, res) => res.json({ blueprints: await policies.blueprints() }));
  api.get('/policies', async (req, res) => res.json({ policies: await policies.list() }));
  api.put('/policies/:id', async (req, res) => res.json(await policies.set(req.params.id, req.body ?? {}, req.person)));
  api.get('/cost', async (req, res) => {
    const { month } = req.query;
    if (month !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('month looks like 2026-10.');
    res.json(await cost.month(month));
  });

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
