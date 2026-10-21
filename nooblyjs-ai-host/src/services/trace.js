// The trace (Phase 16f, root design.md §4): the links between artefacts, so any of them can be followed up to the
// business and down to the code. Each app's `trace(itemId)` service gives its nodes and links (the owner of a record
// writes its links: in front matter, or in its own data), and this keeps a derived index in data/trace/index.yaml, a
// cache like Metrics' roll-ups: deleted, it is built again the same; `npm run trace:rebuild` compares it with a fresh
// build. No graph database.
//
//   view(itemId)    the tree from the item (goals → business requirements → stories → criteria → test cases; stories →
//                   work items → runs → pull requests; decisions, quality attributes, infrastructure), the missing links
//                   named in words ("AC-031-2-1 has no test"), and coverage in words
//   rebuild()       every indexed item and every top-level item built again; the differences from what was kept
const SOURCES = [
  ['workflows', (s, itemId) => s.trace?.({ itemId })],
  ['product', (s, itemId) => s.trace?.(itemId)],
  ['design', (s, itemId) => s.trace?.(itemId)],
  ['quality', (s, itemId) => s.trace?.(itemId)],
  ['factory', (s, itemId, family) => s.trace?.({ itemId, itemIds: family })],
  ['infrastructure', (s, itemId) => s.trace?.(itemId)],
];

/** Which link makes a node a child of another in the tree, best first (each node is drawn once, under its best parent). */
const PARENT_RELS = ['verifies', 'criterion-of', 'opened-by', 'delivers', 'runs', 'implements', 'serves', 'derives-from', 'builds', 'pull-request-of', 'story-of', 'goal-of', 'feature-of', 'decides', 'quality-attribute-of', 'interface-of', 'infrastructure-for', 'for'];
const TYPE_WORDS = {
  item: 'Item', goal: 'Goal', 'business-requirement': 'Business requirement', feature: 'Feature', story: 'Story', criterion: 'Acceptance criterion',
  'test-case': 'Test case', interface: 'Interface', 'work-item': 'Work item', run: 'Run', 'pull-request': 'Pull request', adr: 'Decision',
  'quality-attribute': 'Quality attribute', infrastructure: 'Infrastructure design',
};
/** The order children are drawn in: down the chain first, then what hangs off the item. */
const TYPE_ORDER = ['goal', 'business-requirement', 'feature', 'story', 'criterion', 'test-case', 'work-item', 'run', 'pull-request', 'adr', 'quality-attribute', 'interface', 'infrastructure'];
const typeRank = (n) => { const i = TYPE_ORDER.indexOf(n.type); return i < 0 ? TYPE_ORDER.length : i; };
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const byId = (a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true });
const linkKey = (l) => `${l.from}|${l.rel}|${l.to}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createTrace({ store, services, events, log = console }) {
  const FILE = ['trace', 'index.yaml'];
  // Entries built since the last change anywhere: anything else is built again before it is shown.
  const fresh = new Set();
  events?.on?.('*', (e) => { if (!/^(check\.recorded|clock\.|session\.|teammate\.task_|chat\.agent_working)/.test(e?.type ?? '')) fresh.clear(); });

  /** One item's nodes and links, from every app that has a trace service, merged and in a stable order. */
  async function build(itemId) {
    const family = (await services.get('workflows')?.familyOf?.({ itemId }).catch(() => null)) ?? [itemId];
    const nodes = new Map();
    const links = new Map();
    for (const [name, ask] of SOURCES) {
      const s = services.get(name);
      if (!s) continue;
      let out;
      try {
        out = await ask(s, itemId, family);
      } catch (err) {
        log.warn?.(`trace: ${name}.trace(${itemId}) failed: ${err.message}`);
        continue;
      }
      for (const n of out?.nodes ?? []) {
        if (!n?.id) continue;
        const had = nodes.get(n.id) ?? {};
        // The first app to name a node gives its type and title; others only fill what is missing.
        nodes.set(n.id, { ...Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined && v !== null)), ...Object.fromEntries(Object.entries(had).filter(([, v]) => v !== undefined && v !== null)) });
      }
      for (const l of out?.links ?? []) if (l?.from && l?.to && l?.rel) links.set(linkKey(l), { from: String(l.from), rel: String(l.rel), to: String(l.to) });
    }
    return { nodes: [...nodes.values()].sort(byId), links: [...links.values()].sort((a, b) => linkKey(a).localeCompare(linkKey(b), 'en', { numeric: true })) };
  }

  const readIndex = async () => (await store.readYaml(FILE).catch(() => null)) ?? { items: {} };

  /** The item's entry: kept, unless something changed since it was built or it was never built (then built and kept). */
  async function entry(itemId) {
    const index = await readIndex();
    if (fresh.has(itemId) && index.items?.[itemId]) return index.items[itemId];
    const built = await build(itemId);
    const now = await readIndex();
    await store.writeYaml(FILE, { version: 1, items: { ...(now.items ?? {}), [itemId]: built } });
    fresh.add(itemId);
    return built;
  }

  /** The tree from the item, the missing links in words, and coverage. */
  async function view(itemId) {
    if (!SAFE.test(itemId)) throw Object.assign(new Error('Not an item id.'), { status: 400, code: 'bad_request' });
    const { nodes, links } = await entry(itemId);
    return shape(itemId, nodes, links);
  }

  /** Every indexed item, and every top-level item, built again and compared with what was kept. Writes the fresh index. */
  async function rebuild({ write = true } = {}) {
    const index = await readIndex();
    const tops = ((await services.get('workflows')?.items?.({}).catch(() => [])) ?? []).filter((i) => !i.parentId && i.type !== 'pr' && SAFE.test(i.id)).map((i) => i.id);
    const ids = [...new Set([...Object.keys(index.items ?? {}), ...tops])].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const items = {};
    const differences = [];
    for (const id of ids) {
      items[id] = await build(id);
      const kept = index.items?.[id];
      if (!kept) continue; // not indexed before: nothing to compare
      const diff = compare(kept, items[id]);
      if (diff) differences.push(`${id}: ${diff}`);
    }
    if (write) {
      await store.writeYaml(FILE, { version: 1, items });
      fresh.clear();
      for (const id of ids) fresh.add(id);
    }
    return { items: ids.length, compared: ids.filter((id) => index.items?.[id]).length, differences };
  }

  return { view, rebuild, build };
}

/** What differs between two entries, in words, or null. */
function compare(a, b) {
  const set = (list, key) => new Map((list ?? []).map((x) => [key(x), JSON.stringify(x)]));
  const out = [];
  for (const [what, key] of [['node', (n) => n.id], ['link', linkKey]]) {
    const x = set(a[`${what}s`], key);
    const y = set(b[`${what}s`], key);
    const changed = [...new Set([...x.keys(), ...y.keys()])].filter((k) => x.get(k) !== y.get(k));
    if (changed.length) out.push(`${plural(changed.length, what)} differ (${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ', …' : ''})`);
  }
  return out.length ? out.join('; ') : null;
}

/** The tree, gaps and coverage from nodes and links. Pure. */
export function shape(itemId, nodes, links) {
  const node = new Map(nodes.map((n) => [n.id, n]));
  const out = links.filter((l) => node.has(l.from));
  // Each node's parent: its best link to a node that exists (by PARENT_RELS), never itself.
  const parentOf = new Map();
  for (const rel of PARENT_RELS) {
    for (const l of out.filter((x) => x.rel === rel && node.has(x.to) && x.from !== x.to)) if (!parentOf.has(l.from)) parentOf.set(l.from, l);
  }
  const children = new Map();
  for (const [child, l] of parentOf) {
    if (!children.has(l.to)) children.set(l.to, []);
    children.get(l.to).push(child);
  }
  const seen = new Set();
  const draw = (id) => {
    if (seen.has(id)) return null; // a loop in the links: drawn once
    seen.add(id);
    const n = node.get(id) ?? { id, type: 'unknown', title: id };
    const also = out.filter((l) => l.from === id && parentOf.get(id) !== l && node.has(l.to) && l.rel !== 'story-of').map((l) => `${l.rel} ${l.to}`);
    return {
      id, type: n.type, typeText: TYPE_WORDS[n.type] ?? n.type, title: n.title ?? id, system: n.system ?? null, stage: n.stage ?? null, status: n.status ?? null, href: n.href ?? null,
      rel: parentOf.get(id)?.rel ?? null, also,
      children: (children.get(id) ?? []).map((c) => node.get(c)).sort((a, b) => typeRank(a) - typeRank(b) || byId(a, b)).map((c) => draw(c.id)).filter(Boolean),
    };
  };
  const root = node.has(itemId) ? draw(itemId) : null;
  const unplaced = nodes.filter((n) => !seen.has(n.id)).map((n) => ({ id: n.id, type: n.type, typeText: TYPE_WORDS[n.type] ?? n.type, title: n.title ?? n.id }));

  // The missing links, in words.
  const linkedTo = (id, rels) => out.some((l) => l.to === id && rels.includes(l.rel));
  const of = (type) => nodes.filter((n) => n.type === type);
  const gaps = [];
  for (const g of of('goal')) if (!linkedTo(g.id, ['derives-from'])) gaps.push({ id: g.id, text: `${g.id} has no business requirement` });
  for (const br of of('business-requirement')) if (!linkedTo(br.id, ['serves'])) gaps.push({ id: br.id, text: `${br.id} has no story` });
  for (const ac of of('criterion')) if (!linkedTo(ac.id, ['verifies'])) gaps.push({ id: ac.id, text: `${ac.id} has no test` });
  for (const tc of of('test-case')) if (!out.some((l) => l.from === tc.id && l.rel === 'verifies')) gaps.push({ id: tc.id, text: `${tc.id} verifies nothing` });
  for (const l of out) if (!node.has(l.to)) gaps.push({ id: l.from, text: `${l.from} ${l.rel} ${l.to}, which is not here` });
  const acs = of('criterion');
  const brs = of('business-requirement');
  const tested = acs.filter((ac) => linkedTo(ac.id, ['verifies'])).length;
  const storied = brs.filter((br) => linkedTo(br.id, ['serves'])).length;
  return {
    itemId, root, unplaced, gaps,
    counts: Object.fromEntries(Object.keys(TYPE_WORDS).map((t) => [t, of(t).length]).filter(([, n]) => n)),
    coverage: [
      ...(brs.length ? [`${storied} of ${plural(brs.length, 'business requirement')} ${storied === 1 ? 'has' : 'have'} a story`] : []),
      ...(acs.length ? [`${tested} of ${plural(acs.length, 'acceptance criterion', 'acceptance criteria')} ${tested === 1 ? 'has' : 'have'} a test`] : []),
    ],
    text: !root ? `${itemId} is not in the trace yet` : gaps.length ? `${plural(gaps.length, 'missing link')}` : 'Nothing missing',
  };
}
