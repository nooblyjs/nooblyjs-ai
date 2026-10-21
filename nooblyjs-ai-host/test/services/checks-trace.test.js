// Phase 16f: NooblyJS's side of one shape for checks and the trace, on stand-in apps. The checks service gathers each
// app's checks for an item into one list (an id per check, the same each time; check.recorded when one is new or
// changed; an app that fails is said, not fatal) and lets a person override a readiness check only. The trace service
// merges each app's nodes and links, keeps the index, builds it again the same when it is deleted, and names the
// missing links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createChecks } from '../../src/services/checks.js';
import { createTrace, shape } from '../../src/services/trace.js';

const { FsStore } = createRequire(import.meta.url)('nooblyjs-core/src/store/fs-store.js');

async function setUp(services) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-checks-'));
  const store = new FsStore(dir);
  const emitted = [];
  const listeners = [];
  const events = { emit: async (type, payload) => { emitted.push({ type, payload }); for (const fn of listeners) fn({ type, payload }); }, on: (type, fn) => { listeners.push(fn); return () => {}; } };
  return { dir, store, emitted, events, services: new Map(Object.entries(services)) };
}

const READY = { key: 'criteria-ready', kind: 'readiness', subject: { item: 'STORY-1', ref: 'STORY-1' }, definedBy: { system: 'workflows', ref: 'readiness.yaml#engineer.criteria-ready' }, verifiedBy: 'factory facts', severity: 'blocking', result: 'failed', text: 'A criterion has no ready test case', evidence: { system: 'factory', summary: '…' }, overridable: true };
const POLICY = { key: 'test:in-region', kind: 'policy', subject: { item: 'PRD-1', ref: 'INF-1 v1 · Test' }, definedBy: { system: 'infrastructure', ref: 'policies.yaml#in-region' }, verifiedBy: 'policy check', severity: 'blocking', result: 'passed', text: 'Customer data stays in-region', evidence: { system: 'infrastructure', summary: '…' } };

test('checks from every app in one list, each with a stable id; check.recorded only when new or changed; a failing app is said', async () => {
  let policy = POLICY;
  const overrides = [];
  const env = await setUp({
    workflows: { familyOf: async () => ['PRD-1', 'STORY-1'], checksFor: async () => [READY], overrideCheck: async (input) => { overrides.push(input); return { text: 'Overridden' }; } },
    infrastructure: { checksFor: async () => [policy] },
    factory: { checksFor: async () => { throw new Error('down'); } },
  });
  const checks = createChecks({ store: env.store, services: env.services, events: env.events, log: { warn() {} } });
  const first = await checks.checksFor('PRD-1');
  assert.deepEqual(first.checks.map((c) => [c.kind, c.source, c.result]), [['readiness', 'Lifecycle', 'failed'], ['policy', 'Infrastructure', 'passed']]);
  assert.equal(first.text, '1 of 2 pass · 1 failing');
  assert.deepEqual(first.unavailable, ['Product section', 'Software Factory'], 'not running here, and failing');
  assert.equal(env.emitted.filter((e) => e.type === 'check.recorded').length, 2);
  const again = await checks.checksFor('PRD-1');
  assert.deepEqual(again.checks.map((c) => c.id), first.checks.map((c) => c.id), 'the same id each time');
  assert.equal(env.emitted.filter((e) => e.type === 'check.recorded').length, 2, 'nothing changed: nothing recorded');
  policy = { ...POLICY, result: 'failed', text: 'Outside the region' };
  await checks.checksFor('PRD-1');
  assert.deepEqual(env.emitted.filter((e) => e.type === 'check.recorded').at(-1).payload.result, 'failed');
  // Only a readiness check is overridden here, and the lifecycle engine does it.
  const [ready, pol] = again.checks;
  await assert.rejects(checks.override({ itemId: 'PRD-1', checkId: pol.id, reason: 'x', actor: { id: 'thabo-n' } }), (err) => err.code === 'not_overridable');
  await checks.override({ itemId: 'PRD-1', checkId: ready.id, reason: 'Drafted this afternoon', actor: { id: 'thabo-n' } });
  assert.deepEqual(overrides, [{ itemId: 'STORY-1', key: 'criteria-ready', reason: 'Drafted this afternoon', actor: { id: 'thabo-n' } }]);
  await assert.rejects(checks.override({ itemId: 'PRD-1', checkId: 'chk_nope', reason: 'x', actor: { id: 'thabo-n' } }), (err) => err.code === 'not_found');
});

test('the trace merges every app\'s nodes and links; deleted, the index is built again the same; rebuild finds a stale one', async () => {
  let title = 'Story one';
  const env = await setUp({
    workflows: { familyOf: async () => ['PRD-1'], items: async () => [{ id: 'PRD-1' }, { id: 'PR-9', type: 'pr' }], trace: async () => ({ nodes: [{ id: 'PRD-1', type: 'item', title: 'Item one' }, { id: 'STORY-1', type: 'story', title, stage: 'build' }], links: [{ from: 'STORY-1', rel: 'story-of', to: 'PRD-1' }] }) },
    design: { trace: async () => ({ nodes: [{ id: 'STORY-1', type: 'story', title: 'From design' }, { id: 'AC-1-1', type: 'criterion', title: 'Given …' }], links: [{ from: 'AC-1-1', rel: 'criterion-of', to: 'STORY-1' }] }) },
  });
  const trace = createTrace({ store: env.store, services: env.services, events: env.events, log: { warn() {} } });
  const first = await trace.view('PRD-1');
  assert.equal(first.root.children[0].title, 'Story one', 'the first app to name a node gives its title');
  assert.equal(first.root.children[0].stage, 'build');
  assert.deepEqual(first.gaps.map((g) => g.text), ['AC-1-1 has no test']);
  await fs.rm(path.join(env.dir, 'trace'), { recursive: true });
  assert.deepEqual(await trace.view('PRD-1'), first);
  assert.deepEqual((await trace.rebuild()).differences, []);
  // Something changed without an event reaching NooblyJS: the index is stale, and rebuild says so.
  title = 'Story one, renamed';
  const stale = await trace.rebuild();
  assert.deepEqual(stale.differences, ['PRD-1: 1 node differ (STORY-1)']);
  assert.deepEqual((await trace.rebuild()).differences, [], 'rewritten');
  // An event marks it stale: the next view is built again.
  title = 'Story one, again';
  await env.events.emit('item.updated', {});
  assert.equal((await trace.view('PRD-1')).root.children[0].title, 'Story one, again');
});

test('shape: each node once, under its best parent; gaps and coverage in words; a loop is drawn once', () => {
  const nodes = [
    { id: 'PRD-1', type: 'item' }, { id: 'GOAL-1-1', type: 'goal' }, { id: 'GOAL-1-2', type: 'goal' }, { id: 'BR-1', type: 'business-requirement' },
    { id: 'BR-2', type: 'business-requirement' }, { id: 'STORY-1', type: 'story' }, { id: 'AC-1-1', type: 'criterion' }, { id: 'AC-1-2', type: 'criterion' },
    { id: 'TC-1-1', type: 'test-case' }, { id: 'TC-1-9', type: 'test-case' }, { id: 'X', type: 'story' },
  ];
  const links = [
    { from: 'GOAL-1-1', rel: 'goal-of', to: 'PRD-1' }, { from: 'GOAL-1-2', rel: 'goal-of', to: 'PRD-1' }, { from: 'BR-1', rel: 'derives-from', to: 'GOAL-1-1' },
    { from: 'BR-2', rel: 'derives-from', to: 'PRD-1' }, { from: 'STORY-1', rel: 'story-of', to: 'PRD-1' }, { from: 'STORY-1', rel: 'serves', to: 'BR-1' },
    { from: 'AC-1-1', rel: 'criterion-of', to: 'STORY-1' }, { from: 'AC-1-2', rel: 'criterion-of', to: 'STORY-1' }, { from: 'TC-1-1', rel: 'verifies', to: 'AC-1-1' },
    { from: 'TC-1-9', rel: 'verifies', to: 'AC-9-9' }, { from: 'X', rel: 'serves', to: 'X' },
  ];
  const t = shape('PRD-1', nodes, links);
  assert.deepEqual(t.root.children.map((c) => c.id), ['GOAL-1-1', 'GOAL-1-2', 'BR-2'], 'goals first, then what derives from the item');
  assert.equal(t.root.children[0].children[0].children[0].id, 'STORY-1', 'under the requirement it serves, not under the item');
  assert.deepEqual(t.gaps.map((g) => g.text), ['GOAL-1-2 has no business requirement', 'BR-2 has no story', 'AC-1-2 has no test', 'TC-1-9 verifies AC-9-9, which is not here']);
  assert.deepEqual(t.coverage, ['1 of 2 business requirements has a story', '1 of 2 acceptance criteria has a test']);
  assert.deepEqual(t.unplaced.map((u) => u.id), ['TC-1-9', 'X']);
  assert.equal(t.text, '4 missing links');
});
