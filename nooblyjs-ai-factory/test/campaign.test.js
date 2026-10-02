// Phase F25: campaigns (fan-out, isolation, rate limits, status) and schedules (cron).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { campaignStartsToday, campaignStatus, createCampaign } from '../src/campaign/campaign.js';
import { cronMatches, parseCron, runSchedules } from '../src/campaign/schedule.js';
import { DEFAULTS } from '../src/config/factory-config.js';
import { createMockProvider } from '../src/harness.js';
import { executeRun } from '../src/job/run-job.js';
import { createScheduler } from '../src/scheduler/scheduler.js';
import { pickRuns } from '../src/scheduler/pick.js';
import { openStore } from '../src/store/events.js';
import { gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

const SPEC = '# Pin Node 24\n\nAdd an `.nvmrc` containing `24`, so everyone uses Node 24.\n';

test('fan-out: one item per repo, tagged with the campaign; a repo that fails to submit is recorded and the others go ahead', () => {
  const store = openStore({ env: testEnv() });
  const repos = [makeRepo(), makeRepo(), path.join(tmpDir(), 'not-a-repo'), makeRepo()];
  const c = createCampaign(store, { name: 'node24', repos, spec: SPEC });
  assert.equal(c.items.filter((i) => i.runId).length, 3);
  assert.match(c.items[2].error, /not a git repository/);
  const runs = store.list('runs');
  assert.equal(runs.length, 3);
  assert.ok(runs.every((r) => r.request.campaign === c.campaignId && r.title === 'Pin Node 24'));
  const [status] = campaignStatus(store);
  assert.deepEqual([status.done, status.open, status.failed], [0, 3, 1]);
  assert.equal(status.repos[2].status, 'not submitted');
});

test('rate limit: at most N campaign PRs per repo per day; other work and other repos are not held back', () => {
  const run = (id, slug, campaign) => ({ id, slug, itemId: `${slug}#1`, request: { campaign }, queuedAt: id, priority: 0 });
  const config = { ...DEFAULTS, maxConcurrent: 10, campaigns: { maxPrsPerRepoPerDay: 1 } };
  const queued = [run('a1', 'repo-a', 'c'), run('a2', 'repo-a', 'c'), run('b1', 'repo-b', 'c'), run('a3', 'repo-a', undefined)];
  const out = pickRuns({ queued, running: [], config, spentAll: 0, spentBySlug: {}, stopped: false, campaignToday: {} });
  assert.deepEqual(out.start.map((s) => s.runId).sort(), ['a1', 'a3', 'b1'], 'one campaign run per repo; a3 is not a campaign run');
  assert.match(out.waiting.find((w) => w.runId === 'a2').reason, /campaign limit: 1 per repo per day \(repo-a\)/);
  const later = pickRuns({ queued: [run('b2', 'repo-b', 'c')], running: [], config, spentAll: 0, spentBySlug: {}, stopped: false, campaignToday: { 'repo-b': 1 } });
  assert.equal(later.start.length, 0, 'counts what already started today');
});

test('cron: fields, lists, ranges, steps; day-of-month OR weekday like cron; clear errors', () => {
  assert.deepEqual([...parseCron('*/15 9-10 * * 1,3')[0]], [0, 15, 30, 45]);
  assert.equal(cronMatches('0 9 * * 1', Date.parse('2026-09-28T09:00:00Z')), true, 'a Monday, 09:00 UTC');
  assert.equal(cronMatches('0 9 * * 1', Date.parse('2026-09-29T09:00:00Z')), false, 'Tuesday');
  assert.equal(cronMatches('0 9 * * 1', Date.parse('2026-09-28T09:01:00Z')), false);
  assert.equal(cronMatches('0 0 1 * 1', Date.parse('2026-10-01T00:00:00Z')), true, 'the 1st (a Thursday): day OR weekday');
  assert.throws(() => parseCron('0 9 * *'), /five fields/);
  assert.throws(() => parseCron('0 25 * * *'), /hour field "25" is outside 0–23/);
});

test('schedules: a matching minute makes a campaign ONCE (however often serve checks); other minutes nothing', () => {
  const env = testEnv();
  const store = openStore({ env });
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'deps.md'), '# Weekly dependency check\n\nx\n');
  const schedules = [{ name: 'deps', cron: '0 9 * * 1', repos: [makeRepo(), makeRepo()], spec: 'deps.md' }];
  const monday9 = Date.parse('2026-09-28T09:00:20Z');
  assert.equal(runSchedules(store, schedules, { now: monday9, baseDir: dir }).length, 1);
  assert.equal(runSchedules(store, schedules, { now: monday9 + 20_000, baseDir: dir }).length, 0, 'same minute: once');
  assert.equal(runSchedules(store, schedules, { now: monday9 + 60 * 60_000, baseDir: dir }).length, 0, '10:00: not matching');
  assert.equal(store.list('runs').length, 2);
});

test('END TO END: a campaign through the scheduler: one PR per repo, each repo\'s own gates; the rate limit holds the second item for tomorrow', async () => {
  const env = testEnv({ campaigns: { maxPrsPerRepoPerDay: 1 } });
  const store = openStore({ env });
  const a = makeRepo();
  const b = makeRepo();
  const c = createCampaign(store, { name: 'node24', repos: [a, b, a], spec: SPEC, autonomy: 'L2' }); // a listed twice: still one item
  const c2 = createCampaign(store, { name: 'lint', repos: [a], spec: '# Add a lint script\n\nx\n', autonomy: 'L2' }); // a second campaign on repo a, the same day
  const provider = () => ({ triage: createMockProvider([{ text: '```json\n{"kind":"chore","size":"small","clear":true,"outOfScope":false,"questions":[],"reason":"x"}\n```' }]), build: createMockProvider([{ text: 'x', tools: [{ name: 'Write', input: { file_path: '.nvmrc', content: '24\n' } }] }, { text: 'Pinned Node 24.' }]), review: createMockProvider([{ text: '```json\n{"verdict":"approve","summary":"ok","findings":[]}\n```' }]) });
  const scheduler = createScheduler({ store, config: { ...DEFAULTS, maxConcurrent: 5, campaigns: { maxPrsPerRepoPerDay: 1 } }, execute: (runId, live) => executeRun(store, runId, { live: { ...live, providers: provider() } }) });
  scheduler.tick();
  await new Promise((r) => setTimeout(r, 50));
  while (store.list('runs').some((r) => r.status === 'running')) await new Promise((r) => setTimeout(r, 100));
  const [status] = campaignStatus(store, c.campaignId);
  assert.deepEqual([status.done, status.open, status.failed], [2, 0, 0]);
  assert.equal(status.repos.length, 2);
  const [second] = campaignStatus(store, c2.campaignId);
  assert.deepEqual([second.done, second.open], [0, 1], 'held: repo a already had its campaign PR today');
  assert.equal(gitIn(a, 'show', 'factory/issue-1/main:.nvmrc'), '24');
  assert.equal(gitIn(b, 'show', 'factory/issue-1/main:.nvmrc'), '24');
  assert.match(scheduler.waiting.find((w) => w.reason.startsWith('campaign limit'))?.reason ?? scheduler.tick().waiting[0].reason, /campaign limit/);
  assert.deepEqual(Object.values(campaignStartsToday(store)).sort(), [1, 1]);
});
