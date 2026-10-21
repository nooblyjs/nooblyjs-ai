// Phase 20: the Test section's test runs, coverage, criterion changes and defects, on its own: the Factory's stand-in
// host, stand-ins for the lifecycle (two stories, defects kept in memory) and Design (their criteria and requirements).
// The line's verify and deliver are played by calling recordGates and recordRequired as hosted.js does.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import { register } from '../index.js';
import { criterionChange } from '../src/services/analysis.js';
import { createHost, createTestServerManager, PEOPLE } from '../../test/fixtures/host.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

const DESIGN = {
  stories: [
    { id: 'STORY-031-1', title: 'See which stores still have capacity', feature: 'FEAT-031-1', systems: ['web-storefront'], criteria: ['Given a store has a slot, when I look, then I see it'], requirements: ['BR-031-01'], interfaces: [], nfrs: [] },
    { id: 'STORY-031-2', title: 'Hold a slot', feature: 'FEAT-031-2', systems: ['web-storefront'], criteria: ['Given a slot is held, when 15 minutes pass, then it returns within 5 seconds'], requirements: ['BR-031-05'], interfaces: [], nfrs: [] },
  ],
  features: [{ id: 'FEAT-031-1', title: 'See capacity' }, { id: 'FEAT-031-2', title: 'Hold a slot' }],
  interfaces: [], nfrs: [],
};
const story = (id, stage) => ({ id, ref: id, type: 'story', title: id, stage, status: 'active', parentId: 'PRD-031' });

let env;
before(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-quality20-'));
  const stand = createHost({ people: PEOPLE });
  const items = new Map([['PRD-031', { id: 'PRD-031', type: 'spec', title: 'Same-day slots', stage: 'engineer', status: 'active' }], ['STORY-031-1', story('STORY-031-1', 'engineer')], ['STORY-031-2', story('STORY-031-2', 'engineer')]]);
  const defects = [];
  const workflows = {
    item: async ({ itemId }) => items.get(itemId) ?? null,
    items: async ({ stage } = {}) => [...items.values()].filter((i) => !stage || i.stage === stage),
    storiesOf: async () => [...items.values()].filter((i) => i.type === 'story'),
    recordDefect: async (input) => {
      const d = { id: `DEF-031-${defects.length + 1}`, title: input.title, severity: input.severity, state: 'open', storyId: input.storyId, createdAt: new Date(Date.now() - 1000).toISOString(), breaks: { story: input.storyId, requirements: input.requirements, criterion: input.criterion }, foundIn: { testRunId: input.testRunId, caseId: input.caseId } };
      defects.push(d);
      return d;
    },
    decideDefect: async ({ defectId, decision, proof }) => { const d = defects.find((x) => x.id === defectId); d.state = decision === 'fixed' ? 'fixed' : decision; d.fixedBy = proof ?? null; return d; },
    defects: async ({ storyId = null, state = null } = {}) => defects.filter((d) => (!storyId || d.storyId === storyId) && (!state || d.state === state)),
  };
  const services = { workflows, design: { designFor: async () => DESIGN } };
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
  // Both stories analysed: each criterion's case marked ready by a person.
  for (const id of ['STORY-031-1', 'STORY-031-2']) {
    const d = (await call('priya-s', 'POST', `/stories/${id}/draft`)).body;
    for (const c of d.cases.filter((x) => x.criterion === 0)) assert.equal((await call('priya-s', 'POST', `/stories/${id}/cases/${c.id}/ready`)).status, 200);
  }
  env = { dataDir, stand, items, defects, hosted, call, DESIGN, close: async () => { await new Promise((r) => server.close(r)); fs.rmSync(dataDir, { recursive: true, force: true }); } };
});
after(async () => { await env?.close(); });

const svc = () => env.hosted.services;

test('a verify is a test run: its gates, the failing tests by name, and the story\'s cases against criteria and requirements', async () => {
  const caseOf = async (id) => (await env.call('priya-s', 'GET', `/stories/${id}`)).body.cases.find((c) => c.criterion === 0).id;
  const one = await svc().recordGates({ runId: 'run-1', itemId: 'STORY-031-1', repo: 'acme/web-storefront', sha: 'aaa1111', gates: [{ name: 'test', status: 'passed' }] });
  assert.deepEqual([one.id, one.status, one.level, one.environment, one.repo, one.requirements], ['TRN-031-1-1', 'passed', 'build', 'Pull request branch', 'web-storefront', ['BR-031-01']]);
  const c1 = await caseOf('STORY-031-1');
  assert.equal(one.cases.find((c) => c.id === c1).status, 'unchecked', 'not looked for until deliver');
  const again = await svc().recordRequired({ runId: 'run-1', sha: 'aaa1111', requiredTests: { cases: [{ id: c1, status: 'passing' }] } });
  assert.equal(again.cases.find((c) => c.id === c1).status, 'passing');
  assert.equal(again.cases.find((c) => c.id === c1).criterionRef, 'AC-031-1-1');
  const c2 = await caseOf('STORY-031-2');
  const two = await svc().recordGates({ runId: 'run-2', itemId: 'STORY-031-2', repo: 'web-storefront', sha: 'bbb2222', gates: [{ name: 'test', status: 'failed', excerpt: `✔ formatSlot (1ms)\n✖ ${c2}: returns within 5 seconds (2.1ms)\nℹ fail 1` }] });
  assert.deepEqual([two.id, two.status, two.failures], ['TRN-031-2-1', 'failed', [`test: ${c2}: returns within 5 seconds`]]);
  assert.equal(two.cases.find((c) => c.id === c2).status, 'failing', 'a failed gate that names the case');
  assert.equal((await svc().recordGates({ runId: 'run-2', itemId: 'STORY-031-2', repo: 'web-storefront', sha: 'bbb2222', gates: [{ name: 'test', status: 'failed' }] })).id, 'TRN-031-2-1', 'the same run and commit: the same test run');
  const listed = (await env.call('naledi-k', 'GET', '/test-runs?storyId=STORY-031-2')).body.testRuns;
  assert.deepEqual(listed.map((r) => r.id), ['TRN-031-2-1']);
  assert.equal((await env.call('naledi-k', 'GET', '/test-runs/TRN-999-1')).status, 404);
});

test('coverage of an item, its features and stories, in words', async () => {
  const c = (await env.call('naledi-k', 'GET', '/coverage/PRD-031')).body;
  assert.equal(c.text, '1 of 2 criteria have a passing test (Build), across STORY-031-1 to -2');
  assert.equal(c.detail, '2 with a ready test case · 2 with an automated test · 1 with a passing test');
  assert.deepEqual(c.features.map((f) => [f.id, f.text]), [['FEAT-031-1', '1 of 1 criterion has a passing test (Build)'], ['FEAT-031-2', '0 of 1 criterion have a passing test (Build)']]);
  assert.equal((await env.call('naledi-k', 'GET', '/coverage/STORY-031-2')).body.stories.length, 1, 'a story on its own');
  assert.equal((await env.call('naledi-k', 'GET', '/coverage/PRD-999')).status, 404);
});

test('a changed criterion marks its cases; in Build only such a case may be edited or marked ready again', async () => {
  assert.equal(criterionChange({ criterion: 0, criterionText: 'a' }, ['a']), null);
  assert.deepEqual(criterionChange({ criterion: 0, criterionText: 'a' }, ['b']), { from: 'a', to: 'b', text: 'Its criterion changed: check the case' });
  assert.equal(criterionChange({ criterion: 1, criterionText: 'a' }, ['a']).text, 'Its criterion was removed');
  env.items.get('STORY-031-1').stage = 'build';
  const was = env.DESIGN.stories[0].criteria[0];
  env.DESIGN.stories[0].criteria[0] = `${was}, within 2 seconds`;
  try {
    const view = (await env.call('priya-s', 'GET', '/stories/STORY-031-1')).body;
    const flagged = view.cases.filter((c) => c.criterionChanged);
    assert.equal(flagged.length, 1);
    assert.deepEqual([flagged[0].criterionChanged.from, view.criteria[0].ready, view.reviewable, view.writable], [was, false, true, false]);
    const other = view.cases.find((c) => !c.criterionChanged);
    assert.equal((await env.call('priya-s', 'POST', `/stories/STORY-031-1/cases/${other.id}/ready`)).status, 409, 'not flagged: Engineer only');
    assert.equal((await env.call('priya-s', 'POST', '/stories/STORY-031-1/draft')).status, 409);
    assert.equal((await env.hosted.services.coverageOf('PRD-031')).stories[0].rows[0].changed, true);
    assert.equal((await env.call('priya-s', 'POST', `/stories/STORY-031-1/cases/${flagged[0].id}/ready`)).status, 200);
    assert.equal((await env.call('priya-s', 'GET', '/stories/STORY-031-1')).body.criteria[0].ready, true);
  } finally {
    env.DESIGN.stories[0].criteria[0] = was;
    env.items.get('STORY-031-1').stage = 'engineer';
  }
});

test('a defect from a failing run carries its case, criterion and requirement; a passing run is the proof it is fixed', async () => {
  assert.equal((await env.call('priya-s', 'POST', '/test-runs/TRN-031-1-1/defects', {})).status, 409, 'that run passed');
  assert.equal((await env.call('priya-s', 'POST', '/test-runs/TRN-031-2-1/defects', { requirementId: 'BR-031-01' })).status, 400, 'not the story\'s requirement');
  assert.equal((await env.call('naledi-k', 'POST', '/test-runs/TRN-031-2-1/defects', {})).status, 403, 'a Viewer');
  const raised = await env.call('priya-s', 'POST', '/test-runs/TRN-031-2-1/defects', { severity: 'S1' });
  assert.equal(raised.status, 201);
  const d = env.defects[0];
  assert.deepEqual([d.storyId, d.severity, d.breaks.requirements, d.breaks.criterion, d.foundIn.testRunId], ['STORY-031-2', 'S1', ['BR-031-05'], 'AC-031-2-1', 'TRN-031-2-1']);
  assert.match(d.title, /^TC-031-2-\d+ fails: /);
  assert.deepEqual((await env.call('naledi-k', 'GET', '/test-runs/TRN-031-2-1')).body.defects, ['DEF-031-1']);
  // A later passing run whose case passes marks it fixed, with the proof.
  await svc().recordGates({ runId: 'run-3', itemId: 'STORY-031-2', repo: 'web-storefront', sha: 'ccc3333', gates: [{ name: 'test', status: 'passed' }] });
  assert.equal(d.state, 'open', 'its case is not proven yet');
  await svc().recordRequired({ runId: 'run-3', sha: 'ccc3333', requiredTests: { cases: [{ id: d.foundIn.caseId, status: 'passing' }] } });
  assert.deepEqual([d.state, d.fixedBy.testRunId], ['fixed', 'TRN-031-2-2']);
});
