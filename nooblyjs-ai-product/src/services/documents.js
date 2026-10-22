// A portfolio's and a value stream's document (product.md §4): Markdown in data/product/portfolios/<id>.md and
// data/product/value-streams/<id>.md, made from its template (templates.js) when the portfolio or value stream is
// added. The catalogue (catalogue.yaml) says what exists and how it fits together; the document holds what people
// write about it, one `## ` section per heading of the template.
//
// Reading lays the document over the template as it is now: the template's sections in its order (empty when the
// document has no text for one), then any section the document has that the template no longer has. Saving takes
// If-Match, so two people editing the same document can't overwrite each other.
import { splitSections } from '../util/sections.js';
import { checkIfMatch, etagOf, isAgent } from '../util/http.js';
import { HttpError, unprocessable } from '../util/errors.js';
import { templateSections } from './templates.js';

export const DOCUMENT_KINDS = { portfolio: 'Portfolio', 'value-stream': 'Value stream', 'portfolio-epic': 'Portfolio epic', epic: 'Epic', feature: 'Feature', vision: 'Vision', positioning: 'Positioning', persona: 'Persona', competitor: 'Competitor' };
// NooblyJS Phase 17: where each kind's documents are, and the event a save says it with. Phase 25b: the strategy
// documents share one folder (strategy/), each saying its kind.
const REPOS = { portfolio: 'portfolios', 'value-stream': 'valueStreams', 'portfolio-epic': 'portfolioEpics', epic: 'epics', feature: 'features', vision: 'strategyDocs', positioning: 'strategyDocs', persona: 'strategyDocs', competitor: 'strategyDocs' };
const SAVED = { portfolio: 'portfolio.updated', 'value-stream': 'value_stream.updated', 'portfolio-epic': 'portfolio_epic.updated', epic: 'epic.updated', feature: 'feature.updated', vision: 'strategy.document_updated', positioning: 'strategy.document_updated', persona: 'strategy.document_updated', competitor: 'strategy.document_updated' };
const MAX_SECTION = 20000;

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const ref = (actor) => (actor ? (isAgent(actor) ? { id: actor.id, name: actor.name, kind: 'agent' } : { id: actor.id, kind: 'person' }) : null);
const write = (sections) => sections.map((s) => (s.text ? `## ${s.heading}\n\n${s.text}` : `## ${s.heading}`)).join('\n\n');

export function createDocuments({ repos, host, templates }) {
  const now = () => new Date().toISOString();
  const repoFor = (kind) => repos[REPOS[kind]];
  /** What the front matter says the document is about: its name, and where it sits (a value stream's portfolio; an epic's or feature's portfolio, value stream and parent). */
  const about = (kind, entry) => ({
    id: entry.id, kind, name: entry.name,
    ...(kind === 'value-stream' ? { portfolio: entry.portfolio ?? null } : {}),
    ...(['portfolio-epic', 'epic', 'feature'].includes(kind) ? Object.fromEntries(['portfolio', 'valueStream', 'parent', 'epic'].filter((k) => entry[k]).map((k) => [k, entry[k]])) : {}),
  });

  /** Writes a new document from the template: its headings, empty. Does nothing when the document exists. */
  async function create(kind, entry, actor = null) {
    if (!entry?.id) return null;
    const template = await templates.get(kind);
    return repoFor(kind).update(entry.id, (current) => (current ? null : {
      ...about(kind, entry),
      version: 1,
      template: template.version,
      createdAt: now(),
      createdBy: ref(actor),
      updatedAt: now(),
      updatedBy: ref(actor),
      body: write(templateSections(template.body).map((s) => ({ heading: s.heading, text: '' }))),
    }));
  }

  /** Keeps the front matter in step when the catalogue renames or moves the portfolio or value stream. */
  async function renamed(kind, entry) {
    if (!entry?.id) return;
    await repoFor(kind).update(entry.id, (current) => current && { ...current, ...about(kind, entry) });
  }

  const removed = async (kind, id) => { if (id) await repoFor(kind).remove(id); };

  /** The sections as a screen shows them: the template's, then the document's own that the template no longer has. */
  async function sectionsFor(kind, doc) {
    const template = await templates.get(kind);
    const written = splitSections(doc?.body);
    const wanted = templateSections(template.body);
    const fromTemplate = wanted.map((t) => ({ heading: t.heading, hint: t.hint, text: written.find((w) => same(w.heading, t.heading))?.text ?? '', inTemplate: true }));
    // A section the template no longer has stays only while it has text.
    const own = written.filter((w) => w.text && !wanted.some((t) => same(t.heading, w.heading))).map((w) => ({ heading: w.heading, hint: '', text: w.text, inTemplate: false }));
    return { template, sections: [...fromTemplate, ...own] };
  }

  /**
   * The document for a catalogue entry ({ id, name, portfolio? }). One not written yet (a folder from before
   * documents) reads as the template, empty, at version 0; the first save writes it.
   */
  async function read(kind, entry) {
    const doc = await repoFor(kind).get(entry.id);
    const { template, sections } = await sectionsFor(kind, doc);
    const version = doc?.version ?? 0;
    return {
      ...about(kind, entry),
      kindLabel: DOCUMENT_KINDS[kind],
      version,
      etag: etagOf({ id: entry.id, version }),
      template: { version: template.version, madeFrom: doc?.template ?? null },
      createdAt: doc?.createdAt ?? null,
      updatedAt: doc?.updatedAt ?? null,
      updatedBy: doc?.updatedBy ?? null,
      sections,
      filled: sections.filter((s) => s.inTemplate && s.text).length,
    };
  }

  /**
   * Saves sections a person (or a drafting agent) wrote: `sections` is [{ heading, text }], each heading one the
   * document shows. Sections left out keep their text; a section no longer in the template is dropped when emptied.
   */
  async function save(kind, entry, body, actor, { ifMatch } = {}) {
    const list = body?.sections;
    if (!Array.isArray(list) || list.length === 0 || list.length > 60) throw unprocessable('Send the sections you changed: [{ heading, text }].', { sections: 'list' });
    const changes = new Map();
    for (const [i, s] of list.entries()) {
      if (typeof s?.heading !== 'string' || typeof s?.text !== 'string') throw unprocessable('Each section has a heading and its text.', { [`sections[${i}]`]: 'heading and text' });
      if (s.text.length > MAX_SECTION) throw unprocessable(`${s.heading} is at most ${MAX_SECTION.toLocaleString('en-US')} characters.`, { [`sections[${i}]`]: `max ${MAX_SECTION}` });
      // A line starting "## " would become a section of its own.
      changes.set(s.heading.toLowerCase(), s.text.replace(/\r\n/g, '\n').replace(/^##(?=\s)/gm, '###').trim());
    }
    const saved = await repoFor(kind).update(entry.id, async (current) => {
      const version = current?.version ?? 0;
      checkIfMatch(ifMatch, { id: entry.id, version });
      const { template, sections } = await sectionsFor(kind, current);
      const unknown = [...changes.keys()].filter((h) => !sections.some((s) => s.heading.toLowerCase() === h));
      if (unknown.length) throw new HttpError(422, 'invalid', `${DOCUMENT_KINDS[kind]} documents have no section "${unknown[0]}". The template in Settings says which sections there are.`, { sections: unknown });
      const next = sections
        .map((s) => ({ heading: s.heading, text: changes.has(s.heading.toLowerCase()) ? changes.get(s.heading.toLowerCase()) : s.text, inTemplate: s.inTemplate }))
        .filter((s) => s.inTemplate || s.text);
      return {
        ...(current ?? { createdAt: now(), createdBy: ref(actor) }),
        ...about(kind, entry),
        version: version + 1,
        template: template.version,
        updatedAt: now(),
        updatedBy: ref(actor),
        body: write(next),
      };
    });
    await host.events.emit(SAVED[kind], {
      system: 'product', [kind === 'portfolio' ? 'portfolio' : kind === 'value-stream' ? 'valueStream' : 'name']: entry.name, id: entry.id, version: saved.version,
      summary: `updated the ${DOCUMENT_KINDS[kind].toLowerCase()} ${entry.name} (version ${saved.version})`,
    }, { actor: actor.id });
    return read(kind, entry);
  }

  return { create, renamed, removed, read, save };
}
