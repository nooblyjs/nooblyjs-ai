import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { riceScore, riceErrors } from '../src/services/rice.js';
import { parseSpec, renderSpec } from '../src/services/spec-format.js';
import { readinessView } from '../src/services/readiness.js';
import { stageView, trackerFor } from '../src/services/stages.js';
import { startApp } from './helpers.js';
import { fakeServices } from './fixtures/host.js';

test('RICE: reach × impact × confidence ÷ effort, rounded', () => {
  assert.equal(riceScore({ reach: 14, impact: 2, confidence: 0.75, effort: 0.5 }), 42);
  assert.equal(riceScore({ reach: 14, impact: 2, confidence: 0.75 }), null);
  assert.deepEqual(riceErrors({ reach: 1, impact: 5, confidence: 2, effort: 0 }), {
    impact: 'impact must be between 0.25 and 3',
    confidence: 'confidence must be between 0 and 1',
    effort: 'effort must be between 0.1 and 1000',
  });
});

test('a spec body round-trips through parseSpec and renderSpec', async () => {
  const text = await fs.readFile(new URL('../src/seed/data/specs/PRD-031.md', import.meta.url), 'utf8');
  const body = text.replace(/^---[\s\S]*?\n---\n/, '').trim();
  const parts = parseSpec(body);
  assert.equal(renderSpec(parts), body);
  assert.deepEqual(parseSpec(renderSpec(parts)), parts);
});

test('parseSpec keeps sections it does not know, and criteria not written as given/when/then', () => {
  const parts = parseSpec('## Problem\n\nSlow.\n\n## Acceptance criteria\n\n- It is fast.\n\n## Risks\n\nNone yet.');
  assert.deepEqual(parts.acceptanceCriteria, [{ text: 'It is fast.' }]);
  assert.deepEqual(parts.other, [{ heading: 'Risks', text: 'None yet.' }]);
  assert.match(renderSpec(parts), /## Risks\n\nNone yet\.$/);
});

test('readiness: a check not run yet is neither passed nor failed', () => {
  const view = readinessView({ results: { 'problem-evidence': true, 'rollout-plan': false } }, { name: 'Rhea Voss' });
  assert.equal(view.text, '1 of 7');
  assert.equal(view.checks.find((c) => c.key === 'rollout-plan').action.label, 'Ask Rhea to draft rollout');
  assert.equal(view.checks.find((c) => c.key === 'privacy-reviewed').passed, null);
  assert.equal(readinessView(null), null);
});

test('stages: both numberings, and the tracker for an approved spec', () => {
  assert.deepEqual(stageView('ui', 5), { key: 'ui', label: 'UI design', factory: { number: 4, label: 'UI design' }, lifecycle: { number: 5, label: 'UI design' } });
  assert.deepEqual(trackerFor('approved').map((s) => s.state), ['done', 'done', 'done', 'current', 'next', 'next']);
});

test('services.artefactsFor and services.summary for other apps', async () => {
  const t = await startApp({ seed: true });
  try {
    const { services } = t.hosted;
    const prd = await services.artefactsFor('PRD-031', { person: { id: 'stevie' } });
    assert.equal(prd.statusText, 'Needs your approval');
    assert.equal(prd.readiness.text, '6 of 7');
    assert.equal(prd.agentCost.usd, 7.4);
    assert.equal(prd.link, '/product/specs/PRD-031');
    assert.equal((await services.artefactsFor('IDEA-018')).rice.score, 42);
    assert.equal(await services.artefactsFor('PRD-999'), null);
    assert.equal(await services.artefactsFor('../../etc'), null);

    const summary = await services.summary();
    assert.equal(summary.agentsOnDuty.text, '1 agent on duty');
    assert.deepEqual(summary.agentsOnDuty.names, ['Ada Quill']);
    // The seed's development budget (budget.yaml), until the platform shares one.
    assert.equal(summary.spend.budgetUsd, 1500);
    assert.match(summary.spend.text, /^\$\d+\.\d{2} of \$1500\.00$/);
  } finally {
    await t.close();
  }
});

test('summary shows spend against the budget when the platform shares one', async () => {
  const { services: partners } = fakeServices();
  const t = await startApp({ seed: true, services: { ...partners, platform: { budgetFor: async () => 1500 } } });
  try {
    const { spend } = await t.hosted.services.summary();
    assert.equal(spend.budgetUsd, 1500);
    assert.match(spend.text, /^\$\d+\.\d{2} of \$1500\.00$/);
  } finally {
    await t.close();
  }
});
