// Phase 10's test script (roadmap), through the API on a fresh seed with the real lifecycle engine: the seeded
// numbers are the mockup's (step 1), reconcile finds 0 differences (step 2), approving and sending back move the
// numbers (step 3), and deleting the roll-ups changes nothing (step 4). The functions are in services/metrics.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApp } from './helpers.js';
import { seedMissing } from '../src/seed/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 86_400_000;
const workflows = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });

let env;
let stevie;
before(async () => {
  env = await startApp();
  stevie = env.client();
  await stevie.signIn('stevie');
});
after(async () => { await env?.stop(); });

const metrics = async (range = '30d') => (await stevie.json(`/api/v1/home/metrics?range=${range}`)).body;
const stage = (m, key) => m.stages.find((s) => s.key === key);
const reconcile = () => spawnSync(process.execPath, ['scripts/metrics-reconcile.js'], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATA_DIR: env.dataDir, NODE_ENV: 'test', NOOBLY_DEV_LOGIN: 'true', LOG_LEVEL: 'error' },
});
const rollups = () => fs.readdir(path.join(env.dataDir, 'metrics', 'rollups')).catch(() => []);

test('step 1: on the seeded data, 30 days shows the numbers of the mockup story', async () => {
  const m = await metrics();
  assert.equal(m.range.words, 'Last 30 days');
  assert.deepEqual(m.ranges, [{ key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }, { key: 'quarter', label: 'Quarter' }]);

  const t = m.tiles;
  assert.deepEqual([t.ideaToMerge.days, t.ideaToMerge.text], [9.1, '1.8 d faster than last period']);
  assert.deepEqual([t.prsMerged.count, t.prsMerged.text], [38, 'from 12 approved specs']);
  assert.deepEqual([t.firstPass.percent, t.firstPass.text], [71, '27 of 38 passed first time']);
  assert.deepEqual([t.humanEdits.percent, t.humanEdits.edited], [18, 7]);
  assert.equal(t.costPerPr.usd, 6.1);

  assert.deepEqual(m.weeks.rows.map((r) => r.totalDays), [11.2, 10.4, 9.9, 9.3, 8.9, 8.5]);
  // The mockup's columns: Product, Architecture, UX & UI design, Build & ship (its heights at 20 px a day). Since the
  // nine stages the last column is Build to release; the seed's history is from before, so it is Build + Ship.
  assert.deepEqual(m.weeks.rows.map((r) => [r.parts.product, r.parts.architecture, r.parts.design, r.parts.buildShip]), [
    [3.0, 3.4, 2.0, 2.8], [2.8, 3.1, 1.9, 2.6], [2.7, 3.0, 1.8, 2.4], [2.6, 2.9, 1.7, 2.1], [2.5, 2.7, 1.7, 2.0], [2.4, 2.6, 1.6, 1.9],
  ]);
  assert.equal(m.weeks.sentence, 'Architecture is the largest share every week — it’s waiting for sign-off, not drafting time.');

  assert.equal(m.spend.totalUsd, 3782);
  assert.deepEqual(m.spend.rows.map((r) => [r.label, r.usd, Math.round(r.ratio * 100)]), [
    ['Digital Teammates', 1816, 100], ['Platform compute', 1140, 63], ['Product Factory', 412, 23], ['Software Factory', 318, 18], ['Knowledge', 96, 5],
  ]);

  assert.deepEqual(m.stages.map((s) => [s.label, s.agentPct, s.peoplePct, s.medianDays, s.p90Days, s.sentBackPct]), [
    ['Product', 78, 22, 1.4, 3.0, 8],
    ['Architecture', 62, 38, 2.6, 5.8, 12],
    ['UX & UI design', 55, 45, 2.1, 4.2, 6],
    ['Build', 91, 9, 0.6, 1.4, 18],
    // The nine stages (Phase 16a): no visit has ended in Verify, Release or Operate yet, and Ship is history.
    ['Verify', null, null, null, null, null],
    ['Release', null, null, null, null, null],
    ['Operate', null, null, null, null, null],
    ['Ship (before nine stages)', 35, 65, 0.4, 1.1, 3],
  ]);
  assert.deepEqual(m.stages.filter((s) => s.slowest).map((s) => s.key), ['architecture']);
});

test('the other ranges are computed too, a range that does not exist is refused, and Metrics needs a sign-in', async () => {
  const week = await metrics('7d');
  assert.equal(week.range.days, 7);
  assert.ok(week.tiles.prsMerged.count > 0 && week.tiles.prsMerged.count < 38);
  const quarter = await metrics('quarter');
  // The quarter also holds the seven PRs of the period before.
  assert.equal(quarter.tiles.prsMerged.count, 45);
  const bad = await stevie.json('/api/v1/home/metrics?range=decade');
  assert.deepEqual([bad.status, bad.body.error.code], [400, 'invalid_range']);
  assert.equal((await env.client().request('/api/v1/home/metrics')).status, 401);
});

test('the sample history is not in Activity, in "spent today" or in the approvals people are counted by', async () => {
  const events = (await fs.readdir(path.join(env.dataDir, 'events'), { recursive: true })).filter((n) => n.endsWith('.yaml'));
  assert.ok(events.length > 30, 'the sample history covers weeks of days');
  let before = null;
  const seen = [];
  do {
    const page = (await stevie.json(`/api/v1/activity?limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`)).body;
    seen.push(...page.rows);
    before = page.nextBefore;
  } while (before);
  assert.ok(seen.length >= 15 && seen.length < 40, `Activity shows the story, not the sample history (${seen.length} rows)`);
  assert.ok(!seen.some((r) => /^SMP-/.test(r.itemId ?? '') || /^Sample/.test(r.actor.name)));
  const members = (await stevie.json('/api/v1/home/teams')).body.members.rows;
  assert.ok(!members.some((r) => /sample/i.test(r.id)));

  // Seeding again adds nothing: the history is written once.
  assert.deepEqual(await seedMissing(env.store), []);
});

test('step 2: npm run metrics:reconcile recomputes every number from the raw events with 0 differences', async () => {
  const run = reconcile();
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /30 days\s+0 differences\s+\(idea → merge 9\.1 d · 38 PRs merged · first pass 71% · spend \$3782\)/);
  assert.match(run.stdout, /7 days\s+0 differences/);
  assert.match(run.stdout, /Quarter\s+0 differences/);
  assert.match(run.stdout, /0 differences: every number is what the events say\./);
});

test('step 3: approving a spec and sending an item back move the stage numbers on refresh', async () => {
  const before = await metrics();
  assert.deepEqual([stage(before, 'product').visits, stage(before, 'architecture').visits], [50, 42]);

  // PRD-031's spec is approved (with a readiness override): it leaves Specify, which ends its Product visit.
  const approved = await post(stevie, `${workflows}/approvals/apr_prd031spec/decision`, { decision: 'approve', override: { reason: 'Rollout plan follows in the pilot review' } });
  assert.equal(approved.status, 200, await approved.clone().text());
  // PRD-027 is sent back from Architect: its Architecture visit ends, sent back.
  const sent = await post(stevie, `${workflows}/items/PRD-027/send-back`, { to: 'specify', reason: 'Needs the courier privacy review first' });
  assert.equal(sent.status, 200, await sent.clone().text());

  const after = await metrics();
  assert.equal(stage(after, 'product').visits, 51);
  assert.deepEqual([stage(after, 'architecture').visits, stage(after, 'architecture').sentBackPct], [43, 14]);
  assert.notDeepEqual(after.stages, before.stages);
  // Nothing was merged, so the tiles stay.
  assert.deepEqual(after.tiles, before.tiles);
  assert.equal(reconcile().status, 0);
});

test('step 4 and roll-ups: past days are kept as roll-ups; deleting them changes nothing; a day whose events change is rebuilt', async () => {
  const now = env.noobly.clock.now();
  const first = await env.noobly.metrics.get('30d', { now });
  const files = await rollups();
  assert.ok(files.length > 30, 'a roll-up per past day with events');
  const today = new Date(now).toISOString().slice(0, 10);
  assert.ok(!files.includes(`${today}.yaml`), 'today is always read from the events');

  await fs.rm(path.join(env.dataDir, 'metrics', 'rollups'), { recursive: true });
  assert.deepEqual(await env.noobly.metrics.get('30d', { now }), first);
  assert.deepEqual((await metrics()).tiles, first.tiles);
  assert.equal((await rollups()).length, files.length, 'and they are written again');

  // A merged PR appears in a past day's events: that day's roll-up no longer matches its file, so it is rebuilt.
  const at = new Date(now - 3 * DAY).toISOString();
  await env.store.appendYaml(['events', at.slice(0, 4), at.slice(5, 7), `${at.slice(0, 10)}.yaml`], {
    id: 'evt_late', type: 'pr.merged', at, actor: 'stevie', payload: { itemId: 'PRD-025', runId: 'run_late', costUsd: 6.1 },
  });
  const later = await env.noobly.metrics.get('30d', { now });
  assert.deepEqual([later.tiles.prsMerged.count, later.tiles.prsMerged.specs], [39, 13]);
  assert.equal(reconcile().status, 0);
});

test('reconcile fails, and says where, when a roll-up does not say what the events say', async () => {
  const now = env.noobly.clock.now();
  await env.noobly.metrics.get('30d', { now });
  // The latest past day with a merged PR in its roll-up: take its merges out, as a stale or edited file would.
  const dir = path.join(env.dataDir, 'metrics', 'rollups');
  let tampered = null;
  for (const name of (await rollups()).sort().reverse()) {
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    if (!/k: merge/.test(text)) continue;
    const doc = await env.store.readYaml(['metrics', 'rollups', name]);
    await env.store.writeYaml(['metrics', 'rollups', name], { ...doc, facts: doc.facts.filter((f) => f.k !== 'merge') });
    tampered = name;
    break;
  }
  assert.ok(tampered);
  const run = reconcile();
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(run.stdout, /tiles\.prsMerged\.count: served \d+, recomputed 39/);
  assert.match(run.stdout, /differences?: the served numbers do not match the events\./);

  await fs.rm(path.join(dir, tampered));
  assert.equal(reconcile().status, 0);
});
