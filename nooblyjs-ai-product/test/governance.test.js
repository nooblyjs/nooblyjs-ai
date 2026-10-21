// Agents propose, people decide (product.md §1, nooblyjs-ai.md). Every rule has a test that proves it refuses, and
// every refusal is audited. P3 adds drafting over budget; P4 accepting an ADR; P6 sending to the Factory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { PEOPLE } from './fixtures/host.js';

const API = '/product/api/v1';
const workflows = { calls: [], decide: async (input) => workflows.calls.push(input) };

test('step 3: Priya (Contributor) approving PRD-031 is refused, and the refusal is audited', async () => {
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    const res = await t.post(`${API}/specs/PRD-031/decision`, { as: 'priya-s', body: { decision: 'approve' } });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'forbidden');
    const refusal = t.auditLog.find((r) => r.action === 'access.refused');
    assert.deepEqual([refusal.actor, refusal.permission, refusal.target], ['priya-s', 'approve', 'POST /product/api/v1/specs/PRD-031/decision']);
    assert.equal(workflows.calls.length, 0);
  } finally {
    await t.close();
  }
});

test('an agent approving a spec is refused and audited', async () => {
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    const res = await t.post(`${API}/specs/PRD-031/decision`, { as: 'ada-quill', body: { decision: 'approve' } });
    assert.equal(res.status, 403);
    assert.ok(t.auditLog.some((r) => r.actor === 'ada-quill' && r.action === 'access.refused'));
  } finally {
    await t.close();
  }
});

test('an agent wrongly given Approver is still refused: the rule is "people only", not just the role', async () => {
  const promoted = PEOPLE.map((p) => (p.id === 'ada-quill' ? { ...p, accessRole: 'Approver' } : p));
  const t = await startApp({ seed: true, services: { workflows }, people: promoted });
  try {
    const res = await t.post(`${API}/specs/PRD-031/decision`, { as: 'ada-quill', body: { decision: 'approve' } });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'people_only');
    const refusal = t.auditLog.find((r) => r.actor === 'ada-quill' && r.action === 'access.refused');
    assert.match(refusal.reason, /agents propose, people decide/);
    assert.equal(workflows.calls.length, 0);
  } finally {
    await t.close();
  }
});

test('an agent may draft: its edit is recorded as drafted by the agent', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.put(`${API}/specs/PRD-032`, { as: 'ada-quill', headers: { 'if-match': '"PRD-032@1"' }, body: { stories: ['As a shopper, my promo code works in the app.'] } });
    assert.equal(res.status, 200);
    assert.equal(res.json.authorship.text, 'Drafted by Ada Quill · v2');
  } finally {
    await t.close();
  }
});

test('an agent may not edit an approved spec', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.put(`${API}/specs/PRD-025`, { as: 'ada-quill', headers: { 'if-match': '"PRD-025@3"' }, body: { problem: 'Rewritten' } });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, 'approved');
  } finally {
    await t.close();
  }
});
