// Home · Metrics as a pure function: facts + range + now → the tiles, the weekly chart, spend by system and the stage
// table (Phase 10, product.md §8). No I/O and no clock, so the service, `npm run metrics:reconcile` and the tests all
// call the same code. What each number means is written where it is computed.

export const DAY = 86_400_000;
export const RANGES = {
  '7d': { key: '7d', label: '7 days', words: 'Last 7 days', days: 7 },
  '30d': { key: '30d', label: '30 days', words: 'Last 30 days', days: 30 },
  quarter: { key: 'quarter', label: 'Quarter', words: 'Last quarter (90 days)', days: 90 },
};
// Facts are read from this long before the range starts, so a stage visit or an item that began earlier still has
// its beginning, and the period before the range can be compared.
export const LOOKBACK_DAYS = 120;
export const CHART_WEEKS = 6;

// A stage visit is the time an item spends in one of these groups, from entering it to leaving it. Lifecycle v3
// (Phase 16b) has eight stages; the keys from before still land in the group they belong to now (Specify, UX and UI in
// Product, Architect in Design, Verify in Test), so visits from before still count. Ship stays a legacy group, shown
// only in a period that has one.
export const GROUPS = [
  { key: 'product', label: 'Product', stages: ['discover', 'product', 'specify', 'ux', 'ui'] },
  { key: 'design', label: 'Design', stages: ['design', 'architect'] },
  { key: 'engineer', label: 'Engineer', stages: ['engineer'] },
  { key: 'build', label: 'Build', stages: ['build'] },
  { key: 'test', label: 'Test', stages: ['test', 'verify'] },
  { key: 'release', label: 'Release', stages: ['release'] },
  { key: 'operate', label: 'Operate', stages: ['operate'] },
  { key: 'ship', label: 'Ship (before nine stages)', stages: ['ship'], legacy: true },
];
const GROUP_OF = Object.fromEntries(GROUPS.flatMap((g) => g.stages.map((s) => [s, g.key])));
// The chart's last part is Build and Test to release: the mean Build, Ship (history), Test and Release visits, added
// up. Operate is the time after release, not lead time, so the chart leaves it out. The key stays `buildShip` (its
// colour).
export const CHART_PARTS = [
  { key: 'product', label: 'Product', groups: ['product'] },
  { key: 'design', label: 'Design', groups: ['design'] },
  { key: 'engineer', label: 'Engineer', groups: ['engineer'] },
  { key: 'buildShip', label: 'Build and Test to release', groups: ['build', 'ship', 'test', 'release'] },
];
const SPEND_LABELS = { teammates: 'Digital Teammates', compute: 'Platform compute', product: 'Product Factory', factory: 'Software Factory', knowledge: 'Knowledge', cloud: 'Cloud (Infrastructure)' };

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const sum = (list) => list.reduce((a, b) => a + b, 0);
const mean = (list) => (list.length ? sum(list) / list.length : null);
const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : null);

export function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The 90th percentile by nearest rank: the smallest value with at least 90% of the values at or below it. */
export function p90(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.ceil(0.9 * s.length) - 1];
}

/** Monday 00:00 UTC of the week `ms` is in. */
export function weekStart(ms) {
  const d = new Date(ms);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return midnight - ((d.getUTCDay() + 6) % 7) * DAY;
}

/** The ISO week number of the week starting on Monday `monday`. */
export function isoWeek(monday) {
  const thursday = monday + 3 * DAY;
  const jan1 = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return Math.floor((thursday - jan1) / (7 * DAY)) + 1;
}

/** The first day (ms) whose facts a range needs. */
export const windowStart = (range, now) => now - (RANGES[range].days + LOOKBACK_DAYS) * DAY;

/**
 * Each item's story from its facts: when it was opened, its finished stage visits (with who worked during each and
 * whether it was sent back from there), and when an approval was open. A visit whose beginning is not in the facts
 * is left out, because its length is unknown.
 */
function stories(facts, now) {
  const items = new Map();
  const of = (id) => {
    if (!items.has(id)) items.set(id, { id, createdAt: null, cur: null, visits: [], asks: new Map(), waits: [] });
    return items.get(id);
  };
  const enter = (item, group, t) => { item.cur = group ? { group, start: t, back: false, agent: 0, person: 0 } : null; };
  const leave = (item, t) => {
    if (item.cur) item.visits.push({ item: item.id, ...item.cur, end: t, days: (t - item.cur.start) / DAY });
    item.cur = null;
  };
  for (const f of facts) {
    if (!f.item) continue;
    const item = of(f.item);
    if (f.k === 'created') {
      item.createdAt ??= f.t;
      if (!item.cur) enter(item, GROUP_OF[f.stage], f.t);
    } else if (f.k === 'stage') {
      const from = GROUP_OF[f.from];
      const to = GROUP_OF[f.to];
      // The facts disagree with where we think the item is (events are missing): this visit's length is unknown.
      if (item.cur && item.cur.group !== from) item.cur = null;
      if (item.cur && f.back) item.cur.back = true;
      if (!item.cur) enter(item, to, f.t);
      else if (to !== item.cur.group) {
        leave(item, f.t);
        enter(item, to, f.t);
      }
    } else if (f.k === 'done') leave(item, f.t);
    else if (f.k === 'work') {
      if (item.cur) item.cur[f.who] += 1;
    } else if (f.k === 'ask') item.asks.set(f.key, f.t);
    else if (f.k === 'decide' && item.asks.has(f.key)) {
      item.waits.push([item.asks.get(f.key), f.t]);
      item.asks.delete(f.key);
    }
  }
  for (const item of items.values()) for (const t of item.asks.values()) item.waits.push([t, now]);
  return items;
}

/** How many ms of [start, end] lie inside any of the intervals. */
function overlap(intervals, start, end) {
  let covered = 0;
  let upTo = start;
  for (const [a, b] of [...intervals].sort((x, y) => x[0] - y[0])) {
    const from = Math.max(a, upTo);
    const to = Math.min(b, end);
    if (to > from) {
      covered += to - from;
      upTo = to;
    }
  }
  return covered;
}

/** Pull requests by key, each with its item, gate failures, human edits, merges and the cost behind it. */
function pullRequests(facts) {
  const prs = new Map();
  const of = (key) => {
    if (!prs.has(key)) prs.set(key, { key, item: null, gates: [], edits: [], merges: [], cost: null, runCost: null });
    return prs.get(key);
  };
  for (const f of facts) {
    if (!f.key || !['open', 'gate', 'edit', 'merge', 'run'].includes(f.k)) continue;
    const pr = of(f.key);
    if (f.item) pr.item ??= f.item;
    if (f.k === 'gate') pr.gates.push(f.t);
    else if (f.k === 'edit') pr.edits.push(f.t);
    else if (f.k === 'merge') {
      pr.merges.push(f.t);
      if (f.cost) pr.cost = f.cost;
    } else if (f.k === 'run' && f.cost) pr.runCost = r2((pr.runCost ?? 0) + f.cost);
  }
  return [...prs.values()];
}

/** The pull requests merged in [start, end], each once, with the time of its last merge in that period. */
function mergedIn(prs, start, end) {
  const out = [];
  for (const pr of prs) {
    const at = Math.max(-Infinity, ...pr.merges.filter((t) => t >= start && t <= end));
    if (Number.isFinite(at)) out.push({ ...pr, mergedAt: at });
  }
  return out;
}

/** Idea → merge: per item with a merge in the period, from when it was opened to its last merge there; the median. */
function ideaToMerge(merged, items) {
  const last = new Map();
  for (const pr of merged) if (pr.item) last.set(pr.item, Math.max(last.get(pr.item) ?? -Infinity, pr.mergedAt));
  const days = [];
  for (const [id, at] of last) {
    const createdAt = items.get(id)?.createdAt;
    if (createdAt != null && at >= createdAt) days.push((at - createdAt) / DAY);
  }
  return { days: days.length ? r1(median(days)) : null, items: days.length };
}

function tiles(prs, items, { start, end, previousStart }) {
  const merged = mergedIn(prs, start, end);
  const n = merged.length;
  const none = 'No merged PRs in this period';

  const lead = ideaToMerge(merged, items);
  const before = ideaToMerge(mergedIn(prs, previousStart, start - 1), items);
  const change = lead.days != null && before.days != null ? r1(before.days - lead.days) : null;
  const leadText = lead.days == null ? (n ? 'No merged PR belongs to an item opened in NooblyJS' : none)
    : change == null ? 'Nothing merged in the period before to compare'
      : change > 0 ? `${change.toFixed(1)} d faster than last period`
        : change < 0 ? `${(-change).toFixed(1)} d slower than last period` : 'The same as last period';

  const specs = new Set(merged.map((pr) => pr.item).filter(Boolean)).size;
  const passed = merged.filter((pr) => !pr.gates.some((t) => t <= pr.mergedAt)).length;
  const edited = merged.filter((pr) => pr.edits.some((t) => t <= pr.mergedAt)).length;
  const costs = merged.map((pr) => pr.cost ?? pr.runCost).filter((c) => c != null);

  return {
    ideaToMerge: { days: lead.days, items: lead.items, previousDays: before.days, changeDays: change, text: leadText },
    prsMerged: { count: n, specs, text: n ? `from ${specs} approved spec${specs === 1 ? '' : 's'}` : none },
    firstPass: { percent: pct(passed, n), passed, of: n, text: n ? `${passed} of ${n} passed first time` : none },
    humanEdits: { percent: pct(edited, n), edited, of: n, text: n ? 'of PRs changed before merge' : none },
    costPerPr: {
      usd: costs.length ? r2(sum(costs) / costs.length) : null, of: costs.length,
      text: costs.length ? 'agent runs behind them' : n ? 'No cost was recorded for these PRs' : none,
    },
  };
}

/** Lead time by stage for the six complete weeks before this one, and the sentence under the chart. */
function weeks(visits, items, now) {
  const thisWeek = weekStart(now);
  const rows = [];
  const charted = [];
  for (let i = CHART_WEEKS; i >= 1; i--) {
    const start = thisWeek - i * 7 * DAY;
    const ended = visits.filter((v) => v.end >= start && v.end < start + 7 * DAY);
    charted.push(...ended);
    const parts = {};
    for (const part of CHART_PARTS) {
      const means = part.groups.map((g) => mean(ended.filter((v) => v.group === g).map((v) => v.days))).filter((m) => m != null);
      parts[part.key] = means.length ? r2(sum(means)) : null;
    }
    const known = Object.values(parts).filter((v) => v != null);
    rows.push({ label: `W${isoWeek(start)}`, start: new Date(start).toISOString(), parts, totalDays: known.length ? r1(sum(known)) : null });
  }

  const withData = rows.filter((r) => r.totalDays != null);
  let sentence = 'No stage visit ended in the last six weeks.';
  if (withData.length) {
    const leaders = withData.map((r) => {
      const top = Math.max(...Object.values(r.parts).map((v) => v ?? -1));
      const keys = Object.keys(r.parts).filter((k) => r.parts[k] === top);
      return keys.length === 1 ? keys[0] : null;
    });
    const counts = new Map();
    for (const k of leaders) if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    const [key, times] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!key) sentence = 'No stage is the largest share of the lead time.';
    else {
      const part = CHART_PARTS.find((p) => p.key === key);
      const own = charted.filter((v) => part.groups.includes(v.group));
      const waiting = sum(own.map((v) => overlap(items.get(v.item)?.waits ?? [], v.start, v.end)));
      const total = sum(own.map((v) => v.end - v.start));
      const why = total && waiting / total > 0.5 ? ' — it’s waiting for sign-off, not drafting time.' : '.';
      sentence = times === withData.length
        ? `${part.label} is the largest share ${withData.length === 1 ? 'in the one week with data' : 'every week'}${why}`
        : `${part.label} is the largest share in ${times} of ${withData.length} weeks${why}`;
    }
  }
  return { rows, parts: CHART_PARTS.map(({ key, label }) => ({ key, label })), sentence };
}

function spend(facts, { start, end }) {
  const by = new Map();
  for (const f of facts) if (f.k === 'spend' && f.t >= start && f.t <= end) by.set(f.system, (by.get(f.system) ?? 0) + f.cost);
  const rows = [...by].map(([key, usd]) => ({ key, label: SPEND_LABELS[key] ?? key, usd: r2(usd) })).sort((a, b) => b.usd - a.usd || a.label.localeCompare(b.label));
  const top = rows[0]?.usd ?? 0;
  return { totalUsd: r2(sum(rows.map((r) => r.usd))), rows: rows.map((r) => ({ ...r, ratio: top ? r2(r.usd / top) : 0 })) };
}

/**
 * Who does the work, by stage: over the visits that ended in the range, how long they took (median and p90), how
 * many had the item sent back from there, and how the events during them split between agents and people.
 */
function stages(visits, { start, end }) {
  const rows = GROUPS.map((g) => {
    const own = visits.filter((v) => v.group === g.key && v.end >= start && v.end <= end);
    const days = own.map((v) => v.days);
    const agent = sum(own.map((v) => v.agent));
    const person = sum(own.map((v) => v.person));
    const agentPct = pct(agent, agent + person);
    return {
      key: g.key, label: g.label, visits: own.length,
      agentPct, peoplePct: agentPct == null ? null : 100 - agentPct,
      medianDays: days.length ? r1(median(days)) : null, p90Days: days.length ? r1(p90(days)) : null,
      sentBackPct: pct(own.filter((v) => v.back).length, own.length),
    };
  });
  const shown = rows.filter((r) => !GROUPS.find((g) => g.key === r.key)?.legacy || r.visits);
  const slowest = Math.max(...shown.map((r) => r.p90Days ?? -1));
  return shown.map((r) => ({ ...r, slowest: slowest > 0 && r.p90Days === slowest }));
}

const WAITING = { 'build-approval': 'Build approval', 'test-approval': 'Test approval' };
const hoursText = (h) => (h < 1 ? 'under an hour' : h < 48 ? `${Math.round(h)} h` : `${r1(h / 24)} d`);

/**
 * Pull requests waiting on a person now (Phase 16e): each Build and Test approval asked for and not yet decided or
 * withdrawn, with how long the oldest has waited. A merge (the item's `merge` approval, from before) counts as a Build
 * approval.
 */
function waitingNow(facts, now) {
  const open = new Map();
  for (const f of facts) {
    if (f.k === 'ask' && (WAITING[f.type] || f.type === 'merge')) open.set(f.key, { type: f.type === 'merge' ? 'build-approval' : f.type, t: f.t, item: f.item });
    else if (f.k === 'decide') open.delete(f.key);
  }
  return Object.entries(WAITING).map(([type, label]) => {
    const ages = [...open.values()].filter((o) => o.type === type).map((o) => (now - o.t) / 3_600_000).sort((a, b) => b - a);
    return {
      key: type, label: `Pull requests waiting on a ${label}`, count: ages.length, oldestHours: ages.length ? r1(ages[0]) : null,
      text: ages.length ? `${ages.length} waiting · the oldest for ${hoursText(ages[0])}` : 'None waiting',
    };
  });
}

/**
 * The metrics of one range. `facts` are the facts from windowStart(range, now) on, in any order; `now` is ms.
 */
export function compute(facts, { range = '30d', now }) {
  const r = RANGES[range];
  if (!r) throw new Error(`There is no range "${range}".`);
  const end = now;
  const start = end - r.days * DAY;
  const previousStart = start - r.days * DAY;
  const sorted = facts
    .map((f, i) => [f, i])
    .filter(([f]) => f && Number.isFinite(f.t) && f.t <= end)
    .sort((a, b) => a[0].t - b[0].t || a[1] - b[1])
    .map(([f]) => f);
  const items = stories(sorted, end);
  const visits = [...items.values()].flatMap((item) => item.visits);
  const period = { start, end, previousStart };
  return {
    at: new Date(end).toISOString(),
    range: { key: r.key, label: r.label, words: r.words, days: r.days, start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    tiles: tiles(pullRequests(sorted), items, period),
    weeks: weeks(visits, items, end),
    spend: spend(sorted, period),
    stages: stages(visits, period),
    waiting: waitingNow(sorted, end),
    production: production(sorted, items, period, r.days),
  };
}

/**
 * Phase 23: production, the DORA way, in the period. Deployment frequency: steps of releases into production. Change
 * failure rate: releases deployed in the period that were rolled back or had an incident. Time to restore: the median
 * from an incident's declaring to its resolving. Idea → outcome: items closed with their outcome review, from opening.
 */
function production(facts, items, { start, end }, days) {
  const inPeriod = facts.filter((f) => f.t >= start && f.t <= end);
  const deploys = inPeriod.filter((f) => f.k === 'deploy');
  const released = [...new Set(deploys.map((f) => f.key))];
  const failed = new Set(facts.filter((f) => f.k === 'fail' && f.t >= start).map((f) => f.key));
  const failures = released.filter((k) => failed.has(k)).length;
  const restores = inPeriod.filter((f) => f.k === 'restore').map((f) => f.ms);
  const restoreMin = restores.length ? Math.round(median(restores) / 60_000) : null;
  const outcomes = inPeriod.filter((f) => f.k === 'outcome');
  const ideaToOutcome = outcomes.map((f) => { const opened = items.get(f.item)?.createdAt; return opened != null ? (f.t - opened) / DAY : null; }).filter((d) => d != null);
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return {
    deploymentFrequency: { deploys: deploys.length, releases: released.length, text: deploys.length ? `${plural(deploys.length, 'deploy')} to production in ${days} days (${plural(released.length, 'release')})` : `No deploys to production in ${days} days` },
    changeFailureRate: { failed: failures, of: released.length, text: released.length ? `${failures} of ${released.length} (${Math.round((failures / released.length) * 100)}%) rolled back or had an incident` : 'No releases deployed in the period' },
    timeToRestore: { minutes: restoreMin, incidents: restores.length, text: restores.length ? `${restoreMin} minutes (median of ${plural(restores.length, 'incident')})` : 'No incidents resolved in the period' },
    ideaToOutcome: { items: outcomes.length, days: ideaToOutcome.length ? Math.round(median(ideaToOutcome) * 10) / 10 : null, goalsMet: outcomes.reduce((n, f) => n + f.met, 0), goals: outcomes.reduce((n, f) => n + f.goals, 0), text: outcomes.length ? `${plural(outcomes.length, 'item')} closed with an outcome review${ideaToOutcome.length ? `, ${Math.round(median(ideaToOutcome) * 10) / 10} d from opening` : ''}; ${outcomes.reduce((n, f) => n + f.met, 0)} of ${outcomes.reduce((n, f) => n + f.goals, 0)} goals met` : 'No item closed with an outcome review in the period' },
  };
}
