// Metrics as functions (src/services/metrics/): an event becomes facts, and facts become the numbers. Small
// hand-made histories, no files and no clock. The seeded numbers and the API are in test/metrics.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { factsOf, factsOfDay, whoOf } from '../../src/services/metrics/facts.js';
import { compute, median, p90, weekStart, isoWeek, DAY } from '../../src/services/metrics/compute.js';
import { visitLengths } from '../../src/seed/metrics-history.js';

const NOW = Date.parse('2026-10-08T12:00:00.000Z'); // a Thursday in ISO week 41
const dir = { people: new Map([['stevie', {}], ['lerato-m', {}]]), agents: new Set(['ada-quill']) };
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const ev = (daysAgo, type, actor, payload = {}) => ({ type, at: at(daysAgo), actor, payload });
const metrics = (events, range = '30d') => compute(factsOfDay(events, dir), { range, now: NOW });

test('who did it: a person, an agent, or nobody for the system and for strangers', () => {
  assert.equal(whoOf({ actor: 'stevie' }, dir), 'person');
  assert.equal(whoOf({ actor: 'ada-quill' }, dir), 'agent');
  assert.equal(whoOf({ actor: 'ui-agent', payload: { actorKind: 'agent' } }, dir), 'agent');
  assert.equal(whoOf({ actor: 'system' }, dir), null);
  assert.equal(whoOf({ actor: 'someone-else' }, dir), null);
});

test('facts: each event type gives its facts, and the rest give nothing', () => {
  const kinds = (event) => factsOf(event, dir).map((f) => f.k);
  assert.deepEqual(kinds(ev(1, 'item.created', 'stevie', { itemId: 'A', stage: 'specify' })), ['created', 'work']);
  assert.deepEqual(kinds(ev(1, 'item.stage_changed', 'stevie', { itemId: 'A', from: 'specify', to: 'architect' })), ['work', 'stage']);
  assert.deepEqual(factsOf(ev(1, 'item.sent_back', 'stevie', { itemId: 'A', from: 'architect', to: 'specify' }), dir).at(-1).back, true);
  assert.deepEqual(kinds(ev(1, 'item.completed', 'system', { itemId: 'A' })), ['done']);
  assert.deepEqual(kinds(ev(1, 'approval.requested', 'ada-quill', { itemId: 'A', approvalId: 'apr_1' })), ['work', 'ask']);
  // One of two reviewers approving leaves the approval open.
  assert.deepEqual(kinds(ev(1, 'approval.decided', 'stevie', { itemId: 'A', approvalId: 'apr_1', outcome: 'pending' })), ['work']);
  assert.deepEqual(kinds(ev(1, 'approval.decided', 'stevie', { itemId: 'A', approvalId: 'apr_1', outcome: 'approved' })), ['work', 'decide']);
  assert.deepEqual(kinds(ev(1, 'pr.merged', 'stevie', { itemId: 'A', runId: 'run_1', costUsd: 4.2 })), ['work', 'merge']);
  assert.deepEqual(kinds(ev(1, 'gate.failed', 'system', { runId: 'run_1' })), ['gate']);
  assert.deepEqual(factsOf(ev(1, 'run.finished', 'system', { runId: 'run_1', system: 'factory', costUsd: 2 }), dir).map((f) => [f.k, f.system ?? f.key, f.cost]), [['run', 'run_1', 2], ['spend', 'factory', 2]]);
  assert.deepEqual(factsOf(ev(1, 'teammate.task_finished', 'ada-quill', { itemId: 'A', system: 'product', costUsd: 0.5 }), dir).map((f) => [f.k, f.system]), [['spend', 'product']]);
  assert.deepEqual(factsOf(ev(1, 'compute.metered', 'system', { system: 'platform', costUsd: 3 }), dir).map((f) => [f.k, f.system]), [['spend', 'compute']]);

  // A sign-in is not work; an unknown type, a broken record and a missing field are ignored, never an error.
  assert.deepEqual(kinds(ev(1, 'session.signed_in', 'stevie', { itemId: 'A' })), []);
  assert.deepEqual(kinds(ev(1, 'weather.changed', 'system', { wind: 'south-easter' })), []);
  assert.deepEqual(kinds(ev(1, 'item.stage_changed', 'stevie', { itemId: 'A' })), ['work']);
  assert.deepEqual(factsOfDay([null, 'text', { type: 'pr.merged' }, { type: 5, at: at(1) }, { type: 'pr.merged', at: 'never', payload: { itemId: 'A' } }], dir), []);
});

test('median, p90 by nearest rank, weeks', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(p90([5]), 5);
  assert.equal(new Date(weekStart(NOW)).toISOString(), '2026-10-05T00:00:00.000Z');
  assert.equal(isoWeek(weekStart(NOW)), 41);
  assert.equal(isoWeek(Date.parse('2026-12-28T00:00:00.000Z')), 53);
  assert.equal(isoWeek(Date.parse('2027-01-04T00:00:00.000Z')), 1);
});

test('an empty period says so: no value, never a measured zero', () => {
  const m = metrics([]);
  assert.equal(m.tiles.ideaToMerge.days, null);
  assert.equal(m.tiles.prsMerged.count, 0);
  for (const key of ['firstPass', 'humanEdits']) assert.equal(m.tiles[key].percent, null);
  assert.equal(m.tiles.costPerPr.usd, null);
  assert.equal(m.tiles.prsMerged.text, 'No merged PRs in this period');
  assert.deepEqual(m.weeks.rows.map((r) => r.totalDays), [null, null, null, null, null, null]);
  assert.equal(m.weeks.sentence, 'No stage visit ended in the last six weeks.');
  assert.deepEqual([m.spend.totalUsd, m.spend.rows], [0, []]);
  // Seven groups since lifecycle v3 (Phase 16b); Ship, from before, shows only in a period that has a visit to it.
  assert.deepEqual(m.stages.map((s) => s.key), ['product', 'design', 'engineer', 'build', 'test', 'release', 'operate']);
  assert.deepEqual(m.stages.map((s) => [s.visits, s.medianDays, s.agentPct, s.sentBackPct, s.slowest]), Array(7).fill([0, null, null, null, false]));
});

test('pull requests: merged, from how many items, first pass, changed by a person, cost and idea → merge against the period before', () => {
  const events = [
    // Item A, opened 10 days ago: two PRs, the second merged 2 days ago after a gate failure and a human edit.
    ev(10, 'item.created', 'stevie', { itemId: 'A', stage: 'specify' }),
    ev(5, 'pr.merged', 'stevie', { itemId: 'A', runId: 'r1', costUsd: 5 }),
    ev(3, 'gate.failed', 'system', { runId: 'r2' }),
    ev(2.5, 'pr.human_edit', 'stevie', { runId: 'r2', itemId: 'A' }),
    ev(2, 'pr.merged', 'stevie', { itemId: 'A', runId: 'r2', costUsd: 9 }),
    // Item B, opened 9 days ago, merged 5 days ago; its cost is the run's. A gate failure after the merge is not its.
    ev(9, 'item.created', 'stevie', { itemId: 'B', stage: 'specify' }),
    ev(6, 'run.finished', 'system', { runId: 'r3', system: 'factory', costUsd: 4 }),
    ev(5, 'pr.merged', 'stevie', { itemId: 'B', runId: 'r3' }),
    ev(1, 'gate.failed', 'system', { runId: 'r3' }),
    // A PR of something that is not an item in the log (no beginning): merged and counted, but no lead time.
    ev(4, 'pr.merged', 'stevie', { itemId: 'web-storefront-476', costUsd: 6 }),
    // The period before: item C took 12 days.
    ev(52, 'item.created', 'stevie', { itemId: 'C', stage: 'specify' }),
    ev(40, 'pr.merged', 'stevie', { itemId: 'C', runId: 'r4', costUsd: 1 }),
  ];
  const t = metrics(events).tiles;
  // A: 8 days to its last merge; B: 4 days → median 6. Before: 12 → 6 days faster.
  assert.deepEqual([t.ideaToMerge.days, t.ideaToMerge.items, t.ideaToMerge.previousDays, t.ideaToMerge.text], [6, 2, 12, '6.0 d faster than last period']);
  assert.deepEqual([t.prsMerged.count, t.prsMerged.specs, t.prsMerged.text], [4, 3, 'from 3 approved specs']);
  assert.deepEqual([t.firstPass.passed, t.firstPass.of, t.firstPass.percent], [3, 4, 75]);
  assert.deepEqual([t.humanEdits.edited, t.humanEdits.percent], [1, 25]);
  assert.deepEqual([t.costPerPr.usd, t.costPerPr.of], [6, 4]);

  const week = metrics(events, '7d').tiles;
  assert.deepEqual([week.prsMerged.count, week.ideaToMerge.days, week.ideaToMerge.text], [4, 6, 'Nothing merged in the period before to compare']);
});

test('stage visits: length from entering a group to leaving it, sent back, who worked, and a visit with no beginning is left out', () => {
  const events = [
    // A: Product for 4 days (Discover → Specify is the same visit), then Design (Architect, from before) for 2, sent back.
    ev(20, 'item.created', 'ada-quill', { itemId: 'A', stage: 'discover' }),
    ev(19, 'item.stage_changed', 'stevie', { itemId: 'A', from: 'discover', to: 'specify' }),
    ev(18, 'spec.updated', 'ada-quill', { specId: 'A' }),
    ev(17, 'spec.updated', 'ada-quill', { itemId: 'A' }),
    ev(16, 'item.stage_changed', 'stevie', { itemId: 'A', from: 'specify', to: 'architect' }),
    ev(15.5, 'approval.requested', 'ada-quill', { itemId: 'A', approvalId: 'apr_a' }),
    ev(14, 'approval.decided', 'stevie', { itemId: 'A', approvalId: 'apr_a', outcome: 'changes-requested' }),
    ev(14, 'item.sent_back', 'stevie', { itemId: 'A', from: 'architect', to: 'specify' }),
    // B: Product for 2 days. C: we only see it leave Architect (Design), so that visit's length is unknown; its UX and
    // UI visit, which begins there, is Product's since lifecycle v3 (Phase 16b), and is counted: 3 days.
    ev(12, 'item.created', 'stevie', { itemId: 'B', stage: 'specify' }),
    ev(10, 'item.stage_changed', 'stevie', { itemId: 'B', from: 'specify', to: 'architect' }),
    ev(9, 'item.stage_changed', 'stevie', { itemId: 'C', from: 'architect', to: 'ux' }),
    ev(8, 'item.stage_changed', 'stevie', { itemId: 'C', from: 'ux', to: 'ui' }),
    ev(6, 'item.stage_changed', 'stevie', { itemId: 'C', from: 'ui', to: 'build' }),
    ev(5, 'item.stage_changed', 'system', { itemId: 'C', from: 'build', to: 'ship' }),
    ev(4.5, 'item.completed', 'stevie', { itemId: 'C' }),
  ];
  const by = Object.fromEntries(metrics(events).stages.map((s) => [s.key, s]));
  assert.deepEqual([by.product.visits, by.product.medianDays, by.product.p90Days, by.product.sentBackPct], [3, 3, 4, 0]);
  // During A's Product visit: opened and two edits by an agent, two moves by a person. B: opened and moved by a person.
  // C: two moves by a person (the move into it counts for the visit it left, which is not counted).
  assert.deepEqual([by.product.agentPct, by.product.peoplePct], [33, 67]);
  assert.deepEqual([by.design.visits, by.design.medianDays, by.design.sentBackPct], [1, 2, 100]);
  assert.deepEqual([by.build.visits, by.build.medianDays, by.build.agentPct], [1, 1, null]);
  assert.deepEqual([by.ship.visits, by.ship.medianDays, by.ship.peoplePct], [1, 0.5, 100]);
  assert.deepEqual(Object.values(by).filter((s) => s.slowest).map((s) => s.key), ['product']);
});

test('the weekly chart: six complete weeks, Build and Test to release drawn together (Ship, from before, too), and a sentence that is computed', () => {
  const monday = weekStart(NOW);
  const visit = (id, stage, next, endsDaysBeforeMonday, days, { ask = false } = {}) => {
    const end = monday - endsDaysBeforeMonday * DAY;
    const iso = (ms) => new Date(ms).toISOString();
    return [
      { type: 'item.created', at: iso(end - days * DAY), actor: 'stevie', payload: { itemId: id, stage } },
      ...(ask ? [{ type: 'approval.requested', at: iso(end - days * DAY * 0.75), actor: 'ada-quill', payload: { itemId: id, approvalId: `apr_${id}` } },
        { type: 'approval.decided', at: iso(end - 1000), actor: 'stevie', payload: { itemId: id, approvalId: `apr_${id}`, outcome: 'approved' } }] : []),
      next ? { type: 'item.stage_changed', at: iso(end), actor: 'stevie', payload: { itemId: id, from: stage, to: next } }
        : { type: 'item.completed', at: iso(end), actor: 'stevie', payload: { itemId: id } },
    ];
  };
  const events = [
    ...visit('P1', 'specify', 'architect', 3, 2), ...visit('P2', 'specify', 'architect', 2, 4),
    ...visit('A1', 'architect', 'ux', 3, 5, { ask: true }),
    ...visit('B1', 'build', 'ship', 3, 1), ...visit('S1', 'ship', null, 2, 0.5),
    ...visit('A2', 'architect', 'ux', 10, 3),
    // This week is not complete yet, so it is not charted.
    ...visit('A3', 'architect', 'ux', -1, 9),
  ];
  const { rows, parts, sentence } = metrics(events).weeks;
  assert.deepEqual(rows.map((r) => r.label), ['W35', 'W36', 'W37', 'W38', 'W39', 'W40']);
  assert.deepEqual(parts.map((p) => p.label), ['Product', 'Design', 'Engineer', 'Build and Test to release']);
  // Architect visits, from before, are Design's since lifecycle v3 (Phase 16b).
  assert.deepEqual(rows[5], { label: 'W40', start: '2026-09-28T00:00:00.000Z', parts: { product: 3, design: 5, engineer: null, buildShip: 1.5 }, totalDays: 9.5 });
  assert.deepEqual([rows[4].parts.design, rows[4].totalDays, rows[3].totalDays], [3, 3, null]);
  // Design leads both weeks; 3.75 of its 8 days had an approval open, so it is not "waiting for sign-off".
  assert.equal(sentence, 'Design is the largest share every week.');
  const waiting = metrics([...events, ...visit('A4', 'architect', 'ux', 4, 20, { ask: true })]).weeks.sentence;
  assert.equal(waiting, 'Design is the largest share every week — it’s waiting for sign-off, not drafting time.');
});

test('spend by system, largest first, only what was spent in the period', () => {
  const s = metrics([
    ev(3, 'teammate.task_finished', 'ada-quill', { system: 'teammates', costUsd: 10.5 }),
    ev(2, 'teammate.task_finished', 'ada-quill', { system: 'teammates', costUsd: 9.5 }),
    ev(2, 'teammate.task_finished', 'ada-quill', { system: 'product', costUsd: 5 }),
    ev(2, 'run.finished', 'system', { runId: 'r1', system: 'factory', costUsd: 0 }),
    ev(2, 'compute.metered', 'system', { costUsd: 40 }),
    ev(45, 'teammate.task_finished', 'ada-quill', { system: 'knowledge', costUsd: 99 }),
    // A cost on another kind of event is not agent or compute spend (Platform's ledger reads the same two types).
    ev(2, 'approval.requested', 'ada-quill', { itemId: 'A', costUsd: 1.6 }),
  ]).spend;
  assert.equal(s.totalUsd, 65);
  assert.deepEqual(s.rows, [
    { key: 'compute', label: 'Platform compute', usd: 40, ratio: 1 },
    { key: 'teammates', label: 'Digital Teammates', usd: 20, ratio: 0.5 },
    { key: 'product', label: 'Product Factory', usd: 5, ratio: 0.13 },
  ]);
});

test('facts in any order give the same numbers, and anything after now is not counted', () => {
  const events = [
    ev(10, 'item.created', 'stevie', { itemId: 'A', stage: 'specify' }),
    ev(6, 'item.stage_changed', 'stevie', { itemId: 'A', from: 'specify', to: 'architect' }),
    ev(2, 'pr.merged', 'stevie', { itemId: 'A', runId: 'r1', costUsd: 3 }),
    ev(-1, 'pr.merged', 'stevie', { itemId: 'A', runId: 'r2', costUsd: 3 }),
  ];
  const forwards = metrics(events);
  assert.deepEqual(metrics([...events].reverse()), forwards);
  assert.equal(forwards.tiles.prsMerged.count, 1);
  assert.throws(() => compute([], { range: 'decade', now: NOW }), /no range/);
});

test('the sample history solver: lengths with the wanted median, p90 and weekly means, or an error when they cannot exist', () => {
  const weeks = visitLengths({ n: 40, median: 14, p90: 30, means: [27, 26, 25, 24] });
  const all = weeks.flat();
  assert.equal(all.length, 40);
  assert.deepEqual([median(all), p90(all)], [14, 30]);
  assert.deepEqual(weeks.map((w) => w.reduce((a, b) => a + b, 0) / w.length), [27, 26, 25, 24]);
  assert.ok(all.every((v) => Number.isInteger(v) && v >= 1));
  // Half the visits at 2.0 d or more and a tenth at 4.0 d or more cannot average 0.5 d.
  assert.throws(() => visitLengths({ n: 40, median: 20, p90: 40, means: [5, 5, 5, 5] }), /cannot have a mean/);
});
