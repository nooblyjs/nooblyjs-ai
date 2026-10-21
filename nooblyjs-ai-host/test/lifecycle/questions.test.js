// Phase 18: a fact from the Product section that carries its own words (a spec's open questions) is a readiness check of
// that item only: there while the spec has questions, failing with the open one named, passing once each is answered.
// A fact with words for a check the stage already has is not shown twice.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { createHost, createTestServerManager } from './fixtures/host.js';

const SEVEN = ['problem-evidence', 'goals-measurable', 'criteria-testable', 'dependencies-named', 'performance-targets', 'privacy-reviewed', 'rollout-plan'];
const WORDS = { passed: 'Every question is answered', failed: 'A question is still open' };
let dir;
let stand;
let hosted;
let questions = null;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-questions-'));
  const product = {
    readinessFacts: async (id) => ({
      itemId: id,
      facts: {
        ...Object.fromEntries(SEVEN.map((k) => [k, { value: true }])),
        // Words for a stage check already there: ignored.
        'rollout-plan': { value: true, check: { passed: 'Duplicate', failed: 'Duplicate' } },
        ...(questions ? { 'questions-answered': { ...questions, check: WORDS } } : {}),
      },
    }),
  };
  stand = createHost({ dataDir: dir, now: '2026-10-21T09:00:00.000Z', services: { product } });
  hosted = await register(express(), createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed({ content: false });
  await stand.host.store.writeDoc(['items', 'PRD-050.md'], { id: 'PRD-050', ref: 'PRD-050', type: 'spec', title: 'Lockers', system: 'product', stage: 'product', status: 'active', history: [] }, '');
});
after(async () => {
  await hosted.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('no questions, no check; an open question fails naming it; answered, it passes', async () => {
  const none = await hosted.services.readinessOf({ itemId: 'PRD-050' });
  assert.deepEqual([none.passed, none.total], [7, 7]);
  assert.ok(!none.checks.some((c) => c.text === 'Duplicate'));
  questions = { value: false, detail: 'Q-050-1 "Which stores first?" (owner lerato-m)' };
  const open = await hosted.services.readinessOf({ itemId: 'PRD-050' });
  assert.deepEqual([open.passed, open.total, open.failing.map((c) => c.key)], [7, 8, ['questions-answered']]);
  assert.equal(open.failing[0].text, 'A question is still open: Q-050-1 "Which stores first?" (owner lerato-m)');
  questions = { value: true };
  const answered = await hosted.services.readinessOf({ itemId: 'PRD-050' });
  assert.deepEqual([answered.passed, answered.total, answered.checks.at(-1).text], [8, 8, 'Every question is answered']);
});
