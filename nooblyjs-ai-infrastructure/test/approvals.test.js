// Design approvals through the NooblyJS lifecycle engine (roadmap I3, NooblyJS Phase 9a): one `infra-design` approval per kind
// the design's current version waits on; deciding it on Home decides the design here, with the same refusals;
// deciding on the Design screen closes it there; asking for changes withdraws what is left. The engine is a
// stand-in that records what it is asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const API = '/infrastructure/api/v1';
const STEVIE = { id: 'stevie', name: 'Stevie', accessRole: 'Owner', active: true };
const PRIYA = { id: 'priya-s', name: 'Priya S.', accessRole: 'Contributor', active: true };

/** A stand-in lifecycle engine: open approvals by design and kind, and what it was asked. */
function fakeWorkflows() {
  const open = new Map();
  const calls = [];
  const key = (ref) => `${ref.designId}:${ref.kind}`;
  return {
    open,
    calls,
    async requestAppApproval(input) {
      calls.push(['request', input.ref.kind, input.ref.version, input.itemId]);
      if (!open.has(key(input.ref))) open.set(key(input.ref), input);
      return { approvalId: `apr_${input.ref.kind}` };
    },
    async closeAppApproval({ ref, decision, actor }) {
      calls.push(['close', ref.kind, decision, actor.id]);
      const had = open.delete(key(ref));
      return had ? { id: `apr_${ref.kind}`, status: decision } : null;
    },
    async withdrawAppApprovals({ ref, reason }) {
      const had = open.delete(key(ref));
      if (had) calls.push(['withdraw', ref.kind, reason]);
      return had ? 1 : 0;
    },
  };
}

test('the waiting version of INF-031 opens an approval for Test and one for Staging, once', async () => {
  const workflows = fakeWorkflows();
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    assert.equal(await t.hosted.syncApprovals(), true);
    assert.deepEqual([...workflows.open.keys()].sort(), ['INF-031:staging', 'INF-031:test']);
    const test = workflows.open.get('INF-031:test');
    assert.deepEqual([test.type, test.itemId, test.subject, test.link, test.ref.version, test.ref.kindLabel], ['infra-design', 'PRD-031', 'INF-031 v2', '/infrastructure/designs/INF-031?kind=test', 2, 'Test']);
    assert.equal(await t.hosted.syncApprovals(), true);
    assert.equal(workflows.calls.filter((c) => c[0] === 'request').length, 2, 'synced once');
  } finally {
    await t.close();
  }
});

test('decided on Home: the design is approved here with the same rules, the run starts, and the engine closes it itself', async () => {
  const workflows = fakeWorkflows();
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    await t.hosted.syncApprovals();
    // The same refusal as on the Design screen: a Contributor isn't the platform owner.
    await assert.rejects(t.hosted.services.decideApproval({ designId: 'INF-031', version: 2, kind: 'test', decision: 'approve', person: PRIYA }), { status: 403 });
    await assert.rejects(t.hosted.services.decideApproval({ designId: 'INF-031', version: 1, kind: 'test', decision: 'approve', person: STEVIE }), { code: 'stale_version' });
    const result = await t.hosted.services.decideApproval({ designId: 'INF-031', version: 2, kind: 'test', decision: 'approve', person: STEVIE });
    // pr-485 (a Preview, automatic) comes up to v2 with it.
    assert.equal(result.text, 'Approved for Test. Provisioning test-slots, pr-485.');
    assert.deepEqual(result.runs.map((r) => r.environment), ['test-slots', 'pr-485']);
    // The engine closes the Test approval itself; Staging still waits.
    assert.ok(!workflows.calls.some((c) => c[0] === 'close'));
    assert.ok(workflows.open.has('INF-031:test'), 'left for the engine to close');
    assert.ok(workflows.open.has('INF-031:staging'));
    await t.hosted.idle();
  } finally {
    await t.close();
  }
});

test('decided on the Design screen: the engine\'s approval for that kind is closed; asking for changes withdraws the rest', async () => {
  const workflows = fakeWorkflows();
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    await t.hosted.syncApprovals();
    const ok = await t.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'approve', kind: 'staging' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(workflows.calls.find((c) => c[0] === 'close'), ['close', 'staging', 'approve', 'stevie']);
    assert.ok(!workflows.open.has('INF-031:staging'));
    await t.hosted.idle();
  } finally {
    await t.close();
  }

  const again = fakeWorkflows();
  const u = await startApp({ seed: true, services: { workflows: again } });
  try {
    await u.hosted.syncApprovals();
    const changes = await u.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'request-changes', comment: 'Use the shared Redis' } });
    assert.equal(changes.status, 200);
    assert.equal(again.open.size, 0);
    assert.deepEqual(again.calls.filter((c) => c[0] === 'withdraw').map((c) => c[1]).sort(), ['staging', 'test']);
  } finally {
    await u.close();
  }
});

test('without the lifecycle engine, the decision is recorded on the design as before', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal(await t.hosted.syncApprovals(), false);
    const ok = await t.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'approve', kind: 'test' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.design.status, 'approved');
    await t.hosted.idle();
  } finally {
    await t.close();
  }
});
