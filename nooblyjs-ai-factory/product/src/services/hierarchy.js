// The work hierarchy (NooblyJS Phase 17, root product.md §3.3): under a portfolio, and optionally one of its value
// streams, a **portfolio epic** (PEPIC-001), an **epic** (EPIC-001, under a portfolio epic or straight under the
// portfolio) and a **feature** (FEAT-001, under an epic). An idea belongs to a feature, and through it to its epic,
// value stream and portfolio; its spec follows its idea. Each has a document made from its template, like a portfolio.
//
// They are kept in catalogue.yaml beside the portfolios: { epics: [{ id, kind, name, portfolio, valueStream?, parent? }],
// features: [{ id, name, epic }] }, the portfolio and value stream by name, as products refer to them. Adding one takes
// `draft`, like adding a product.
import { badRequest, notFound } from '../util/errors.js';
import { nextNumbered } from '../util/ids.js';
import { labelName } from './catalogue.js';

export const HIERARCHY_KINDS = { 'portfolio-epic': 'Portfolio epic', epic: 'Epic', feature: 'Feature' };
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

export function createHierarchy({ repos, host, documents = null }) {
  const emit = (type, payload, actor) => host.events.emit(type, { system: 'product', ...payload }, { actor: actor?.id ?? null });
  const read = async () => {
    const doc = (await repos.catalogue.get()) ?? {};
    return { epics: doc.epics ?? [], features: doc.features ?? [], portfolios: doc.portfolios ?? [], valueStreams: doc.valueStreams ?? [] };
  };
  /** Read-modify-write of catalogue.yaml, keeping everything else in it as it is. */
  const change = (fn) => repos.catalogue.update(async (doc) => {
    const d = { ...(doc ?? {}), epics: [...(doc?.epics ?? [])], features: [...(doc?.features ?? [])] };
    return { doc: d, answer: await fn(d) };
  });

  /** Adds a portfolio epic or an epic: { kind, name, portfolio, valueStream?, parent? }. */
  async function addEpic({ kind = 'epic', name, portfolio, valueStream = null, parent = null } = {}, actor) {
    if (!['portfolio-epic', 'epic'].includes(kind)) throw badRequest('kind is "portfolio-epic" or "epic".', { kind: 'portfolio-epic | epic' });
    const title = labelName(name, `A ${HIERARCHY_KINDS[kind].toLowerCase()}`);
    const made = await change((d) => {
      const up = parent ? d.epics.find((e) => e.id === parent) : null;
      if (parent && (!up || up.kind !== 'portfolio-epic' || kind !== 'epic')) throw badRequest(`${parent} is not a portfolio epic an epic can sit under.`, { parent: 'a portfolio epic' });
      const home = (d.portfolios ?? []).find((p) => same(p.name, portfolio ?? up?.portfolio));
      if (!home) throw badRequest(`A ${HIERARCHY_KINDS[kind].toLowerCase()} sits in a portfolio: ${portfolio ? `there is no portfolio ${portfolio}` : 'name one'}.`, { portfolio: 'required' });
      const stream = valueStream ?? up?.valueStream ?? null;
      const inStream = stream ? (d.valueStreams ?? []).find((v) => same(v.name, stream) && same(v.portfolio, home.name)) : null;
      if (stream && !inStream) throw badRequest(`${stream} is not a value stream of ${home.name}.`, { valueStream: `one of ${home.name}'s` });
      const prefix = kind === 'portfolio-epic' ? 'PEPIC' : 'EPIC';
      const epic = { id: nextNumbered(prefix, d.epics.map((e) => e.id)), kind, name: title, portfolio: home.name, ...(inStream ? { valueStream: inStream.name } : {}), ...(up ? { parent: up.id } : {}) };
      d.epics.push(epic);
      return epic;
    });
    await documents?.create(kind, made, actor);
    await emit(kind === 'epic' ? 'catalogue.epic_added' : 'catalogue.portfolio_epic_added', { id: made.id, portfolio: made.portfolio, valueStream: made.valueStream ?? null, summary: `added the ${HIERARCHY_KINDS[kind].toLowerCase()} ${made.id} · ${made.name} under ${[made.portfolio, made.valueStream].filter(Boolean).join(' › ')}` }, actor);
    return made;
  }

  /** Adds a feature under an epic: { name, epic }. It sits where its epic does. */
  async function addFeature({ name, epic } = {}, actor) {
    const title = labelName(name, 'A feature');
    const made = await change((d) => {
      const up = d.epics.find((e) => e.id === epic && e.kind === 'epic');
      if (!up) throw badRequest(`A feature sits under an epic: ${epic ? `there is no epic ${epic}` : 'name one'}.`, { epic: 'required' });
      const feature = { id: nextNumbered('FEAT', d.features.map((f) => f.id)), name: title, epic: up.id };
      d.features.push(feature);
      return feature;
    });
    const place = await placeOf(made.id);
    await documents?.create('feature', { ...made, portfolio: place.portfolio, valueStream: place.valueStream }, actor);
    await emit('catalogue.feature_added', { id: made.id, epic: made.epic, summary: `added the feature ${made.id} · ${made.name} under ${place.epic.id} · ${place.epic.name}` }, actor);
    return { ...made, ...place };
  }

  /** Where a feature (or an epic) sits: { feature, epic, portfolioEpic, portfolio, valueStream }, or null. */
  async function placeOf(id) {
    if (!id) return null;
    const h = await read();
    const feature = h.features.find((f) => f.id === id) ?? null;
    const epic = h.epics.find((e) => e.id === (feature ? feature.epic : id)) ?? null;
    if (!epic) return null;
    const portfolioEpic = epic.kind === 'portfolio-epic' ? epic : h.epics.find((e) => e.id === epic.parent) ?? null;
    const brief = (x) => (x ? { id: x.id, name: x.name } : null);
    return { feature: brief(feature), epic: brief(epic.kind === 'epic' ? epic : null), portfolioEpic: brief(portfolioEpic), portfolio: epic.portfolio, valueStream: epic.valueStream ?? portfolioEpic?.valueStream ?? null };
  }

  /** The hierarchy as screens show it: each portfolio epic, epic and feature with where it sits. */
  async function view() {
    const h = await read();
    return {
      epics: h.epics.map((e) => ({ ...e, kindLabel: HIERARCHY_KINDS[e.kind], features: h.features.filter((f) => f.epic === e.id).map((f) => f.id) })),
      features: h.features.map((f) => {
        const epic = h.epics.find((e) => e.id === f.epic);
        return { ...f, portfolio: epic?.portfolio ?? null, valueStream: epic?.valueStream ?? null };
      }),
    };
  }

  /** A portfolio epic, epic or feature by its id, for its document: { id, name, portfolio, valueStream?, … }, or null. */
  async function entry(kind, id) {
    const h = await read();
    if (kind === 'feature') {
      const f = h.features.find((x) => x.id === id);
      if (!f) return null;
      const place = await placeOf(id);
      return { ...f, portfolio: place?.portfolio ?? null, valueStream: place?.valueStream ?? null };
    }
    const e = h.epics.find((x) => x.id === id && x.kind === kind);
    return e ? { ...e } : null;
  }

  /** Throws 400 unless `id` is a feature. */
  async function requireFeature(id) {
    if ((await read()).features.some((f) => f.id === id)) return id;
    throw notFound(`There is no feature ${id}.`);
  }

  return { addEpic, addFeature, placeOf, view, entry, requireFeature };
}
