// A portfolio's and a value stream's document, and the templates they start from (product.md §5.7, §5.8):
//   GET  /portfolios/:id · /value-streams/:id         the document, with where it sits (signed in)
//   PUT  /portfolios/:id · /value-streams/:id         { sections: [{ heading, text }] } with If-Match (draft)
//   GET  /settings/templates · /settings/templates/:kind
//   PUT  /settings/templates/:kind                     { body } with If-Match (approve, people only)
// What exists and how it fits together (the names, themes, value streams and products) is the catalogue's: GET and
// write it at /catalogue (board.js).
import { viewContext, actorRef } from '../services/views.js';
import { peopleOnly } from '../util/http.js';
import { notFound, HttpError } from '../util/errors.js';
import { newId } from '../util/ids.js';
import { STRATEGY_KINDS, TEMPLATE_KINDS } from '../services/templates.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function strategyRoutes({ host, repos, people, catalogue, documents, templates }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const approve = host.requireRole('approve');

  /** The catalogue entry for a document, or 404. */
  async function entryFor(kind, id) {
    const entry = await catalogue.entry(kind, id);
    if (!entry) throw notFound(`There is no ${kind.replace('-', ' ')} ${id}.`);
    return entry;
  }

  /** The document as its page shows it: its sections, who changed it last, and where it sits. */
  async function documentView(req, kind, doc) {
    const ctx = await viewContext({ people, repos }, req.person);
    const c = await catalogue.view();
    const updatedBy = actorRef(ctx, doc.updatedBy);
    const base = { ...doc, updatedBy, text: doc.version ? `Version ${doc.version}${updatedBy ? ` · ${updatedBy.name}` : ''}` : 'Not filled in yet' };
    if (!['portfolio', 'value-stream'].includes(kind)) return { ...base, portfolio: doc.portfolio ?? null, valueStream: doc.valueStream ?? null, parent: doc.parent ?? null, epic: doc.epic ?? null };
    if (kind === 'portfolio') {
      const p = c.portfolios.find((x) => x.id === doc.id);
      return {
        ...base,
        themes: (p?.themes ?? []).map((name) => c.themes.find((t) => t.name === name) ?? { name, description: null }),
        valueStreams: (p?.valueStreams ?? []).map((v) => ({ id: v.id, name: v.name, text: plural(v.products.length, 'product') })),
        products: (p?.products ?? []).map((x) => ({ name: x.name, valueStream: x.valueStream })),
      };
    }
    const p = c.portfolios.find((x) => x.name === doc.portfolio);
    const stream = p?.valueStreams.find((v) => v.id === doc.id);
    return { ...base, portfolioId: p?.id ?? null, themes: (p?.themes ?? []).map((name) => c.themes.find((t) => t.name === name) ?? { name, description: null }), products: stream?.products ?? [] };
  }

  // NooblyJS Phase 17: the work hierarchy's documents too.
  for (const [path, kind] of [['portfolios', 'portfolio'], ['value-streams', 'value-stream'], ['portfolio-epics', 'portfolio-epic'], ['epics', 'epic'], ['features', 'feature']]) {
    router.get(`/${path}/:id`, read, async (req, res) => {
      const doc = await documents.read(kind, await entryFor(kind, req.params.id));
      res.set('ETag', doc.etag).json(await documentView(req, kind, doc));
    });

    router.put(`/${path}/:id`, draft, async (req, res) => {
      const doc = await documents.save(kind, await entryFor(kind, req.params.id), req.body, req.person, { ifMatch: req.get('if-match') });
      res.set('ETag', doc.etag).json(await documentView(req, kind, doc));
    });
  }

  // NooblyJS Phase 25b: the strategy documents (vision, positioning, personas, competitors), each from its template.
  //   GET /strategy-docs · POST /strategy-docs { kind, name } (draft) · GET and PUT /strategy-docs/:id (PUT: draft, If-Match)
  const strategyDoc = async (id) => {
    const doc = /^std_[a-z0-9]{6,32}$/.test(String(id)) ? await repos.strategyDocs.get(id) : null;
    if (!doc || !STRATEGY_KINDS.includes(doc.kind)) throw notFound(`There is no strategy document ${String(id).slice(0, 40)}.`);
    return doc;
  };
  router.get('/strategy-docs', read, async (req, res) => {
    const docs = (await repos.strategyDocs.list()).filter((d) => STRATEGY_KINDS.includes(d.kind));
    const views = await Promise.all(docs.map((d) => documents.read(d.kind, { id: d.id, name: d.name })));
    res.json({
      kinds: STRATEGY_KINDS.map((kind) => ({ kind, label: TEMPLATE_KINDS[kind].label })),
      documents: views.sort((a, b) => STRATEGY_KINDS.indexOf(a.kind) - STRATEGY_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name))
        .map((d) => ({ id: d.id, kind: d.kind, kindLabel: d.kindLabel, name: d.name, version: d.version ?? 0, text: `${d.filled} of ${d.sections.filter((x) => x.inTemplate).length} sections filled in` })),
    });
  });
  router.post('/strategy-docs', draft, async (req, res) => {
    const kind = String(req.body?.kind ?? '');
    const name = typeof req.body?.name === 'string' ? req.body.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (!STRATEGY_KINDS.includes(kind)) throw new HttpError(422, 'invalid', `Choose a kind: ${STRATEGY_KINDS.join(', ')}.`, { kind: STRATEGY_KINDS.join(', ') });
    if (!name) throw new HttpError(422, 'invalid', 'Give it a name.', { name: 'a name' });
    const id = newId('std', 10);
    await documents.create(kind, { id, name }, req.person);
    await host.events.emit('strategy.document_created', { system: 'product', id, kind, name, summary: `started the ${TEMPLATE_KINDS[kind].label.toLowerCase()} "${name}"` }, { actor: req.person.id });
    const doc = await documents.read(kind, { id, name });
    res.status(201).set('ETag', doc.etag).json(doc);
  });
  router.get('/strategy-docs/:id', read, async (req, res) => {
    const d = await strategyDoc(req.params.id);
    const doc = await documents.read(d.kind, { id: d.id, name: d.name });
    res.set('ETag', doc.etag).json(await documentView(req, d.kind, doc));
  });
  router.put('/strategy-docs/:id', draft, async (req, res) => {
    const d = await strategyDoc(req.params.id);
    const doc = await documents.save(d.kind, { id: d.id, name: d.name }, req.body, req.person, { ifMatch: req.get('if-match') });
    res.set('ETag', doc.etag).json(await documentView(req, d.kind, doc));
  });

  router.get('/settings/templates', read, async (req, res) => {
    res.json({ templates: await templates.list(await viewContext({ people, repos }, req.person)) });
  });

  router.get('/settings/templates/:kind', read, async (req, res) => {
    const template = await templates.view(req.params.kind, await viewContext({ people, repos }, req.person));
    res.set('ETag', template.etag).json(template);
  });

  // Changing a template changes every portfolio's or value stream's document: an Approver, and only a person.
  router.put('/settings/templates/:kind', approve, peopleOnly(host, 'change a template'), async (req, res) => {
    await templates.set(req.params.kind, req.body?.body, req.person, { ifMatch: req.get('if-match') });
    const template = await templates.view(req.params.kind, await viewContext({ people, repos }, req.person));
    res.set('ETag', template.etag).json(template);
  });

  return router;
}
