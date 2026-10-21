// NooblyJS Phase 16f: the Product section's checks and its part of the trace, on the seed's PRD-031. Its checks are the
// spec's seven readiness checks (worked out from the spec where the text can say) and the standards check of its
// container view, in NooblyJS's one shape; its trace is the spec, its goals (GOAL-031-1, a row of the Goals table), its
// decisions and its quality attributes (QA-031-1), each linked to the item.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

test('PRD-031: the spec\'s readiness and the standards check; its goals, decisions and quality attributes', async () => {
  const t = await startApp({ seed: true });
  try {
    const checks = await t.hosted.services.checksFor('PRD-031');
    const readiness = checks.filter((c) => c.kind === 'readiness');
    assert.equal(readiness.length, 7);
    assert.deepEqual(readiness.find((c) => c.key === 'rollout-plan'), {
      key: 'rollout-plan', kind: 'readiness', subject: { item: 'PRD-031', ref: 'PRD-031 v4' }, definedBy: { system: 'product', ref: 'spec readiness · rollout-plan' },
      verifiedBy: 'spec content', severity: 'blocking', result: 'failed', text: 'Rollout plan missing',
      evidence: { system: 'product', ref: '/product/specs/PRD-031', summary: 'Read from the spec (version 4)' }, at: readiness[0].at,
    });
    assert.equal(readiness.find((c) => c.key === 'dependencies-named').verifiedBy, 'person', 'what the text can\'t judge was recorded by a person');
    assert.deepEqual(checks.filter((c) => c.kind === 'standard').map((c) => c.key), ['approved-stack', 'data-in-region', 'api-contract', 'dependency-adr']);
    assert.deepEqual(await t.hosted.services.checksFor('PRD-999'), [], 'no spec, no checks');
    const trace = await t.hosted.services.trace('PRD-031');
    const ids = trace.nodes.map((n) => n.id);
    for (const id of ['PRD-031', 'GOAL-031-1', 'GOAL-031-2', 'GOAL-031-3', 'ADR-014', 'QA-031-1', 'QA-031-4']) assert.ok(ids.includes(id), id);
    assert.equal(trace.nodes.find((n) => n.id === 'GOAL-031-1').title, 'Same-day slots still open at 12:00: 18% → 45%');
    assert.deepEqual(trace.links.filter((l) => l.from === 'GOAL-031-1' || l.from === 'QA-031-1'), [{ from: 'GOAL-031-1', rel: 'goal-of', to: 'PRD-031' }, { from: 'QA-031-1', rel: 'quality-attribute-of', to: 'PRD-031' }]);
  } finally {
    await t.close();
  }
});
