// Phase 16f: the lifecycle's checks and its part of the trace. Its readiness checks and the Build and Test approvals in
// the one shape; one failing readiness check overridden by a person with a reason (it holds for that stage, the
// decision no longer waits on it, it is audited; a Viewer and an agent are refused); the stories, work items, pull
// requests and the links items keep in their front matter, for the trace.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { createHost, createTestServerManager } from './fixtures/host.js';

let dir;
let stand;
let hosted;
let s;
const facts = { 'architecture-accepted': { value: true }, 'criteria-ready': { value: false, detail: '"Given …" has no ready test case' }, 'interfaces-tested': { value: true } };
const doc = (id, data) => stand.host.store.writeDoc(['items', `${id}.md`], {
  id, ref: id, title: `Item ${id}`, system: 'factory', status: 'active', owner: 'lerato-m', team: null, createdAt: '2026-10-01T09:00:00.000Z',
  stageEnteredAt: '2026-10-20T09:00:00.000Z', history: [{ stage: data.stage, enteredAt: '2026-10-20T09:00:00.000Z', by: 'thabo-n' }], version: 1, ...data,
}, '');

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-checks-'));
  stand = createHost({ dataDir: dir, now: '2026-10-21T09:00:00.000Z', services: { factory: { engineeringReadiness: async (itemId) => ({ itemId, facts }) } } });
  const app = express();
  hosted = await register(app, createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed({ content: false });
  s = hosted.services;
  await doc('PRD-070', { type: 'spec', system: 'product', stage: 'design' });
  await doc('STORY-070-1', { type: 'story', parentId: 'PRD-070', stage: 'engineer' });
  await doc('old-pr-9', { type: 'pr', stage: 'build', links: [{ rel: 'delivers', to: 'STORY-070-1' }] });
});
after(async () => {
  await hosted.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('readiness checks in the one shape; one overridden with a reason holds for its stage and is audited', async () => {
  const list = await s.checksFor({ itemId: 'PRD-070' });
  const ready = list.find((c) => c.subject.item === 'STORY-070-1' && c.key === 'criteria-ready');
  assert.deepEqual([ready.kind, ready.result, ready.definedBy.ref, ready.verifiedBy, ready.overridable], ['readiness', 'failed', 'readiness.yaml#engineer.criteria-ready', 'factory facts', true]);
  assert.match(ready.text, /^A criterion has no ready test case: "Given …" has no ready test case$/);
  // A Viewer, an agent, no reason, a passing check: refused.
  await assert.rejects(s.overrideCheck({ itemId: 'STORY-070-1', key: 'criteria-ready', reason: 'Because', actor: { id: 'naledi-k' } }), { code: 'viewers_cannot_approve' });
  await assert.rejects(s.overrideCheck({ itemId: 'STORY-070-1', key: 'criteria-ready', reason: 'Because', actor: { id: 'ada-quill', kind: 'agent' } }), { code: 'people_only' });
  assert.ok(stand.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'ada-quill'));
  await assert.rejects(s.overrideCheck({ itemId: 'STORY-070-1', key: 'criteria-ready', reason: '', actor: { id: 'thabo-n' } }), /a reason is required/);
  await assert.rejects(s.overrideCheck({ itemId: 'STORY-070-1', key: 'architecture-accepted', reason: 'Because', actor: { id: 'thabo-n' } }), { code: 'not_failing' });
  const done = await s.overrideCheck({ itemId: 'STORY-070-1', key: 'criteria-ready', reason: 'Drafted this afternoon', actor: { id: 'thabo-n' } });
  assert.match(done.text, /^Overridden: A criterion has no ready test case/);
  const readiness = await s.readinessOf({ itemId: 'STORY-070-1' });
  assert.deepEqual([readiness.passed, readiness.total, readiness.failing.length], [3, 3, 0]);
  assert.match(readiness.checks.find((c) => c.key === 'criteria-ready').text, /overridden by Thabo N\.: Drafted this afternoon$/);
  const after = (await s.checksFor({ itemId: 'STORY-070-1' })).find((c) => c.key === 'criteria-ready');
  assert.deepEqual([after.result, after.override.byName, after.override.reason], ['passed', 'Thabo N.', 'Drafted this afternoon']);
  assert.ok(stand.auditLog.some((a) => a.action === 'check.overridden' && a.target === 'STORY-070-1' && a.key === 'criteria-ready'));
  assert.ok(stand.eventLog.some((e) => e.type === 'check.overridden' && e.payload.itemId === 'STORY-070-1'));
  // In another stage the override no longer applies.
  await stand.host.store.updateDoc(['items', 'STORY-070-1.md'], (d) => ({ ...d, data: { ...d.data, stage: 'design' } }));
  await stand.host.store.updateDoc(['items', 'STORY-070-1.md'], (d) => ({ ...d, data: { ...d.data, stage: 'engineer', checkOverrides: { 'design:criteria-ready': d.data.checkOverrides['engineer:criteria-ready'] } } }));
  assert.equal((await s.readinessOf({ itemId: 'STORY-070-1' })).failing.length, 1);
});

test('the trace: an item\'s stories, and an item that links into them from its front matter', async () => {
  const t = await s.trace({ itemId: 'PRD-070' });
  assert.deepEqual(t.nodes.map((n) => [n.id, n.type]).sort(), [['PRD-070', 'item'], ['STORY-070-1', 'story'], ['old-pr-9', 'pull-request']]);
  assert.deepEqual(t.links, [{ from: 'STORY-070-1', rel: 'story-of', to: 'PRD-070' }, { from: 'old-pr-9', rel: 'delivers', to: 'STORY-070-1' }]);
  assert.deepEqual(await s.familyOf({ itemId: 'PRD-070' }), ['PRD-070', 'STORY-070-1']);
});
