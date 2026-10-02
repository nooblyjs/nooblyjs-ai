// Phase F20: metrics, computed from synthetic event histories (and one real merge, for human edits).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { factoryMetrics, parseSince } from '../src/metrics/factory-metrics.js';
import { detectMerges } from '../src/metrics/merges.js';
import { runMetrics } from '../src/metrics/run-metrics.js';
import { openStore } from '../src/store/events.js';
import { approve, commitFiles, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

const T0 = Date.parse('2026-09-28T09:00:00Z');
/** A synthetic run: [minutesFromT0, type, data] → events. */
function history(runId, steps) {
  return steps.map(([min, type, data = {}]) => ({ type, at: new Date(T0 + min * 60_000).toISOString(), data: { runId, ...data } }));
}
const station = (start, end, step, result = {}) => [[start, 'step.started', { step }], [end, 'step.finished', { step, result }]];

// run a: clean. triage 1m, build 10m ($0.40), verify passes first time, review; PR at 15m; merged at 75m with small edits.
const a = history('a', [[0, 'run.queued', { title: 'A' }], ...station(0, 1, 'triage', { costUsd: 0.01 }), ...station(1, 11, 'build', { costUsd: 0.4 }), ...station(11, 12, 'verify', { passed: true }), ...station(12, 14, 'review', { costUsd: 0.05 }), [15, 'run.finished', { status: 'delivered' }], [75, 'run.merged', { humanEdit: { factoryLines: 100, editedLines: 10 } }]]);
// run b: gates fail first, one repair, then pass; PR at 40m; never merged.
const b = history('b', [[5, 'run.queued', { title: 'B' }], ...station(5, 6, 'triage', { costUsd: 0.01 }), ...station(6, 26, 'build', { costUsd: 0.8 }), ...station(26, 27, 'verify', { passed: false }), [27, 'repair.attempted', { costUsd: 0.2 }], ...station(27, 35, 'repair', {}), [35, 'run.rewound', { from: 'verify' }], ...station(35, 36, 'verify', { passed: true }), ...station(36, 38, 'review', { costUsd: 0.05 }), [40, 'run.finished', { status: 'delivered' }]]);
// run c: escalated after its build failed twice; no PR.
const c = history('c', [[10, 'run.queued', { title: 'C' }], ...station(10, 11, 'triage'), [11, 'step.started', { step: 'build' }], [16, 'step.failed', { step: 'build', error: 'x' }], ...station(16, 30, 'build', { costUsd: 1 }), ...station(30, 31, 'verify', { passed: false }), [31, 'inbox.opened', { kind: 'escalation', inboxId: 'q' }], [32, 'run.finished', { status: 'gate_failed' }]]);
// run d: long ago (outside a 7-day window).
const d = history('d', [[-20 * 24 * 60, 'run.queued', { title: 'old' }], [-20 * 24 * 60 + 5, 'run.finished', { status: 'delivered' }]]);

test('one run: lead times, time and cost per station (tries added up), first pass, repairs, escalation', () => {
  const ra = runMetrics(a);
  assert.equal(ra.leadToPrMs, 15 * 60_000);
  assert.equal(ra.leadToMergeMs, 75 * 60_000);
  assert.equal(ra.stations.build.durationMs, 10 * 60_000);
  assert.equal(Math.round(ra.costUsd * 100), 46);
  assert.equal(ra.firstPassGates, true);
  assert.equal(ra.status, 'merged');
  const rb = runMetrics(b);
  assert.equal(rb.firstPassGates, false, 'the FIRST verify decides, not the one after the repair');
  assert.equal(rb.repairs, 1);
  assert.equal(rb.stations.verify.tries, 2);
  assert.equal(rb.stations.verify.durationMs, 2 * 60_000);
  assert.equal(Math.round(rb.costUsd * 100), 106, 'repair cost included: 0.01 + 0.8 + 0.2 + 0.05');
  const rc = runMetrics(c);
  assert.equal(rc.escalated, true);
  assert.equal(rc.stations.build.tries, 2);
  assert.equal(rc.stations.build.failures, 1);
  assert.equal(rc.stations.build.durationMs, 19 * 60_000, 'the failed try counts too');
  assert.equal(rc.leadToPrMs, null);
});

test('the factory: throughput, lead time, stations (slowest, priciest), first-pass, acceptance, human edits, escalations, cost per merged PR', () => {
  const now = T0 + 2 * 86_400_000;
  const m = factoryMetrics([...a, ...b, ...c, ...d], { since: '7d', now });
  assert.equal(m.runs, 3, 'the old run is outside the window');
  assert.equal(m.throughputPerDay, 3 / 7);
  assert.equal(m.leadTimeToPr.p50Ms, 35 * 60_000, 'b: queued at 5m, PR at 40m. Median of 15m and 35m → the upper middle');
  assert.equal(m.leadTimeToMerge.p50Ms, 75 * 60_000);
  assert.equal(m.firstPassGateRate, 1 / 3);
  assert.equal(m.prAcceptanceRate, 1 / 2);
  assert.equal(m.humanEditRate, 0.1);
  assert.equal(m.escalationRate, 1 / 3);
  assert.equal(m.repairRate, 1 / 3);
  assert.equal(Math.round(m.costPerMergedPr * 100), 252, 'ALL spend ÷ merged PRs: failures are part of the price');
  assert.equal(m.slowest, 'build');
  assert.equal(m.mostExpensive, 'build');
  assert.equal(m.stations[0].id, 'build', 'stations sorted by total time');
  assert.equal(m.stations.find((s) => s.id === 'build').failures, 1);
  assert.equal(m.kpis.find((k) => k.label === 'PR acceptance').value, '50%');
  assert.deepEqual(m.statuses, { merged: 1, delivered: 1, gate_failed: 1 });
});

test('empty and odd inputs: no runs → nulls, not NaN; --since forms', () => {
  const m = factoryMetrics([], { now: T0 });
  assert.equal(m.runs, 0);
  assert.equal(m.prAcceptanceRate, null);
  assert.equal(m.costPerMergedPr, null);
  assert.ok(m.kpis.every((k) => !String(k.value).includes('NaN')));
  assert.equal(parseSince('24h', T0), T0 - 86_400_000);
  assert.equal(parseSince('2026-09-01', T0), Date.parse('2026-09-01'));
  assert.throws(() => parseSince('soon'), /like 7d/);
});

test('a local merge is noticed once, with the human-edit count: lines people changed in the factory\'s files after it', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ 'README.md': '# hi\n', 'other.md': 'x\n' });
  const build = createMockProvider([{ text: 'x', tools: [{ name: 'Write', input: { file_path: 'half.js', content: 'export const half = (n) => n >> 1;\n// one\n// two\n// three\n' } }] }, { text: 'Done.' }]);
  const triage = createMockProvider([{ text: '```json\n{"kind":"feature","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"x"}\n```' }]);
  const issue = path.join(tmpDir(), 'i.md');
  fs.writeFileSync(issue, '# Add half\n\nx\n');
  const out = await runJob({ issueFile: issue, repo, autonomy: 'L2', providers: { triage, build, review: await approve() } }, { env, store });
  assert.equal(out.status, 'delivered');
  assert.deepEqual(await detectMerges(store), [], 'not merged yet');

  // A person merges, fixing one line of the factory's file, and changes an unrelated file.
  gitIn(repo, 'merge', '-q', '--no-ff', '-m', 'merge', 'factory/issue-1/main');
  commitFiles(repo, { 'half.js': 'export const half = (n) => n / 2;\n// one\n// two\n// three\n', 'other.md': 'changed\n' }, 'fix half');
  const found = await detectMerges(store);
  assert.deepEqual(found.map((f) => f.humanEdit), [{ factoryLines: 4, editedLines: 2 }], '1 line replaced = 1 deleted + 1 added; other.md not counted');
  assert.equal(store.get('runs', out.runId).status, 'merged');
  assert.deepEqual(await detectMerges(store), [], 'once');
  assert.equal(factoryMetrics(store.read()).humanEditRate, 0.5);
});
