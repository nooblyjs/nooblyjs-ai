// The sample history for Home · Metrics (Phase 10): about seven weeks of events from which the metrics service
// computes the numbers of the mockup (noobly-platform-metrics). Nothing here is a metric: these are ordinary events
// (item.created, item.stage_changed, pr.merged, …) marked `sampleHistory: true`, so Activity leaves them out, and
// `npm run metrics:reconcile` covers them like any others.
//
// It is built per metric, not as one coherent set of items: stage visits, pull requests and spend are separate sample
// items. Everything is placed relative to the Monday of the week of seeding (M), so the numbers do not depend on the
// weekday: the last 30 days always contain [M − 23 d, now) and never anything before M − 30 d. What must count in
// "30 days" ends from the Saturday of the fourth week back onwards; what must only count in the chart's first two
// weeks, or in the period before, ends on a Monday to Thursday of those weeks. Lengths are whole tenths of a day.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { daySegments } from '../util/dates.js';
import { ANCHOR as STORY_ANCHOR } from '../lifecycle/seed/index.js';

const STORY_ITEMS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lifecycle', 'seed', 'data', 'items');

const DAY = 86_400_000;
const TENTH = DAY / 10;
const HOUR = 3_600_000;

// Per stage group: `weeks` are the mean visit lengths (tenths of a day) for the six charted weeks, oldest first;
// the last four are in the 30 days and hold `n` visits with this median, p90 and number sent back. `agents` is the
// share of the events during those visits that agents caused. The mockup's "Build & ship" part is build + ship.
const STAGES = [
  { key: 'product', first: 'specify', next: 'architect', n: 50, median: 14, p90: 30, back: 4, agents: 78, weeks: [30, 28, 27, 26, 25, 24] },
  { key: 'architecture', first: 'architect', next: 'ux', prev: 'specify', n: 42, median: 26, p90: 58, back: 5, agents: 62, weeks: [34, 31, 30, 29, 27, 26], approval: true },
  { key: 'design', first: 'ui', next: 'build', prev: 'architect', n: 48, median: 21, p90: 42, back: 3, agents: 55, weeks: [20, 19, 18, 17, 17, 16] },
  { key: 'build', first: 'build', next: 'ship', prev: 'ui', n: 50, median: 6, p90: 14, back: 9, agents: 91, weeks: [16, 15, 14, 12, 12, 11], movedBySystem: true },
  { key: 'ship', first: 'ship', next: null, prev: 'build', n: 40, median: 4, p90: 11, back: 1, agents: 35, weeks: [12, 11, 10, 9, 8, 8], openedBySystem: true },
];

// Pull requests. In the 30 days: 11 items with 37 merged PRs (the seed story's PR #476 is the 38th, from a 12th),
// 11 of which failed a gate first and 7 of which a person changed. `LEAD` is each item's idea → last merge in tenths
// of a day (median 9.1 d); the period before has 7 items with a median of 10.9 d.
const MERGES_PER_ITEM = [5, 4, 4, 4, 3, 3, 3, 3, 3, 3, 2];
const LEAD = [62, 70, 78, 84, 88, 91, 97, 104, 112, 125, 140];
const LEAD_BEFORE = [88, 96, 103, 109, 118, 126, 139];
const BEFORE_DAYS_BACK = [41.5, 40.5, 39.5, 38.5, 34.5, 33.5, 32.5];
const PR_COST_CENTS = 22_760; // with the story's $4.20: 38 PRs at $6.10
// Spend in the 30 days, in USD: [system, event type, amount].
const SPEND = [
  ['teammates', 'teammate.task_finished', 1816],
  ['platform', 'compute.metered', 1140],
  ['product', 'teammate.task_finished', 412],
  ['factory', 'run.finished', 318],
  ['knowledge', 'teammate.task_finished', 96],
];
const SPEND_DAYS = 23;

const AGENT = { actor: 'sample-agent', actorKind: 'agent', actorName: 'Sample agent' };
const PERSON = { actor: 'sample-person', actorKind: 'person', actorName: 'Sample person' };
const SYSTEM = { actor: 'system' };

/** Monday 00:00 UTC of the week `ms` is in. */
function monday(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY;
}

/**
 * `n` visit lengths (tenths of a day) in four weeks, with this median and p90 (nearest rank) over all of them and
 * the given mean in each week. Values at or below the median, between it and the p90, and above it are dealt to the
 * weeks in turn; each week's are then moved within their bounds until the week's sum is right.
 */
export function visitLengths({ n, median, p90, means }) {
  const rank90 = Math.ceil(0.9 * n);
  const middle = n % 2 ? [(n + 1) / 2] : [n / 2, n / 2 + 1];
  const kinds = [];
  for (let rank = n; rank > rank90; rank--) kinds.push('high');
  kinds.push('p90');
  for (const _ of middle) kinds.push('median');
  for (let rank = middle.at(-1) + 1; rank < rank90; rank++) kinds.push('mid');
  for (let rank = 1; rank < middle[0]; rank++) kinds.push('low');
  const bounds = { low: [1, median], median: [median, median], mid: [median, p90], p90: [p90, p90], high: [p90, Infinity] };
  const weeks = means.map(() => []);
  kinds.forEach((kind, i) => {
    const [lo, hi] = bounds[kind];
    const spread = ((i * 7) % 10) / 10;
    const value = kind === 'low' ? Math.max(lo, Math.round(hi * (0.4 + 0.5 * spread))) : kind === 'mid' ? lo + Math.round((hi - lo) * spread) : lo;
    weeks[i % weeks.length].push({ kind, lo, hi, value });
  });
  weeks.forEach((week, w) => {
    let diff = means[w] * week.length - week.reduce((a, e) => a + e.value, 0);
    const highs = week.filter((e) => e.kind === 'high');
    if (diff > 0 && highs.length) {
      // The long tail the mockup's numbers imply (a mean well above the median) is in the few longest visits.
      highs.forEach((e, i) => { e.value += Math.floor(diff / highs.length) + (i < diff % highs.length ? 1 : 0); });
      diff = 0;
    }
    for (const kind of diff > 0 ? ['mid', 'low'] : ['low', 'mid', 'high']) {
      const step = diff > 0 ? 1 : -1;
      for (;;) {
        const room = week.filter((e) => e.kind === kind && (step > 0 ? e.value < e.hi : e.value > e.lo));
        if (!diff || !room.length) break;
        const e = room.reduce((a, b) => (step > 0 ? (b.value < a.value ? b : a) : (b.value > a.value ? b : a)));
        e.value += step;
        diff -= step;
      }
    }
    if (diff) throw new Error(`metrics sample history: week ${w} of a stage cannot have a mean of ${means[w] / 10} d.`);
  });
  return weeks.map((week) => week.map((e) => e.value));
}

/** The smallest numbers of extra agent and person events that make agents this percentage of all of them. */
function extrasFor(agent, person, target) {
  for (let total = 0; total < 2000; total++) {
    for (let p = 0; p <= total; p++) {
      const a = total - p;
      if (Math.round((100 * (agent + a)) / (agent + a + person + p)) === target) return { agent: a, person: p };
    }
  }
  throw new Error(`metrics sample history: no mix of events gives ${target}% agents.`);
}

/**
 * The sample events (no ids yet), for seeding at `now` (ISO).
 */
export function sampleHistory(now) {
  const M = monday(new Date(now).getTime());
  const events = [];
  const say = (t, type, who, payload) => {
    const { actor, ...kind } = who;
    events.push({ type, at: new Date(Math.round(t)).toISOString(), actor, payload: { ...payload, ...kind, sampleHistory: true, sampleData: true } });
  };

  // ---------- Stage visits ----------
  // The windows visits end in: the chart's first two weeks (Monday to Thursday), then the four weeks in the range
  // (the first of them from Saturday).
  const windows = [[-42, -38], [-35, -31], [-23, -21], [-21, -14], [-14, -7], [-7, 0]].map(([a, b]) => [M + a * DAY, M + b * DAY]);
  for (const stage of STAGES) {
    const inRange = visitLengths({ n: stage.n, median: stage.median, p90: stage.p90, means: stage.weeks.slice(2) });
    const before = stage.weeks.slice(0, 2).map((mean) => [-3, -1, 1, 3].map((d) => mean + d));
    const visits = [];
    [...before, ...inRange].forEach((lengths, w) => {
      const [from, to] = windows[w];
      lengths.forEach((tenths, i) => {
        const end = from + Math.round(((i + 0.5) / lengths.length) * (to - from) / 60_000) * 60_000;
        visits.push({ id: `SMP-${stage.key.toUpperCase()}-${String(visits.length + 1).padStart(3, '0')}`, start: end - tenths * TENTH, end, counted: w >= 2, back: false });
      });
    });
    const counted = visits.filter((v) => v.counted);
    for (let k = 0; k < stage.back; k++) counted[Math.floor(((k + 0.5) * counted.length) / stage.back)].back = true;

    let agent = 0;
    let person = 0;
    const count = (who) => { if (who === AGENT) agent += 1; else if (who === PERSON) person += 1; };
    for (const v of visits) {
      const item = { itemId: v.id, system: 'product' };
      const tally = v.counted ? count : () => {};
      const opener = stage.openedBySystem ? SYSTEM : AGENT;
      say(v.start, 'item.created', opener, { ...item, stage: stage.first });
      tally(opener);
      if (stage.approval) {
        // Drafted in the first quarter, then waiting for sign-off until the decision that ends the visit.
        say(v.start + (v.end - v.start) / 4, 'approval.requested', AGENT, { ...item, approvalId: `apr_${v.id}`, type: 'adr' });
        say(v.end - 60_000, 'approval.decided', PERSON, { ...item, approvalId: `apr_${v.id}`, type: 'adr', decision: v.back ? 'request-changes' : 'approve', outcome: v.back ? 'changes-requested' : 'approved' });
        tally(AGENT);
        tally(PERSON);
      }
      if (v.back && !stage.prev) {
        // Product has nothing before it: a spec is sent back from Specify to Discover, and comes forward again.
        say(v.start + (v.end - v.start) / 2, 'item.sent_back', PERSON, { ...item, from: 'specify', to: 'discover', reason: 'sample' });
        say(v.start + ((v.end - v.start) * 3) / 4, 'item.stage_changed', PERSON, { ...item, from: 'discover', to: 'specify' });
        say(v.end, 'item.stage_changed', PERSON, { ...item, from: 'specify', to: stage.next });
        tally(PERSON); tally(PERSON); tally(PERSON);
      } else if (v.back) {
        say(v.end, 'item.sent_back', PERSON, { ...item, from: stage.first, to: stage.prev, reason: 'sample' });
        tally(PERSON);
      } else if (stage.next) {
        const mover = stage.movedBySystem ? SYSTEM : PERSON;
        say(v.end, 'item.stage_changed', mover, { ...item, from: stage.first, to: stage.next });
        tally(mover);
      } else {
        say(v.end, 'item.completed', PERSON, item);
        tally(PERSON);
      }
    }
    // The rest of the work during the counted visits, so agents and people share it as the mockup says.
    const extra = extrasFor(agent, person, stage.agents);
    const more = [...Array(extra.agent).fill(AGENT), ...Array(extra.person).fill(PERSON)];
    more.forEach((who, k) => {
      const v = counted[k % counted.length];
      const nth = Math.floor(k / counted.length) + 1;
      const perVisit = Math.ceil(more.length / counted.length);
      say(v.start + ((v.end - v.start) * nth) / (perVisit + 2), who === AGENT ? 'agent.action' : 'item.commented', who, { itemId: v.id, system: 'product' });
    });
  }

  // ---------- Pull requests ----------
  let pr = 0;
  const costs = [];
  const total = MERGES_PER_ITEM.reduce((a, b) => a + b, 0);
  for (let i = 0; i < total - 1; i++) costs.push(500 + ((i * 37) % 240));
  costs.push(PR_COST_CENTS - costs.reduce((a, b) => a + b, 0));
  const pullRequest = (itemId, mergedAt, { cents, gate = false, edit = false }) => {
    const base = { itemId, system: 'factory', runId: `smp_run_${String(++pr).padStart(3, '0')}`, repo: 'web-storefront' };
    say(mergedAt - 20 * HOUR, 'pr.opened', AGENT, base);
    if (gate) say(mergedAt - 15 * HOUR, 'gate.failed', SYSTEM, base);
    if (edit) say(mergedAt - 5 * HOUR, 'pr.human_edit', PERSON, base);
    say(mergedAt, 'pr.merged', PERSON, { ...base, costUsd: cents / 100, costNote: 'total' });
  };
  let nth = 0;
  MERGES_PER_ITEM.forEach((merges, j) => {
    const itemId = `SMP-PR-${String(j + 1).padStart(2, '0')}`;
    const last = M - (1 + 2 * j) * DAY + 10 * HOUR;
    say(last - LEAD[j] * TENTH, 'item.created', PERSON, { itemId, system: 'product', stage: 'specify' });
    for (let k = merges - 1; k >= 0; k--) {
      pullRequest(itemId, last - k * 6 * HOUR, { cents: costs[nth], gate: [1, 4, 7].includes(nth % 10), edit: nth % 5 === 2 });
      nth += 1;
    }
  });
  LEAD_BEFORE.forEach((lead, j) => {
    const itemId = `SMP-PR-B${j + 1}`;
    const mergedAt = M - BEFORE_DAYS_BACK[j] * DAY;
    say(mergedAt - lead * TENTH, 'item.created', PERSON, { itemId, system: 'product', stage: 'specify' });
    pullRequest(itemId, mergedAt, { cents: 640 });
  });

  // ---------- Spend ----------
  for (const [system, type, usd] of SPEND) {
    const share = Math.floor((usd * 100) / SPEND_DAYS);
    for (let d = 1; d <= SPEND_DAYS; d++) {
      const cents = d === 1 ? usd * 100 - share * (SPEND_DAYS - 1) : share;
      say(M - d * DAY + 12 * HOUR, type, type === 'compute.metered' ? SYSTEM : AGENT, {
        system, costUsd: cents / 100, ...(type === 'run.finished' ? { runId: `smp_spend_${system}_${d}`, outcome: 'delivered', workType: 'implementation' } : {}),
      });
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * When each item in flight entered the stage it is in, as events. The items of the seed story (and of a data folder
 * from before Phase 10) are files with no events behind them, so without these a stage visit that ends when someone
 * approves or sends one back would have no beginning and could not be measured. They read the items already in
 * data/workflows/, or on a fresh seed the story's own files, moved to `now` as the lifecycle seed moves them.
 */
async function stageEntries(store, now) {
  const front = (text) => yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text ?? '')?.[1] ?? '', { schema: yaml.CORE_SCHEMA }) ?? {};
  let items;
  let shift = 0;
  const live = await store.list(['workflows', 'items']);
  if (live.length) {
    items = await Promise.all(live.map(async (name) => front(await store.readText(['workflows', 'items', name]))));
  } else {
    shift = new Date(now).getTime() - new Date(STORY_ANCHOR).getTime();
    const names = (await fs.readdir(STORY_ITEMS)).filter((n) => n.endsWith('.md')).sort();
    items = await Promise.all(names.map(async (name) => front(await fs.readFile(path.join(STORY_ITEMS, name), 'utf8'))));
  }
  const events = [];
  for (const item of items) {
    const entered = Date.parse(item.stageEnteredAt);
    if (item.status !== 'active' || !item.id || !item.stage || !Number.isFinite(entered)) continue;
    const before = (item.history ?? []).at(-2)?.stage ?? item.stage;
    events.push({
      type: 'item.stage_changed', at: new Date(entered + shift).toISOString(), actor: 'system',
      payload: { itemId: item.id, system: item.system ?? 'product', from: before, to: item.stage, sampleHistory: true, sampleData: true },
    });
  }
  return events;
}

/**
 * Writes the sample history into data/events/, once (data/metrics/sample-history.yaml records that it was done).
 * Returns the files it wrote.
 * @param {import('nooblyjs-core/src/store/fs-store.js').FsStore} store  rooted at DATA_DIR
 */
export async function seedMetricsHistory(store, { now = new Date().toISOString() } = {}) {
  const marker = ['metrics', 'sample-history.yaml'];
  if (await store.exists(marker)) return [];
  const events = [...sampleHistory(now), ...await stageEntries(store, now)].sort((a, b) => a.at.localeCompare(b.at));
  const days = new Map();
  events.forEach((event, i) => {
    const key = daySegments(event.at).join('/');
    if (!days.has(key)) days.set(key, []);
    days.get(key).push({ id: `evt_smp${String(i + 1).padStart(5, '0')}`, ...event });
  });
  // A day's sample events are appended in one write. A day may already have events (the seed story's, or real ones
  // in a data folder from before Phase 10): readers sort by time, so the order in the file does not matter.
  for (const [key, records] of days) {
    const segments = ['events', ...key.split('/')];
    const text = records.map((record) => `---
${yaml.dump(record, { lineWidth: 120, noRefs: true })}`).join('');
    await store.writeText(segments, `${(await store.readText(segments)) ?? ''}${text}`);
  }
  await store.writeYaml(marker, { seededAt: now, events: events.length, sampleData: true, note: 'Sample history for Home · Metrics. Its events carry sampleHistory: true.' });
  return [...[...days.keys()].map((k) => `events/${k}`), marker.join('/')];
}
