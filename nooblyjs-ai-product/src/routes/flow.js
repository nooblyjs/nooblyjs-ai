// Flow across the stages: GET /handoffs (the history), GET /metrics, GET /waiting (what is waiting on you), and
// POST /specs/:id/send-back (people only, passed to the NooblyJS lifecycle engine).
import { peopleOnly } from '../util/http.js';

export function flowRoutes({ host, flow }) {
  const router = host.express.Router();
  const read = host.requireRole('read');

  router.get('/handoffs', read, async (req, res) => {
    const kind = ['handoff', 'sent-back'].includes(req.query.kind) ? req.query.kind : undefined;
    res.json({ handoffs: await flow.handoffs({ kind }) });
  });

  router.get('/metrics', read, async (req, res) => {
    res.json(await flow.metrics());
  });

  router.get('/waiting', read, async (req, res) => {
    res.json({ rows: await flow.waitingFor(req.person) });
  });

  router.post('/specs/:id/send-back', host.requireRole('approve'), peopleOnly(host, 'send an item back'), async (req, res) => {
    res.status(202).json(await flow.sendBack(req.params.id, req.body, req.person));
  });

  return router;
}
