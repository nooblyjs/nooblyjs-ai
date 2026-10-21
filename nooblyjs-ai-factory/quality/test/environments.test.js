// Phase 21: the Test section's runs in environments, on its own: the mock test runner (e2e from the Build-level results,
// load against the NFR's target), the suites per kind from the policy, Security's scans asked for, the run recorded and
// told to Infrastructure (stand-ins for the lifecycle, Design, Infrastructure and Security).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { register } from '../index.js';
import { createRunner } from '../src/runners/index.js';
import { createMockRunner, targetMs } from '../src/runners/mock.js';
import { createHost, createTestServerManager, PEOPLE } from '../../test/fixtures/host.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

const DESIGN = {
  stories: [{ id: 'STORY-031-2', title: 'Hold a slot', feature: 'FEAT-031-2', systems: ['web-storefront'], criteria: ['Given a slot is held, when 15 minutes pass, then it returns within 5 seconds'], requirements: ['BR-031-05'], interfaces: [], nfrs: [] }],
  features: [{ id: 'FEAT-031-2', title: 'Hold a slot' }], interfaces: [],
  nfrs: [{ id: 'NFR-031-01', category: 'performance', requirement: 'Slot list at 18:00 peak', target: 'p95 < 300 ms' }],
};
const ENVS = {
  'test-slots': { name: 'test-slots', kind: 'test', status: 'live', product: 'slots', repos: ['web-storefront'], baseline: { e2e: 41 } },
  'pr-031-2-1': { name: 'pr-031-2-1', kind: 'preview', status: 'live', product: 'slots', repo: 'web-storefront', repos: ['web-storefront'], prId: 'PR-031-2-1', storyId: 'STORY-031-2', baseline: {} },
  'pr-031-2-2': { name: 'pr-031-2-2', kind: 'preview', status: 'provisioning' },
};

let env;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-quality21-'));
  const stand = createHost({ people: PEOPLE });
  const recorded = [];
  const scans = [];
  const story = { id: 'STORY-031-2', type: 'story', stage: 'engineer', status: 'active', parentId: 'PRD-031', title: 'Hold a slot' };
  const services = {
    workflows: { item: async ({ itemId }) => (itemId === 'STORY-031-2' ? story : null), items: async () => [] },
    design: { designFor: async () => DESIGN },
    infrastructure: { environment: async (name) => ENVS[name] ?? null, recordTests: async (input) => { recorded.push(input); } },
    security: { scanEnvironment: async (input) => { scans.push(input); return { passed: 1, total: 1, failing: [], findings: ['FND-003'], text: 'Dynamic scan: FND-003, below the level that blocks (High) (mock scanner: not a real scan)' }; } },
  };
  const host = { ...stand.host, store: new FsStore(dataDir), service: (name) => services[name] };
  const app = express();
  app.use(express.json());
  const hosted = await register(app, createTestServerManager(), { mountPath: '/quality', dataDir, host });
  await hosted.seed({ content: false });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/quality/api/v1`;
  const call = async (as, method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'x-dev-person': as, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  // STORY-031-2 analysed, and a Build-level run where its criterion's case fails.
  const d = (await call('priya-s', 'POST', '/stories/STORY-031-2/draft')).body;
  const tc = d.cases.find((c) => c.criterion === 0);
  story.stage = 'build';
  await hosted.services.recordGates({ runId: 'run-1', itemId: 'STORY-031-2', repo: 'web-storefront', sha: 'aaa', gates: [{ name: 'test', status: 'failed', excerpt: `✖ ${tc.id}: returns (1ms)` }] });
  env = { hosted, call, recorded, scans, tc, close: async () => { await new Promise((r) => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }); } };
});
after(async () => { await env?.close(); });

test('the mock runner: e2e from the Build-level results and the baseline, load against the target; an unknown runner is refused', () => {
  assert.throws(() => createRunner({ name: 'playwright' }), /only "mock" exists/);
  assert.deepEqual([targetMs('p95 < 300 ms'), targetMs('under 2 s'), targetMs('99.9%')], [300, 2000, null]);
  const r = createMockRunner();
  const cases = [{ id: 'TC-1', title: 'a', level: 'e2e', status: 'passing' }, { id: 'TC-2', title: 'b', level: 'integration', status: 'failing', criterionRef: 'AC-031-2-1' }, { id: 'TC-3', title: 'c', level: 'contract', status: 'passing' }, { id: 'TC-4', title: 'd', level: 'e2e', status: 'missing' }];
  const e2e = r.run('e2e', { baseline: { e2e: 41 }, cases });
  assert.deepEqual([e2e.passed, e2e.total, e2e.failing], [42, 43, [{ name: 'TC-2: b', caseId: 'TC-2', criterionRef: 'AC-031-2-1' }]]);
  assert.deepEqual([r.run('e2e-smoke', { baseline: { e2e: 41 }, cases }).total], [1], 'smoke: E2E cases only, no baseline');
  const load = r.run('load', { nfrs: DESIGN.nfrs });
  assert.deepEqual([load.passed, load.total, load.text], [1, 1, 'p95 240 ms against the 300 ms target (Slot list at 18:00 peak)']);
  assert.equal(r.run('load', { nfrs: [{ id: 'N', category: 'performance', requirement: 'Tight', target: 'p95 < 200 ms' }] }).failing.length, 1);
  assert.throws(() => r.run('chaos'), /no suite "chaos"/);
});

test('Test\'s suites run in test-slots: e2e "41 of 42 · 1 failing" linked to its criterion, load, the image scan from Security', async () => {
  const res = await env.call('priya-s', 'POST', '/environments/test-slots/runs', { storyIds: ['STORY-031-2'] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const run = res.body;
  assert.deepEqual([run.id, run.kind, run.level, run.environment, run.status, run.runner], ['TRN-test-slots-1', 'environment', 'test', 'test-slots', 'failed', 'mock']);
  assert.deepEqual(run.suites.map((s) => s.suite), ['e2e', 'load', 'image']);
  const e2e = run.suites[0];
  assert.deepEqual([e2e.text, e2e.failing[0].caseId, e2e.failing[0].criterionRef], ['41 of 42 e2e · 1 failing', env.tc.id, 'AC-031-2-1']);
  assert.equal(env.scans.at(-1).kind, 'image');
  const told = env.recorded.at(-1);
  assert.deepEqual([told.environment, told.testRunId, told.suites.map((s) => s.suite)], ['test-slots', 'TRN-test-slots-1', ['e2e', 'load', 'image scan']]);
  assert.deepEqual(told.suites[0].failing, [e2e.failing[0].name]);
  assert.equal((await env.call('naledi-k', 'POST', '/environments/test-slots/runs', {})).status, 403, 'a Viewer');
  assert.equal((await env.call('priya-s', 'POST', '/environments/nowhere/runs', {})).status, 404);
  assert.equal((await env.call('priya-s', 'POST', '/environments/pr-031-2-2/runs', {})).status, 409, 'not live yet');
});

test('a preview\'s suites: its pull request\'s story, e2e smoke, accessibility and DAST with the pull request', async () => {
  const run = await env.hosted.services.runEnvironment({ environment: 'pr-031-2-1' });
  assert.deepEqual([run.level, run.prId, run.storyIds, run.suites.map((s) => s.suite)], ['preview', 'PR-031-2-1', ['STORY-031-2'], ['e2e-smoke', 'accessibility', 'dast']]);
  assert.deepEqual([env.scans.at(-1).kind, env.scans.at(-1).prId, env.scans.at(-1).itemId], ['dast', 'PR-031-2-1', 'STORY-031-2']);
  assert.deepEqual((await env.hosted.services.environmentRuns({ prId: 'PR-031-2-1' })).map((r) => r.id), ['TRN-pr-031-2-1-1']);
  assert.equal((await env.call('naledi-k', 'GET', '/environment-runs?environment=test-slots')).body.testRuns.length, 1);
});
