// NooblyJS Phase 16f: the infrastructure design's checks and its part of the trace, on the seed's INF-031 for PRD-031.
// Its policy checks, at the design's current version, for each kind of environment a person approves (Test, Staging,
// Production), in NooblyJS's one shape: a policy that blocks is blocking, one that warns a warning. The design is linked
// to its item in the trace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('INF-031: its policy checks per kind of environment, and the design in PRD-031\'s trace', async () => {
  const t = await startApp({ seed: true });
  try {
    const checks = await t.hosted.services.checksFor('PRD-031');
    assert.deepEqual([...new Set(checks.map((c) => c.subject.ref))], ['INF-031 v2 · Test', 'INF-031 v2 · Staging', 'INF-031 v2 · Production']);
    assert.ok(checks.every((c) => c.kind === 'policy' && c.definedBy.system === 'infrastructure' && c.verifiedBy === 'policy check'));
    const tier = checks.find((c) => c.key === 'test:default-tier');
    assert.deepEqual([tier.result, tier.severity, tier.text, tier.definedBy.ref], ['warning', 'warning', 'Cache tier above Test default', 'policies.yaml#default-tier']);
    assert.equal(checks.find((c) => c.key === 'production:in-region').result, 'passed');
    assert.equal(tier.evidence.ref, '/infrastructure/designs/INF-031');
    assert.deepEqual(await t.hosted.services.checksFor('PRD-999'), []);
    assert.deepEqual(await t.hosted.services.trace('PRD-031'), {
      nodes: [{ id: 'INF-031', type: 'infrastructure', title: 'Infrastructure for same-day slots (version 2)', status: 'waiting-approval', system: 'infrastructure', href: '/infrastructure/designs/INF-031' }],
      links: [{ from: 'INF-031', rel: 'infrastructure-for', to: 'PRD-031' }],
    });
  } finally {
    await t.close();
  }
});
