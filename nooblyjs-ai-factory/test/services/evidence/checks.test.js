// NooblyJS Phase 16f: what the line proves, as checks in NooblyJS's one shape: each gate of a run's last commit, the
// item's quality attributes against those gates (one no gate checks is "not run", for a person), and a pull request's
// required tests. Only a work item's latest run counts. And the runs in the trace, each linked to its work item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLineChecks } from '../../../src/services/evidence/checks.js';
import { openStore } from '../../../src/models/store/events.js';
import { testEnv } from '../../helpers.js';

function run(store, runId, { queuedAt, gates, required }) {
  store.append(`run:${runId}`, 'run.queued', { runId, itemId: 'issue-1', title: 'Build it', request: { repo: '/tmp/x', noobly: { itemId: 'STORY-9-1', workItemId: 'WI-STORY-9-1-1', repoName: 'acme/web-storefront' } } });
  store.append(`run:${runId}`, 'step.finished', { runId, step: 'verify', result: { passed: gates.every((g) => g.status === 'passed'), gates: { results: gates }, checkedSha: 'a'.repeat(40) } });
  store.append(`run:${runId}`, 'step.finished', { runId, step: 'deliver', result: { status: 'delivered', sha: 'a'.repeat(40), ...(required ? { requiredTests: required } : {}) } });
  store.append(`run:${runId}`, 'run.finished', { runId, status: 'delivered', pr: 'prs/x.md', head: 'factory/x/main' });
  return queuedAt;
}

test('gates, quality attributes against them and required tests, from each work item\'s latest run; runs in the trace', async () => {
  const store = openStore({ env: testEnv() });
  run(store, 'run-0mvh0001-aaa111', { gates: [{ name: 'test', command: 'node --test', status: 'failed' }] });
  run(store, 'run-0mvh0002-bbb222', { gates: [{ name: 'test', command: 'node --test', status: 'passed' }], required: { text: '2 of 3 required tests present (TC-9-1-3 missing)', missing: ['TC-9-1-3'], failing: [], unproven: [] } });
  const attributes = [{ attribute: 'Consistency', target: '0 double-books', verifiedBy: 'test gate' }, { attribute: 'Latency', target: 'p95 < 300 ms', verifiedBy: 'Load test station' }];
  const host = { service: (name) => (name === 'product' ? { gatesFor: async () => attributes } : null) };
  const line = createLineChecks({ store, host });
  const list = await line.checksFor({ itemId: 'PRD-9', itemIds: ['PRD-9', 'STORY-9-1'] });
  assert.deepEqual(list.map((c) => [c.kind, c.key, c.result]), [
    ['gate', 'gate:test', 'passed'],
    ['test', 'required-tests', 'failed'],
    ['gate', 'quality-attribute:QA-9-1', 'passed'],
    ['gate', 'quality-attribute:QA-9-2', 'not-run'],
  ]);
  const [gate, tests, qa1, qa2] = list;
  assert.deepEqual([gate.subject.item, gate.definedBy.ref, gate.verifiedBy, gate.text], ['STORY-9-1', 'web-storefront/.factory/config.json#test', 'node --test', 'test: passed on aaaaaaa']);
  assert.match(gate.subject.ref, /^web-storefront · run bbb222$/);
  assert.deepEqual([tests.definedBy.system, tests.text], ['quality', '2 of 3 required tests present (TC-9-1-3 missing)']);
  assert.deepEqual([qa1.definedBy, qa1.text], [{ system: 'product', ref: 'QA-9-1' }, 'Consistency (0 double-books): the test gate passed']);
  assert.equal(qa2.text, 'Latency (p95 < 300 ms): no gate checks it (Load test station): a person checks it');
  const t = await line.trace({ itemId: 'PRD-9', itemIds: ['PRD-9', 'STORY-9-1'] });
  assert.deepEqual(t.links, [{ from: 'run-0mvh0002-bbb222', rel: 'runs', to: 'WI-STORY-9-1-1' }], 'the latest run only');
  // No run yet: the quality attributes are there, not run.
  const none = await createLineChecks({ store: openStore({ env: testEnv() }), host }).checksFor({ itemId: 'PRD-9' });
  assert.deepEqual(none.map((c) => [c.key, c.result, c.text.split(': ')[1]]), [['quality-attribute:QA-9-1', 'not-run', 'no run has checked it yet (test gate)'], ['quality-attribute:QA-9-2', 'not-run', 'no run has checked it yet (Load test station)']]);
});
