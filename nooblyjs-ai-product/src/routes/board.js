// The Product board and its parts: GET /board, /signals, /ideas(/:id), /roadmap, and the Stage 1 writes
// POST /signals/:id/idea, POST /ideas, PUT /ideas/:id.
// Where work sits (catalogue.js): GET /catalogue, with the strategic themes, portfolios, value streams and products;
// adding one takes `draft`; renaming, moving, removing and linking a portfolio to its themes change what other
// people's work is filed under, so they take `approve`.
import { buildBoard } from '../services/board.js';
import { roadmapView } from '../services/roadmap.js';
import { viewContext, signalView, ideaView } from '../services/views.js';
import { notFound } from '../util/errors.js';
import { etagOf } from '../util/http.js';

const truthy = (v) => ['1', 'true', 'yes'].includes(String(v ?? '').toLowerCase());
const oneString = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

export function boardRoutes({ host, repos, people, ideas, catalogue }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const approve = host.requireRole('approve');
  const ctxFor = (req) => viewContext({ people, repos }, req.person);

  router.get('/board', read, async (req, res) => {
    const ctx = await ctxFor(req);
    res.json(await buildBoard(ctx, repos, { portfolio: oneString(req.query.portfolio), valueStream: oneString(req.query.valueStream), product: oneString(req.query.product), mine: truthy(req.query.mine), epic: oneString(req.query.epic), feature: oneString(req.query.feature) }, catalogue));
  });

  // ---------- strategic themes, portfolios, value streams and products ----------
  /** The catalogue with how many board cards sit under each product. */
  const catalogueView = async (req) => (await buildBoard(await ctxFor(req), repos, {}, catalogue)).catalogue;

  router.get('/catalogue', read, async (req, res) => res.json(await catalogueView(req)));

  router.post('/catalogue/portfolios', draft, async (req, res) => {
    const result = await catalogue.addPortfolio(req.body?.name, req.person);
    res.status(result.added ? 201 : 200).json({ ...result, catalogue: await catalogueView(req) });
  });

  router.post('/catalogue/products', draft, async (req, res) => {
    const { name, portfolio, valueStream } = req.body ?? {};
    const result = await catalogue.addProduct({ name, portfolio, valueStream }, req.person);
    res.status(result.added ? 201 : 200).json({ ...result, catalogue: await catalogueView(req) });
  });

  router.post('/catalogue/themes', draft, async (req, res) => {
    const result = await catalogue.addTheme({ name: req.body?.name, description: req.body?.description }, req.person);
    res.status(result.added ? 201 : 200).json({ ...result, catalogue: await catalogueView(req) });
  });

  router.post('/catalogue/value-streams', draft, async (req, res) => {
    const result = await catalogue.addValueStream({ name: req.body?.name, portfolio: req.body?.portfolio }, req.person);
    res.status(result.added ? 201 : 200).json({ ...result, catalogue: await catalogueView(req) });
  });

  // A portfolio's name and the strategic themes it works towards ({ name?, themes? }).
  router.patch('/catalogue/portfolios/:name', approve, async (req, res) => {
    const { name, themes } = req.body ?? {};
    res.json({ ...await catalogue.changePortfolio(req.params.name, { name, themes }, req.person), catalogue: await catalogueView(req) });
  });

  router.patch('/catalogue/themes/:name', approve, async (req, res) => {
    const { name, description } = req.body ?? {};
    res.json({ ...await catalogue.changeTheme(req.params.name, { name, description }, req.person), catalogue: await catalogueView(req) });
  });

  router.patch('/catalogue/value-streams/:name', approve, async (req, res) => {
    const { name, portfolio } = req.body ?? {};
    res.json({ ...await catalogue.changeValueStream(req.params.name, { name, portfolio }, req.person), catalogue: await catalogueView(req) });
  });

  router.patch('/catalogue/products/:name', approve, async (req, res) => {
    const { name, portfolio, valueStream } = req.body ?? {};
    res.json({ ...await catalogue.changeProduct(req.params.name, { name, portfolio, valueStream }, req.person), catalogue: await catalogueView(req) });
  });

  // Where a product's work happens: default repositories and Jira project. Anyone who may draft.
  router.put('/catalogue/products/:name/tools', draft, async (req, res) => {
    const { repositories, jiraProject } = req.body ?? {};
    res.json({ ...await catalogue.setTools(req.params.name, { repositories, jiraProject }, req.person), catalogue: await catalogueView(req) });
  });

  router.delete('/catalogue/portfolios/:name', approve, async (req, res) => {
    res.json({ ...await catalogue.removePortfolio(req.params.name, req.person), catalogue: await catalogueView(req) });
  });

  router.delete('/catalogue/themes/:name', approve, async (req, res) => {
    res.json({ ...await catalogue.removeTheme(req.params.name, req.person), catalogue: await catalogueView(req) });
  });

  router.delete('/catalogue/value-streams/:name', approve, async (req, res) => {
    res.json({ ...await catalogue.removeValueStream(req.params.name, req.person), catalogue: await catalogueView(req) });
  });

  router.delete('/catalogue/products/:name', approve, async (req, res) => {
    res.json({ ...await catalogue.removeProduct(req.params.name, req.person), catalogue: await catalogueView(req) });
  });

  router.get('/signals', read, async (req, res) => {
    const signals = (await repos.signals.list()).sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    const ctx = await ctxFor(req);
    res.json({ signals: signals.map((s) => signalView(s, ctx)) });
  });

  router.get('/ideas', read, async (req, res) => {
    const ctx = await ctxFor(req);
    const views = (await repos.ideas.list()).map((o) => ideaView(ctx, o));
    res.json({ ideas: views.sort((a, b) => (b.rice.score ?? -1) - (a.rice.score ?? -1)) });
  });

  router.get('/ideas/:id', read, async (req, res) => {
    const opp = await repos.ideas.get(req.params.id);
    if (!opp) throw notFound(`There is no idea ${req.params.id}.`);
    res.set('ETag', etagOf({ ...opp, version: opp.version ?? 1 })).json(ideaView(await ctxFor(req), opp));
  });

  /** Answers a write with the idea as the board shows it, and its new ETag. */
  const sendIdea = async (req, res, status, opp) => {
    res.status(status).set('ETag', etagOf({ ...opp, version: opp.version ?? 1 })).json(ideaView(await ctxFor(req), opp));
  };

  router.post('/signals/:id/idea', draft, async (req, res) => {
    await sendIdea(req, res, 201, await ideas.fromSignal(req.params.id, req.body, req.person));
  });

  router.post('/ideas', draft, async (req, res) => {
    await sendIdea(req, res, 201, await ideas.createFromBody(req.body, req.person));
  });

  router.put('/ideas/:id', draft, async (req, res) => {
    await sendIdea(req, res, 200, await ideas.update(req.params.id, req.body, req.person, { ifMatch: req.get('if-match') }));
  });

  router.get('/roadmap', read, async (req, res) => {
    const roadmap = await repos.roadmap.get();
    res.json(roadmap ? await roadmapView(await ctxFor(req), repos, roadmap) : { quarter: null, from: null, to: null, items: [] });
  });

  return router;
}
