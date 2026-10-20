// CHG-008: the Engineering, Pull requests and Test pages' data. The stories in Engineer, the pull requests and their
// approvals come from the lifecycle engine (a stand-in here); the application architecture, test analysis, runs and
// defects are the seed story's sample, copied into the Factory's folder with its times moved to now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { seedSamples, readSamples } from '../../../src/services/engineering/samples.js';
import { engineeringRoutes } from '../../../src/services/engineering/views.js';
import { tmpDir } from '../../helpers.js';

const ANCHOR = Date.parse('2026-10-09T10:00:00.000Z');
const WEEK = 7 * 86_400_000;

const ITEMS = [
  { id: 'PRD-027', ref: 'PRD-027', type: 'spec', title: 'Live order tracking map', stage: 'design', status: 'active' },
  { id: 'STORY-027-1', ref: 'STORY-027-1', type: 'story', title: 'See the driver on a live map', stage: 'engineer', status: 'active', parentId: 'PRD-027', feature: { id: 'FEAT-027-1', title: 'See the driver on a live map' } },
  { id: 'STORY-027-2', ref: 'STORY-027-2', type: 'story', title: 'See when the driver will arrive', stage: 'design', status: 'active', parentId: 'PRD-027' },
  { id: 'slots-api-482', ref: 'slots-api #482', type: 'pr', title: 'Slot hold & release endpoints', stage: 'build', status: 'active', owner: 'priya-s' },
  { id: 'web-storefront-481', ref: 'web-storefront #481', type: 'pr', title: 'Checkout focus order', stage: 'test', status: 'active', owner: 'priya-s' },
  { id: 'web-storefront-476', ref: 'web-storefront #476', type: 'pr', title: 'Checkout keyboard traps fixed', stage: 'release', status: 'completed', owner: 'priya-s' },
];
const APPROVALS = [
  { id: 'apr_slotsapi482', type: 'build-approval', itemId: 'slots-api-482', status: 'open', requestedAt: '2026-10-08T15:10:00.000Z', reviewers: [{ id: 'stevie', status: 'waiting' }] },
  { id: 'apr_wsf481build', type: 'build-approval', itemId: 'web-storefront-481', status: 'approved', requestedAt: '2026-10-08T12:00:00.000Z', decidedAt: '2026-10-08T17:10:00.000Z', decidedBy: 'thabo-n', reviewers: [] },
  { id: 'apr_wsf476test', type: 'test-approval', itemId: 'web-storefront-476', status: 'approved', requestedAt: '2026-10-07T18:30:00.000Z', decidedAt: '2026-10-08T10:20:00.000Z', decidedBy: 'lerato-m', reviewers: [] },
];
const NAMES = { stevie: 'Stevie', 'thabo-n': 'Thabo N.', 'lerato-m': 'Lerato M.', 'priya-s': 'Priya S.' };

function setUp({ workflows = true } = {}) {
  const home = tmpDir('factory-engineering-');
  const host = {
    people: { get: async (id) => (NAMES[id] ? { id, name: NAMES[id] } : null) },
    service: (name) => (name === 'workflows' && workflows ? {
      items: async ({ stage } = {}) => ITEMS.filter((i) => !stage || i.stage === stage),
      item: async ({ itemId }) => ITEMS.find((i) => i.id === itemId) ?? null,
      approvals: async ({ type } = {}) => APPROVALS.filter((a) => !type || a.type === type),
    } : undefined),
  };
  const routes = Object.fromEntries(engineeringRoutes({ home, host }).map(([, pattern, fn]) => [pattern, fn]));
  const get = async (pattern, params = {}) => (await routes[pattern]({ params, query: {} })).json;
  return { home, get };
}

test('the samples are copied with their times moved to now, and what is there is left alone', async () => {
  const { home } = setUp();
  const now = ANCHOR + 2 * WEEK;
  const wrote = seedSamples(home, { now: () => now });
  assert.deepEqual(wrote, [
    'engineering/architecture/STORY-027-1.md', 'engineering/test-analysis/STORY-027-1.md',
    'testing/defects/DEF-001.md', 'testing/defects/DEF-002.md', 'testing/defects/DEF-003.md', 'testing/runs.yaml',
  ]);
  const { runs, defects, architecture } = await readSamples(home);
  assert.equal(runs[0].id, 'TRN-0104', 'newest first');
  assert.equal(Date.parse(runs[0].at), Date.parse('2026-10-09T09:40:00.000Z') + 2 * WEEK);
  assert.deepEqual(defects.map((d) => [d.id, d.status]), [['DEF-001', 'open'], ['DEF-002', 'closed'], ['DEF-003', 'fixed']]);
  assert.equal(architecture.get('STORY-027-1').systems.length, 2);
  fs.writeFileSync(path.join(home, 'testing', 'runs.yaml'), 'runs: []\n');
  assert.deepEqual(seedSamples(home, { now: () => now }), [], 'nothing is overwritten');
  assert.deepEqual((await readSamples(home)).runs, []);
});

test('Engineering: each story in Engineer with its architecture, test analysis and what the sign-off still needs', async () => {
  const { home, get } = setUp();
  seedSamples(home, { now: () => ANCHOR });
  const { live, stories } = await get('/api/engineering');
  assert.equal(live, true);
  assert.deepEqual(stories.map((s) => s.id), ['STORY-027-1'], 'only what is in Engineer');
  const [s] = stories;
  assert.deepEqual([s.parent.ref, s.feature.id], ['PRD-027', 'FEAT-027-1']);
  assert.equal(s.architecture.text, '1 of 2 systems accepted');
  assert.equal(s.testAnalysis.text, '1 of 2 criteria has a ready test case');
  assert.equal(s.signOff.ready, false);
  assert.deepEqual(s.signOff.missing, ["delivery-planner's architecture is proposed", 'TC-027-1-4 is a draft', 'IF-027-03 has no integration test']);
  assert.equal(s.href, '/home/lifecycle/STORY-027-1');
  const arch = await get('/api/engineering/architecture/:id', { id: 'STORY-027-1' });
  assert.deepEqual(arch.systems.map((x) => [x.name, x.status, x.acceptedBy?.name ?? null]), [['web-storefront', 'accepted', 'Thabo N.'], ['delivery-planner', 'proposed', null]]);
  assert.match(arch.sample, /Sample data/);
  const tests = await get('/api/engineering/test-analysis/:id', { id: 'STORY-027-1' });
  assert.deepEqual([tests.summary.cases, tests.summary.automated], [5, 4]);
  await assert.rejects(get('/api/engineering/architecture/:id', { id: 'STORY-027-2' }), { status: 404, message: 'STORY-027-2 has no application architecture yet.' });
});

test('Pull requests and Test approvals come from the lifecycle; the last run from the sample', async () => {
  const { home, get } = setUp();
  seedSamples(home, { now: () => ANCHOR });
  const { pullRequests } = await get('/api/pull-requests');
  assert.deepEqual(pullRequests.map((r) => [r.ref, r.build.text, r.test.text, r.lastRun?.status]), [
    ['slots-api #482', 'Waiting on Stevie', 'Not asked yet', 'passed'],
    ['web-storefront #481', 'Given by Thabo N.', 'Not asked yet', 'running'],
    ['web-storefront #476', 'Not asked yet', 'Given by Lerato M.', 'passed'],
  ]);
  const approvals = await get('/api/test/approvals');
  assert.deepEqual(approvals.waiting, []);
  assert.deepEqual(approvals.inTest.map((i) => [i.ref, i.text]), [['web-storefront #481', 'The automated tests are running (TRN-0104); then a tester gives the Test approval']]);
  assert.deepEqual(approvals.given.map((a) => [a.ref, a.decidedBy]), [['web-storefront #476', 'Lerato M.']]);
});

test('Test runs, coverage and defects, said in words', async () => {
  const { home, get } = setUp();
  seedSamples(home, { now: () => ANCHOR });
  assert.equal((await get('/api/test/runs')).text, '7 runs · 2 failed · 1 running');
  const coverage = await get('/api/test/coverage');
  assert.deepEqual(coverage.stories.map((s) => [s.id, s.text]), [['STORY-027-1', '1 of 2 criteria has a ready test case']]);
  const wsf481 = coverage.pullRequests.find((r) => r.itemId === 'web-storefront-481');
  assert.deepEqual([wsf481.runs, wsf481.last.status, wsf481.openDefects], [2, 'running', 1]);
  assert.equal((await get('/api/test/defects')).text, '3 defects · 1 open');
});

test('without the lifecycle engine the pages say so, and an empty Factory folder has nothing to show', async () => {
  const { get } = setUp({ workflows: false });
  assert.deepEqual(await get('/api/engineering'), { live: false, sample: 'Sample data of the seed story.', stories: [] });
  assert.equal((await get('/api/test/runs')).text, 'No test runs yet');
  assert.equal((await get('/api/test/defects')).text, 'No defects recorded');
});
