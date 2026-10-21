// The API router, mounted at <mountPath>/api/v1 (noobly structure.md §2a). Signed in only, every write audited, and every
// answer (including unknown routes and errors) in the one error shape. Reads need `read`; the services check what each
// decision needs (accept-threat-model, accept-risk, people only) and record every refusal.
import { apiNotFound, apiErrors, forbidden, badRequest } from '../util/errors.js';
import { SEVERITIES } from '../util/ids.js';

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const STATES = ['open', 'fixing', 'closed', 'accepted'];
/** Other apps this one talks to. Any may be missing (standalone, or not started), so /about says which. */
const PARTNERS = ['workflows', 'product', 'factory', 'teammates'];

export function createApi({ host, log, about, seed, threatModels, findings, scans, policies, summary }) {
  const api = host.express.Router();
  api.use(host.auth);
  // NooblyJS audits every write app-wide and its host.audit passes through; the stand-in host records here.
  api.use((req, res, next) => (READS.has(req.method) ? next() : host.audit(req, res, next)));
  api.use(host.requireRole('read'));

  // ---------- system ----------
  api.get('/about', (req, res) => {
    res.json({ ...about, connected: Object.fromEntries(PARTNERS.map((name) => [name, Boolean(host.service(name))])) });
  });
  api.get('/summary', async (req, res) => res.json(await summary.status()));
  // Rewrites data/security/ with the seed story. Owner only, and never in production.
  api.post('/seed', host.requireRole('change-guardrails'), async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw forbidden('Resetting to the seed story is not allowed in production.');
    const result = await seed({ reset: req.body?.reset === true });
    res.status(result.seeded ? 201 : 200).json(result);
  });

  // ---------- threat models ----------
  api.get('/threat-models', async (req, res) => res.json({ threatModels: await threatModels.list() }));
  api.post('/threat-models', async (req, res) => res.status(201).json(await threatModels.draft(req.body?.itemId, req.person)));
  api.get('/threat-models/:id', async (req, res) => res.json(await threatModels.get(req.params.id)));
  api.post('/threat-models/:id/decision', async (req, res) => res.json(await threatModels.decide(req.params.id, req.body ?? {}, req.person)));
  api.get('/items/:itemId/threat-model', async (req, res) => res.json({ threatModel: await threatModels.forItem(req.params.itemId) }));

  // ---------- findings and risks ----------
  api.get('/findings', async (req, res) => {
    const { state, itemId, repo, severity } = req.query;
    if (state !== undefined && !STATES.includes(state)) throw badRequest(`state is one of ${STATES.join(', ')}.`);
    if (severity !== undefined && !SEVERITIES.includes(severity)) throw badRequest(`severity is one of ${SEVERITIES.join(', ')}.`);
    const rows = await findings.list({ state, itemId, repo });
    res.json({ findings: severity ? rows.filter((f) => f.severity === severity) : rows });
  });
  api.get('/findings/:id', async (req, res) => res.json(await findings.get(req.params.id)));
  api.post('/findings/:id/fix', async (req, res) => res.status(202).json(await findings.fix(req.params.id, req.person)));
  api.post('/findings/:id/accept-risk', async (req, res) => res.json(await findings.acceptRisk(req.params.id, req.body ?? {}, req.person)));
  api.put('/findings/:id/owner', async (req, res) => res.json(await findings.setOwner(req.params.id, req.body ?? {}, req.person)));
  api.get('/risks', async (req, res) => res.json({ risks: await findings.risks() }));
  api.get('/scans', async (req, res) => res.json({ scans: await scans.recent({ repo: req.query.repo }) }));

  // ---------- policies ----------
  api.get('/policies', async (req, res) => res.json(await policies.view()));

  api.use(apiNotFound);
  api.use(apiErrors({ log }));
  return api;
}
