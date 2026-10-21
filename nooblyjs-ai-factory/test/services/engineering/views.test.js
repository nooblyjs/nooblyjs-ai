// CHG-008 and Phase 16d: the Engineering, Pull requests and Test pages' data. The stories in Engineer, the pull requests
// and their approvals and the sign-off's checks come from the lifecycle engine (a stand-in here); each story's
// architecture from the architecture service and its test analysis from the Test section (stand-ins here, tested in
// architecture.test.js and quality/test); the runs and defects are the seed story's sample, copied into the Factory's
// folder with its times moved to now.
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
  const signedOff = [];
  const services = {
    workflows: workflows ? {
      items: async ({ stage } = {}) => ITEMS.filter((i) => !stage || i.stage === stage),
      item: async ({ itemId }) => ITEMS.find((i) => i.id === itemId) ?? null,
      approvals: async ({ type } = {}) => APPROVALS.filter((a) => !type || a.type === type),
      readinessOf: async () => ({ passed: 1, total: 3, checks: [{ key: 'architecture-accepted', passed: true, text: 'The application architecture is accepted and current' }, { key: 'criteria-ready', passed: false, text: 'A criterion has no ready test case: "…" has no ready test case' }, { key: 'interfaces-tested', passed: false, text: 'An interface has no integration test: IF-027-03 has no ready integration test' }] }),
      signOffEngineering: async (input) => { signedOff.push(input); return { outcome: 'approved', text: 'Approved. STORY-027-1 moved to Build.', item: { id: input.itemId, stage: 'build' }, handoff: { id: 'hof_x', workItems: [{}, {}] } }; },
    } : undefined,
    quality: {
      summaryFor: async () => ({ criteria: 2, ready: 1, cases: 7, automated: 6, text: '1 of 2 criteria has a ready test case', untestedInterfaces: ['IF-027-03'] }),
      stories: async () => [{ id: 'STORY-027-1', parentId: 'PRD-027', title: 'See the driver on a live map', summary: { criteria: 2, ready: 1, cases: 7, automated: 6, text: '1 of 2 criteria has a ready test case' } }],
    },
  };
  const host = { people: { get: async (id) => (NAMES[id] ? { id, name: NAMES[id] } : null) }, service: (name) => services[name] };
  const architecture = {
    view: async (id) => ({ storyId: id, summary: { systems: 2, accepted: 1, text: '1 of 2 systems accepted' }, systems: [{ name: 'web-storefront', status: 'accepted', statusText: 'Accepted by Thabo N.' }, { name: 'delivery-planner', status: 'proposed', statusText: 'Proposed: an Application Architect accepts it' }], sample: true }),
  };
  const routes = Object.fromEntries(engineeringRoutes({ home, host, architecture }).map(([method, pattern, fn]) => [`${method} ${pattern}`, fn]));
  const get = async (pattern, params = {}) => (await routes[`GET ${pattern}`]({ params, query: {} })).json;
  const send = async (pattern, params, body, person) => (await routes[`POST ${pattern}`]({ params, body, query: {}, req: { person } })).json;
  return { home, get, send, signedOff };
}

test('the samples are copied with their times moved to now, and what is there is left alone', async () => {
  const { home } = setUp();
  const now = ANCHOR + 2 * WEEK;
  const wrote = seedSamples(home, { now: () => now });
  assert.deepEqual(wrote, [
    'engineering/architecture/STORY-027-1.md',
    'testing/defects/DEF-001.md', 'testing/defects/DEF-002.md', 'testing/defects/DEF-003.md', 'testing/runs.yaml',
  ]);
  const { runs, defects } = await readSamples(home);
  assert.equal(runs[0].id, 'TRN-0104', 'newest first');
  assert.equal(Date.parse(runs[0].at), Date.parse('2026-10-09T09:40:00.000Z') + 2 * WEEK);
  assert.deepEqual(defects.map((d) => [d.id, d.status]), [['DEF-001', 'open'], ['DEF-002', 'closed'], ['DEF-003', 'fixed']]);
  fs.writeFileSync(path.join(home, 'testing', 'runs.yaml'), 'runs: []\n');
  assert.deepEqual(seedSamples(home, { now: () => now }), [], 'nothing is overwritten');
  assert.deepEqual((await readSamples(home)).runs, []);
});

test('Engineering: each story in Engineer with its architecture, test analysis and the sign-off\'s checks; the sign-off goes to the lifecycle', async () => {
  const { home, get, send, signedOff } = setUp();
  seedSamples(home, { now: () => ANCHOR });
  const { live, stories } = await get('/api/engineering');
  assert.equal(live, true);
  assert.deepEqual(stories.map((s) => s.id), ['STORY-027-1'], 'only what is in Engineer');
  const [s] = stories;
  assert.deepEqual([s.parent.ref, s.feature.id], ['PRD-027', 'FEAT-027-1']);
  assert.equal(s.architecture.text, '1 of 2 systems accepted');
  assert.deepEqual(s.architecture.systemsList.map((x) => x.name), ['web-storefront', 'delivery-planner']);
  assert.equal(s.testAnalysis.text, '1 of 2 criteria has a ready test case');
  assert.deepEqual([s.signOff.ready, s.signOff.text, s.signOff.checks.length], [false, '1 of 3 checks pass', 3]);
  const person = { id: 'thabo-n', name: 'Thabo N.', kind: 'person' };
  const done = await send('/api/engineering/:id/sign-off', { id: 'STORY-027-1' }, { override: { reason: '  Covered by the contract test  ' } }, person);
  assert.deepEqual(done, { outcome: 'approved', text: 'Approved. STORY-027-1 moved to Build.', item: { id: 'STORY-027-1', stage: 'build' }, handoff: { id: 'hof_x', workItems: 2 } });
  assert.deepEqual(signedOff[0], { itemId: 'STORY-027-1', override: { reason: 'Covered by the contract test' }, comment: null, actor: person });
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
  assert.deepEqual(coverage.stories.map((s) => [s.id, s.text, s.href]), [['STORY-027-1', '1 of 2 criteria has a ready test case', '/factory/quality/test-analysis/STORY-027-1']]);
  const wsf481 = coverage.pullRequests.find((r) => r.itemId === 'web-storefront-481');
  assert.deepEqual([wsf481.runs, wsf481.last.status, wsf481.openDefects], [2, 'running', 1]);
  assert.equal((await get('/api/test/defects')).text, '3 defects · 1 open');
});

test('without the lifecycle engine the pages say so, and an empty Factory folder has nothing to show', async () => {
  const { get } = setUp({ workflows: false });
  assert.deepEqual(await get('/api/engineering'), { live: false, stories: [] });
  assert.equal((await get('/api/test/runs')).text, 'No test runs yet');
  assert.equal((await get('/api/test/defects')).text, 'No defects recorded');
});
