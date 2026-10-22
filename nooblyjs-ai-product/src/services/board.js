// The Product board (product.md §5.1): kanban columns with counts, filters with counts, top signals this week and
// the quarter's roadmap. It is a projection, built from the files on each request: at this size (tens to hundreds
// of files, read through the store's cache) that is cheap, and it can never be stale when someone edits a file
// by hand. If it gets slow, cache it here and drop the cache on the engine's own events.
import { ideaView, signalView, specSummary } from './views.js';

export const COLUMNS = [
  { key: 'signals', label: 'Signals' },
  { key: 'ideas', label: 'Ideas' },
  { key: 'spec-drafting', label: 'Spec drafting' },
  { key: 'in-review', label: 'In review' },
  { key: 'to-architecture', label: 'To architecture' },
];
const SPEC_COLUMN = { 'awaiting-brief': 'spec-drafting', drafting: 'spec-drafting', 'changes-requested': 'spec-drafting', 'in-review': 'in-review', approved: 'to-architecture' };
const TOP_SIGNALS = 5;

const byNumberDesc = (a, b) => b.id.localeCompare(a.id, 'en', { numeric: true });

/** Every card on the board, unfiltered, each with the column it belongs in and whether it is this person's. */
async function allCards(ctx, repos) {
  const [signals, ideas, specs] = await Promise.all([repos.signals.list(), repos.ideas.list(), repos.specs.list()]);
  const specced = new Set(specs.map((s) => s.idea).filter(Boolean));
  // Mine: what is on this person's plate. Items they own, and reviews still waiting on them (not ones they finished).
  const mine = (record) => record.owner === ctx.me?.id || (record.reviewers ?? []).some((r) => r.id === ctx.me?.id && r.status === 'waiting');

  const cards = [];
  // A signal that became an idea, and an idea that has a spec, have moved on to the next column.
  for (const s of signals.filter((s) => (s.status ?? 'new') === 'new').sort((a, b) => (b.count ?? 0) - (a.count ?? 0))) {
    cards.push({ column: 'signals', mine: false, card: signalView(s, ctx) });
  }
  // NooblyJS Phase 25a: an idea put forward in the portal is on the board once a person promotes it; a merged one never.
  const opps = ideas.filter((o) => !specced.has(o.id) && !['closed', 'suggested', 'merged'].includes(o.status ?? 'open')).map((o) => ({ o, view: ideaView(ctx, o) }));
  for (const { o, view } of opps.sort((a, b) => (b.view.rice.score ?? -1) - (a.view.rice.score ?? -1))) {
    cards.push({ column: 'ideas', mine: mine(o), card: view });
  }
  for (const s of [...specs].sort(byNumberDesc)) {
    const column = SPEC_COLUMN[s.status];
    if (column) cards.push({ column, mine: mine(s), card: specSummary(ctx, s) });
  }
  return { cards, signals };
}

/** Top signals this week: the latest week in the files, by count, with how many Knowledge sources fed them. */
export function topSignals(signals) {
  const weeks = signals.map((s) => s.week).filter(Boolean).sort();
  const week = weeks.at(-1) ?? null;
  const thisWeek = signals.filter((s) => s.week === week);
  const sources = new Set(thisWeek.flatMap((s) => s.sources ?? [s.source]).filter(Boolean));
  return {
    week,
    sourceCount: sources.size,
    text: `from Knowledge · ${sources.size} source${sources.size === 1 ? '' : 's'}`,
    items: thisWeek
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, TOP_SIGNALS)
      .map((s) => ({ signalId: s.id, theme: s.theme ?? s.title, count: s.count ?? 0 })),
  };
}

/**
 * @param {object} ctx      from viewContext()
 * @param {object} repos
 * @param {{ portfolio?: string, valueStream?: string, product?: string, mine?: boolean }} filter
 * @param {{ view: (counts: Map<string, number>) => Promise<object> }} catalogue   where work sits (catalogue.js)
 */
export async function buildBoard(ctx, repos, { portfolio = null, valueStream = null, product = null, mine = false, epic = null, feature = null } = {}, catalogue = null, planning = null) {
  // Since Phase 25b the roadmap card is the Now timeline, from the specs placed in Now (planning.js).
  const [{ cards, signals }, roadmap] = await Promise.all([allCards(ctx, repos), planning ? planning.timeline(ctx) : null]);
  const is = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

  // Counts are over the whole board, so every label says what choosing it would show.
  const counts = new Map();
  for (const { card } of cards) if (card.product) counts.set(card.product.toLowerCase(), (counts.get(card.product.toLowerCase()) ?? 0) + 1);
  const labels = catalogue ? await catalogue.view(counts) : { themes: [], portfolios: [], unfiled: [], empty: true };
  // A product names its portfolio and value stream, so ?product=Checkout alone also lights up Digital and Digital Commerce.
  const chosenProduct = product ? [...labels.portfolios.flatMap((p) => p.products), ...labels.unfiled].find((p) => is(p.name, product)) ?? { name: product, portfolio: null, valueStream: null } : null;
  const streamName = valueStream ?? chosenProduct?.valueStream ?? null;
  const chosenStream = streamName ? labels.portfolios.flatMap((p) => p.valueStreams).find((v) => is(v.name, streamName)) ?? { name: streamName, portfolio: null } : null;
  const chosenPortfolio = portfolio ?? chosenStream?.portfolio ?? chosenProduct?.portfolio ?? null;
  const unfiledCards = cards.filter((c) => !c.card.product).length;
  const filters = [
    { key: 'all', label: 'All', count: cards.length, active: !chosenPortfolio && !chosenProduct && !chosenStream && !mine },
    { key: 'mine', label: 'Mine', count: cards.filter((c) => c.mine).length, active: Boolean(mine) },
  ];
  const portfolios = labels.portfolios.map((p) => ({ name: p.name, count: p.count, active: is(p.name, chosenPortfolio) }));
  const inPortfolio = labels.portfolios.find((p) => is(p.name, chosenPortfolio));
  // The value streams to choose from: those of the chosen portfolio. Then its products, or the chosen value stream's.
  const valueStreams = (inPortfolio?.valueStreams ?? []).map((v) => ({ name: v.name, portfolio: v.portfolio, count: v.count, active: is(v.name, chosenStream?.name) }));
  const products = (inPortfolio?.products ?? [])
    .filter((p) => !chosenStream || is(p.valueStream, chosenStream.name))
    .map((p) => ({ name: p.name, portfolio: p.portfolio, valueStream: p.valueStream, count: p.count, active: is(p.name, chosenProduct?.name) }));

  // NooblyJS Phase 17: the work hierarchy's epics and features in the chosen value stream (or portfolio), with counts.
  const inPlace = (x) => (!chosenStream || is(x.valueStream, chosenStream.name)) && (!chosenPortfolio || is(x.portfolio, chosenPortfolio));
  const hierarchyDoc = (await repos.catalogue.get()) ?? {};
  const epicRows = (hierarchyDoc.epics ?? []).filter((e) => e.kind === 'epic' && inPlace(e)).map((e) => ({ id: e.id, name: e.name, count: cards.filter((c) => c.card.epic?.id === e.id).length, active: epic === e.id }));
  const featureRows = (hierarchyDoc.features ?? []).filter((f) => (!epic || f.epic === epic) && epicRows.some((e) => e.id === f.epic)).map((f) => ({ id: f.id, name: f.name, epic: f.epic, count: cards.filter((c) => c.card.feature?.id === f.id).length, active: feature === f.id }));
  const shown = cards.filter((c) => (!mine || c.mine)
    && (!feature || c.card.feature?.id === feature)
    && (!epic || c.card.epic?.id === epic)
    && (!chosenProduct || is(c.card.product, chosenProduct.name))
    && (!chosenStream || chosenProduct || is(c.card.valueStream, chosenStream.name))
    && (!chosenPortfolio || chosenProduct || chosenStream || is(c.card.portfolio, chosenPortfolio)));
  const columns = COLUMNS.map((col) => {
    const inColumn = shown.filter((c) => c.column === col.key).map((c) => c.card);
    return { ...col, count: inColumn.length, cards: inColumn };
  });

  return {
    filter: { portfolio: chosenPortfolio, valueStream: chosenStream?.name ?? null, product: chosenProduct?.name ?? null, mine: Boolean(mine), ...(epic ? { epic } : {}), ...(feature ? { feature } : {}) },
    filters,
    portfolios,
    valueStreams,
    products,
    epics: epicRows,
    features: featureRows,
    // Everything a form needs to offer the labels: the themes, each portfolio with its value streams and products,
    // the products in none, and whether nothing is set up yet.
    catalogue: { ...labels, unfiledCards },
    columns,
    topSignals: topSignals(signals),
    roadmap,
  };
}
