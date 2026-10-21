// Spend by where the work sits (Phase 17, root product.md §3.3): this month's agent spend and cloud spend per value
// stream, and each portfolio against its budget (Platform · Settings · Budgets). compute.js stays pure; this places
// facts, so it asks the apps:
//
//   agent spend   each `spend` fact that names an item (facts.js), through the item's parents (a pull request → its
//                 story → its item) to the item's product, and the product's value stream and portfolio (the Product
//                 section's placeOf)
//   cloud spend   Infrastructure's ledger shared across its environments by their cost a day, through each
//                 environment's design and the item it was built for (its cloudByItem)
//
// What can't be placed (spend on no item, an environment of no design) is said, not hidden.
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const monthStart = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };

export function createPlaces({ services, log = console }) {
  const svc = (name) => services?.get?.(name) ?? null;

  /** item id → its root item (the item with no parent), through the lifecycle. */
  async function rootsOf() {
    const items = (await Promise.resolve(svc('workflows')?.items?.({})).catch(() => [])) ?? [];
    const parent = new Map(items.map((i) => [i.id, i.parentId ?? null]));
    return (id) => {
      let at = id;
      for (let hops = 0; hops < 5 && parent.get(at); hops++) at = parent.get(at);
      return at;
    };
  }

  /** Agent spend per root item, from the facts (all of them, or those from `since`). */
  async function spendByItem(facts, { since = 0 } = {}) {
    const root = await rootsOf();
    const out = {};
    for (const f of facts) {
      if (f.k !== 'spend' || !f.item || f.system === 'cloud' || f.t < since) continue;
      const id = root(f.item);
      out[id] = r2((out[id] ?? 0) + f.cost);
    }
    return out;
  }

  /** This month's agent and cloud spend per value stream and per portfolio, against the portfolio budgets. */
  async function byValueStream(facts, now) {
    const since = monthStart(now);
    const month = new Date(now).toISOString().slice(0, 7);
    const agentByItem = await spendByItem(facts, { since });
    const unplacedAgent = r2(facts.filter((f) => f.k === 'spend' && !f.item && f.system !== 'cloud' && f.t >= since && f.t <= now).reduce((n, f) => n + f.cost, 0));
    const cloud = (await Promise.resolve(svc('infrastructure')?.cloudByItem?.(month)).catch((err) => { log.warn?.(`metrics: cloud by item: ${err.message}`); return null; })) ?? null;
    const product = svc('product');
    const places = new Map();
    const placeOf = async (id) => {
      if (!places.has(id)) places.set(id, (await Promise.resolve(product?.placeOf?.(id)).catch(() => null)) ?? null);
      return places.get(id);
    };
    const streams = new Map();
    const unplaced = { agentUsd: unplacedAgent, cloudUsd: r2(cloud?.unattributed ?? 0), items: [] };
    const add = async (id, part, usd) => {
      const p = await placeOf(id);
      if (!p?.valueStream && !p?.portfolio) {
        unplaced[part] = r2(unplaced[part] + usd);
        if (!unplaced.items.includes(id)) unplaced.items.push(id);
        return;
      }
      const key = `${p.portfolio ?? ''}|${p.valueStream ?? ''}`;
      const row = streams.get(key) ?? { portfolio: p.portfolio ?? null, valueStream: p.valueStream ?? null, agentUsd: 0, cloudUsd: 0, items: [] };
      row[part] = r2(row[part] + usd);
      if (!row.items.includes(id)) row.items.push(id);
      streams.set(key, row);
    };
    for (const [id, usd] of Object.entries(agentByItem)) await add(id, 'agentUsd', usd);
    for (const [id, usd] of Object.entries(cloud?.items ?? {})) await add(id, 'cloudUsd', usd);

    const rows = [...streams.values()].map((r) => ({ ...r, totalUsd: r2(r.agentUsd + r.cloudUsd), items: r.items.sort() }))
      .sort((a, b) => b.totalUsd - a.totalUsd || String(a.valueStream).localeCompare(String(b.valueStream)));
    const budgets = (await Promise.resolve(svc('platform')?.budgets?.read?.()).catch(() => null))?.portfolios ?? [];
    const names = [...new Set([...rows.map((r) => r.portfolio).filter(Boolean), ...budgets.map((b) => b.name)])].sort();
    const portfolios = names.map((name) => {
      const own = rows.filter((r) => r.portfolio === name);
      const agentUsd = r2(own.reduce((n, r) => n + r.agentUsd, 0));
      const cloudUsd = r2(own.reduce((n, r) => n + r.cloudUsd, 0));
      const totalUsd = r2(agentUsd + cloudUsd);
      const budget = budgets.find((b) => b.name === name)?.monthly ?? null;
      return {
        name, agentUsd, cloudUsd, totalUsd, budgetUsd: budget, ratio: budget ? r2(totalUsd / budget) : null,
        text: budget ? `${money(totalUsd)} of ${money(budget)} this month${totalUsd > budget ? ' · over budget' : ''}` : `${money(totalUsd)} this month · no budget set`,
      };
    });
    return {
      month,
      rows,
      portfolios,
      unplaced: { ...unplaced, items: unplaced.items.sort(), text: unplaced.agentUsd || unplaced.cloudUsd ? `${money(unplaced.agentUsd)} agent and ${money(unplaced.cloudUsd)} cloud spend this month is on no item or environment the factory can place` : 'Everything spent this month is placed' },
      cloud: cloud ? { basis: cloud.basis ?? null } : { basis: 'Infrastructure is not running here' },
      text: rows.length ? `${money(rows.reduce((n, r) => n + r.totalUsd, 0))} placed across ${rows.length} value stream${rows.length === 1 ? '' : 's'} this month` : 'Nothing spent this month is placed in a value stream yet',
    };
  }

  return { spendByItem, byValueStream };
}
