// A portfolio's and a value stream's document, and the templates they start from (product.md §5.7, §5.8):
//   GET  /portfolios/:id · /value-streams/:id         the document, with where it sits (signed in)
//   PUT  /portfolios/:id · /value-streams/:id         { sections: [{ heading, text }] } with If-Match (draft)
//   GET  /settings/templates · /settings/templates/:kind
//   PUT  /settings/templates/:kind                     { body } with If-Match (approve, people only)
// What exists and how it fits together (the names, themes, value streams and products) is the catalogue's: GET and
// write it at /catalogue (board.js).
import { viewContext, actorRef } from '../services/views.js';
import { peopleOnly } from '../util/http.js';
import { notFound } from '../util/errors.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function strategyRoutes({ host, repos, people, catalogue, documents, templates }) {
  const router = host.express.Router();
  const read = host.requireRole('read');
  const draft = host.requireRole('draft');
  const approve = host.requireRole('approve');

  /** The catalogue entry for a document, or 404. */
  async function entryFor(kind, id) {
    const entry = await catalogue.entry(kind, id);
    if (!entry) throw notFound(`There is no ${kind === 'portfolio' ? 'portfolio' : 'value stream'} ${id}.`);
    return entry;
  }

  /** The document as its page shows it: its sections, who changed it last, and where it sits. */
  async function documentView(req, kind, doc) {
    const ctx = await viewContext({ people, repos }, req.person);
    const c = await catalogue.view();
    const updatedBy = actorRef(ctx, doc.updatedBy);
    const base = { ...doc, updatedBy, text: doc.version ? `Version ${doc.version}${updatedBy ? ` · ${updatedBy.name}` : ''}` : 'Not filled in yet' };
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

  for (const [path, kind] of [['portfolios', 'portfolio'], ['value-streams', 'value-stream']]) {
    router.get(`/${path}/:id`, read, async (req, res) => {
      const doc = await documents.read(kind, await entryFor(kind, req.params.id));
      res.set('ETag', doc.etag).json(await documentView(req, kind, doc));
    });

    router.put(`/${path}/:id`, draft, async (req, res) => {
      const doc = await documents.save(kind, await entryFor(kind, req.params.id), req.body, req.person, { ifMatch: req.get('if-match') });
      res.set('ETag', doc.etag).json(await documentView(req, kind, doc));
    });
  }

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
