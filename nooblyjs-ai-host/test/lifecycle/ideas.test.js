// Phase 17: accepting an idea is the Discover exit, a person's, gated by "Business case complete" (the Product section's
// facts for an idea). Accept opens the idea's lifecycle item when it has none; an agent is refused; an item in Discover
// that isn't an idea has no checks.
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
let complete = false;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-ideas-'));
  const product = { readinessFacts: async (id) => (/^IDEA-/.test(id) ? { itemId: id, facts: { 'business-case-complete': complete ? { value: true } : { value: false, detail: 'it needs the horizon' } } } : null) };
  stand = createHost({ dataDir: dir, now: '2026-10-21T09:00:00.000Z', services: { product } });
  hosted = await register(express(), createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed({ content: false });
});
after(async () => {
  await hosted.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('an idea is opened in Discover, refused until its business case is complete, then accepted into Product', async () => {
  const s = hosted.services;
  await assert.rejects(s.acceptIdea({ itemId: 'IDEA-050', title: 'Lockers', actor: { id: 'ada-quill', kind: 'agent' } }), { code: 'people_only' });
  await assert.rejects(s.acceptIdea({ itemId: 'PRD-050', actor: { id: 'lerato-m' } }), /Only an idea/);
  await assert.rejects(s.acceptIdea({ itemId: 'IDEA-050', title: 'Lockers', actor: { id: 'lerato-m' } }), (err) => err.code === 'readiness_failed' && /Business case not complete: it needs the horizon/.test(err.message));
  const item = await s.item({ itemId: 'IDEA-050' });
  assert.deepEqual([item.type, item.stage, item.title], ['idea', 'discover', 'Lockers'], 'opened, and still in Discover');
  complete = true;
  const ok = await s.acceptIdea({ itemId: 'IDEA-050', actor: { id: 'lerato-m' } });
  assert.deepEqual([ok.outcome, ok.item.stage, ok.approval.type], ['approved', 'product', 'idea']);
  assert.match(stand.eventLog.find((e) => e.type === 'approval.decided').payload.summary, /^accepted the idea IDEA-050 · Lockers/);
  await assert.rejects(s.acceptIdea({ itemId: 'IDEA-050', actor: { id: 'lerato-m' } }), { code: 'wrong_stage' });
});

test('an item in Discover that is not an idea has no checks', async () => {
  await stand.host.store.writeDoc(['items', 'SIG-1.md'], { id: 'SIG-1', ref: 'SIG-1', type: 'signal', title: 'A signal', system: 'product', stage: 'discover', status: 'active', history: [] }, '');
  assert.deepEqual((await hosted.services.readinessOf({ itemId: 'SIG-1' })).total, 0);
});
