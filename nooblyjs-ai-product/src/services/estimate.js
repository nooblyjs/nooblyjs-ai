// A business case's cost estimate (NooblyJS Phase 17), from the factory's own history of similar items: the specs of
// the same product, else of the same value stream. Each number says which items it came from, or that there is no
// history yet (then it is 0, and says so, for a person to set).
//
//   agentUsd       the median agent spend of those items, from NooblyJS's event log (host.service('metrics'))
//   cloudUsdMonth  the median month of running their infrastructure in production (host.service('infrastructure'))
//   peopleDays     the median working days they spent in Product, Design and Engineer (the lifecycle's history)
const PEOPLE_STAGES = new Set(['product', 'design', 'engineer']);
const DAY = 86_400_000;
const r2 = (n) => Math.round(n * 100) / 100;
const money = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Working days (Monday to Friday) between two times. */
export function workingDays(from, to) {
  let days = 0;
  for (let t = Date.parse(from); t < Date.parse(to); t += DAY) {
    const left = Math.min(DAY, Date.parse(to) - t);
    if (![0, 6].includes(new Date(t).getUTCDay())) days += left / DAY;
  }
  return days;
}

/** The items like this one: specs of its product, else of its value stream (the catalogue says which products are in it). */
async function similarItems(repos, owner) {
  const specs = (await repos.specs.list()).filter((s) => s.id !== owner.id);
  const byProduct = owner.product ? specs.filter((s) => String(s.product ?? '').toLowerCase() === String(owner.product).toLowerCase()) : [];
  if (byProduct.length) return { items: byProduct.map((s) => s.id).sort(), like: `the ${owner.product} product` };
  const catalogue = (await repos.catalogue.get()) ?? {};
  const stream = owner.valueStream ?? (catalogue.products ?? []).find((p) => String(p.name).toLowerCase() === String(owner.product ?? '').toLowerCase())?.valueStream ?? null;
  if (!stream) return { items: [], like: owner.product ? `the ${owner.product} product` : 'its product' };
  const products = new Set((catalogue.products ?? []).filter((p) => p.valueStream === stream).map((p) => String(p.name).toLowerCase()));
  return { items: specs.filter((s) => products.has(String(s.product ?? '').toLowerCase())).map((s) => s.id).sort(), like: `the ${stream} value stream` };
}

/** @returns {Promise<{ agentUsd, cloudUsdMonth, peopleDays, basis: Array<{ part, text, from: string[] }>, like, at }>} */
export async function estimateFor({ host, repos, owner }) {
  const { items, like } = await similarItems(repos, owner);
  const at = new Date(host.clock?.now?.() ?? Date.now()).toISOString();
  const none = (what) => `No similar item in ${like} has ${what} yet: 0 until a person sets it`;
  const basis = [];

  // Agent spend, per item, from the event log.
  const spend = (await Promise.resolve(host.service?.('metrics')?.spendByItem?.()).catch(() => null)) ?? {};
  const agent = items.map((id) => [id, Number(spend[id] ?? 0)]).filter(([, usd]) => usd > 0);
  const agentUsd = agent.length ? r2(median(agent.map(([, usd]) => usd))) : 0;
  basis.push({ part: 'agentUsd', from: agent.map(([id]) => id), text: agent.length ? `The median agent spend of ${agent.length} similar item${agent.length === 1 ? '' : 's'} in ${like} (${agent.map(([id, usd]) => `${id} ${money(usd)}`).join(', ')}), from the event log` : none('agent spend') });

  // Cloud: a month of each similar item's infrastructure in production.
  const infra = host.service?.('infrastructure');
  const cloud = [];
  for (const id of items) {
    const month = await Promise.resolve(infra?.monthlyCostFor?.(id)).catch(() => null);
    if (month?.usd > 0) cloud.push([id, month]);
  }
  const cloudUsdMonth = cloud.length ? r2(median(cloud.map(([, m]) => m.usd))) : 0;
  basis.push({ part: 'cloudUsdMonth', from: cloud.map(([id]) => id), text: cloud.length ? `The median month in production of ${cloud.length} similar item${cloud.length === 1 ? '' : 's'}' infrastructure (${cloud.map(([id, m]) => `${id}: ${m.design} at ${money(m.perDay)} a day`).join(', ')}), from Infrastructure` : none('infrastructure') });

  // People's days: the working days similar items spent in Product, Design and Engineer.
  const lifecycle = (await Promise.resolve(host.service?.('workflows')?.items?.({})).catch(() => [])) ?? [];
  const days = [];
  for (const id of items) {
    const item = lifecycle.find((i) => i.id === id);
    const spent = (item?.history ?? []).filter((h) => PEOPLE_STAGES.has(h.stage)).reduce((n, h) => n + workingDays(h.enteredAt, h.leftAt ?? at), 0);
    if (spent > 0) days.push([id, r2(spent)]);
  }
  const peopleDays = days.length ? Math.round(median(days.map(([, d]) => d)) * 10) / 10 : 0;
  basis.push({ part: 'peopleDays', from: days.map(([id]) => id), text: days.length ? `The median working days ${days.length} similar item${days.length === 1 ? '' : 's'} spent in Product, Design and Engineer (${days.map(([id, d]) => `${id} ${d}`).join(', ')}), from the lifecycle` : none('a lifecycle history') });

  return { agentUsd, cloudUsdMonth, peopleDays, basis, like, similar: items, at };
}
