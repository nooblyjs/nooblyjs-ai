// NooblyJS Phase 25b: objectives, the roadmap from the items, saved views and the Product reports.
//   GET  /objectives · /objectives/:id                       (read)
//   POST /objectives · PATCH /objectives/:id                 (draft)
//   POST /objectives/:id/move { horizon }                    (approve, people only: a Product lead)
//   POST /objectives/:id/key-results                         (draft)
//   POST /objectives/:id/key-results/:kr/readings            { value } or { refresh: true } (draft)
//   GET  /roadmap?groupBy&portfolio&theme&objective&team     (read)
//   PUT  /roadmap/items/:id { horizon } · /roadmap/items/:id/days { days }   (draft, people only)
//   GET  /roadmap/views · /roadmap/views/:id (read; the view with its roadmap) · POST /roadmap/views · DELETE … (draft)
//   GET  /reports                                            (read): feedback by month and portfolio, planned days, key results
import { viewContext } from '../services/views.js';
import { peopleOnly } from '../util/http.js';

const one = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export function planningRoutes({ host, repos, people, objectives, planning }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const approve = host.requireRole('approve');
  const ctxFor = (req) => viewContext({ people, repos }, req.person);
  const filterOf = (q) => ({ portfolio: one(q.portfolio), theme: one(q.theme), objective: one(q.objective, 20), team: one(q.team) });

  router.get('/objectives', read, async (req, res) => res.json({ objectives: await objectives.list() }));
  router.get('/objectives/:id', read, async (req, res) => res.json(await objectives.get(req.params.id)));
  router.post('/objectives', draft, peopleOnly(host, 'set an objective'), async (req, res) => res.status(201).json(await objectives.create(req.body ?? {}, req.person)));
  router.patch('/objectives/:id', draft, peopleOnly(host, 'change an objective'), async (req, res) => res.json(await objectives.update(req.params.id, req.body ?? {}, req.person)));
  router.post('/objectives/:id/move', approve, peopleOnly(host, 'move an objective between horizons'), async (req, res) => res.json(await objectives.move(req.params.id, req.body?.horizon, req.person)));
  router.post('/objectives/:id/key-results', draft, peopleOnly(host, 'add a key result'), async (req, res) => res.status(201).json(await objectives.addKeyResult(req.params.id, req.body ?? {}, req.person)));
  router.post('/objectives/:id/key-results/:kr/readings', draft, async (req, res) => res.json(await objectives.measure(req.params.id, req.params.kr, req.body ?? {}, req.person)));

  router.get('/roadmap', read, async (req, res) => {
    res.json(await planning.roadmap(await ctxFor(req), { groupBy: one(req.query.groupBy, 20) ?? 'none', filter: filterOf(req.query) }));
  });
  router.put('/roadmap/items/:id', draft, peopleOnly(host, 'move an item on the roadmap'), async (req, res) => {
    res.json(await planning.move(req.params.id, req.body?.horizon ?? null, req.person));
  });
  router.put('/roadmap/items/:id/days', draft, peopleOnly(host, 'plan an item\'s days'), async (req, res) => {
    res.json(await planning.setDays(req.params.id, req.body?.days ?? null, req.person));
  });
  router.get('/roadmap/views', read, async (req, res) => res.json({ views: await planning.views() }));
  router.post('/roadmap/views', draft, peopleOnly(host, 'save a roadmap view'), async (req, res) => res.status(201).json(await planning.saveView(req.body ?? {}, req.person)));
  router.get('/roadmap/views/:id', read, async (req, res) => {
    const view = await planning.view(req.params.id);
    res.json({ view, roadmap: await planning.roadmap(await ctxFor(req), { groupBy: view.groupBy, filter: view.filter ?? {} }) });
  });
  router.delete('/roadmap/views/:id', draft, peopleOnly(host, 'remove a roadmap view'), async (req, res) => res.json(await planning.removeView(req.params.id, req.person)));

  router.get('/reports', read, async (req, res) => res.json(await planning.reports(await ctxFor(req))));

  return router;
}
