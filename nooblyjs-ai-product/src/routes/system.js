// About this engine, and resetting the seed story. The API areas (board, specs, architecture, …) get their own
// files from P1 on (structure.md §2).
import { forbidden } from '../util/errors.js';

/** The other apps this engine calls. Any of them may be missing (standalone, or not started), so say which. */
const PARTNERS = ['workflows', 'teammates', 'knowledge'];

export function systemRoutes({ host, about, seed, summary }) {
  const router = host.express.Router();

  router.get('/about', host.requireRole('read'), (req, res) => {
    // Resolved per request, not at register(): the other apps may mount after this one.
    const connected = Object.fromEntries(PARTNERS.map((name) => [name, Boolean(host.service(name))]));
    res.json({ ...about, connected });
  });

  /** Agents on duty and this month's spend against the budget (the Overview page and the status card). */
  router.get('/summary', host.requireRole('read'), async (req, res) => {
    res.json(await summary.summary(req.person));
  });

  // Rewrites data/product/ with the seed story. Owner only, because it removes everything people have written
  // here, and never in production.
  router.post('/seed', host.requireRole('change-guardrails'), async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw forbidden('Resetting to the seed story is not allowed in production.');
    const reset = req.body?.reset === true;
    const result = await seed({ reset });
    await host.events.emit('product.seeded', { story: result.story, reset }, { actor: req.person.id });
    res.status(result.seeded ? 201 : 200).json(result);
  });

  return router;
}
