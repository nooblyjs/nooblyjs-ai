// Flow across the stages (docs/roadmap-history.md P7): send-back, the Handoffs history, what is waiting on a person, Knowledge
// flags, and the metrics facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

const API = '/product/api/v1';

async function eventually(check, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('step 1: PRD-027 is sent back to Product with a reason; it shows on Handoffs and the spec reopens', async () => {
  let t;
  const workflows = {
    calls: [],
    async sendBack(input) {
      this.calls.push(input);
      await t.emit('item.sent_back', { itemId: input.itemId, system: 'product', from: input.from, to: input.to, reason: input.reason }, input.actor.id);
    },
  };
  t = await startApp({ seed: true, services: { workflows } });
  try {
    const res = await t.post(`${API}/specs/PRD-027/send-back`, { as: 'thabo-n', body: { to: 'product', reason: 'The map needs a privacy review first.' } });
    assert.equal(res.status, 202);
    assert.equal(res.json.text, 'PRD-027 is going back to Product. Its work so far is kept.');
    assert.deepEqual(workflows.calls[0], { itemId: 'PRD-027', system: 'product', from: 'architecture', to: 'product', reason: 'The map needs a privacy review first.', actor: { id: 'thabo-n', kind: 'person' } });

    const spec = await eventually(async () => {
      const s = (await t.get(`${API}/specs/PRD-027`, { as: 'thabo-n' })).json;
      return s.sentBack && s;
    });
    assert.equal(spec.status, 'changes-requested');
    assert.equal(spec.sentBack.text, 'Sent back from architecture: The map needs a privacy review first.');
    const back = (await t.get(`${API}/handoffs?kind=sent-back`, { as: 'thabo-n' })).json.handoffs;
    assert.equal(back[0].text, 'Sent back from Architecture to Product: The map needs a privacy review first.');
    // Its architecture work is kept.
    assert.equal((await t.get(`${API}/architecture/PRD-027/adrs`, { as: 'thabo-n' })).json.adrs.length, 1);
  } finally {
    await t.close();
  }
});

test('send-back is people only, goes to an earlier stage, and is 503 without the NooblyJS lifecycle engine', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal((await t.post(`${API}/specs/PRD-027/send-back`, { as: 'ada-quill', body: { to: 'product', reason: 'x' } })).status, 403);
    assert.equal((await t.post(`${API}/specs/PRD-027/send-back`, { as: 'thabo-n', body: { from: 'architecture', to: 'ui', reason: 'x' } })).status, 422);
    assert.equal((await t.post(`${API}/specs/PRD-027/send-back`, { as: 'thabo-n', body: { to: 'product' } })).status, 422);
    assert.equal((await t.post(`${API}/specs/PRD-027/send-back`, { as: 'thabo-n', body: { to: 'product', reason: 'x' } })).status, 503);
  } finally {
    await t.close();
  }
});

test('step 2: what is waiting on each person, for Home and For you', async () => {
  const t = await startApp({ seed: true });
  try {
    const stevie = (await t.get(`${API}/waiting`, { as: 'stevie' })).json.rows.map((r) => r.text);
    assert.ok(stevie.includes('Approve PRD-031 · Same-day delivery slots'));
    assert.ok(stevie.includes('Accept or discuss ADR-014 · Cache slot availability in Redis with a 30-second TTL'));
    const lerato = (await t.get(`${API}/waiting`, { as: 'lerato-m' })).json.rows.map((r) => r.text);
    assert.ok(lerato.includes('Brief the agent on PRD-030 · Loyalty points at checkout'));
    assert.ok(lerato.includes('Send PRD-031 to the Software Factory (6 work items)'));
    assert.ok(!lerato.some((r) => r.startsWith('Accept or discuss')), 'ADRs are for Architects and Owners');
    const priya = (await t.get(`${API}/waiting`, { as: 'priya-s' })).json.rows;
    assert.deepEqual(priya, []);
    assert.deepEqual(await t.hosted.services.waitingFor({ id: 'priya-s', accessRole: 'Contributor' }), []);
  } finally {
    await t.close();
  }
});

test('step 4: a flagged Knowledge answer marks the specs that cite it', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.emit('knowledge.answer_flagged', { knowledgeId: 'kn-slot-capacity-model', reason: 'Capacity numbers are from 2025' }, 'stevie');
    const spec = await eventually(async () => {
      const s = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
      return s.knowledge.some((k) => k.flagged) && s;
    });
    assert.deepEqual(spec.knowledge.find((k) => k.id === 'kn-slot-capacity-model').flagged.reason, 'Capacity numbers are from 2025');
    assert.equal(spec.knowledge.find((k) => k.id === 'ADR-013').flagged, null);
  } finally {
    await t.close();
  }
});

test('step 5: metrics facts: lead time, sent-back rate per stage, spend by stage', async () => {
  const t = await startApp({ seed: true });
  try {
    const m = (await t.get(`${API}/metrics`, { as: 'naledi-k' })).json;
    assert.equal(m.leadTime.items, 2);
    assert.match(m.leadTime.text, /days from spec to Architecture \(median of 2\)$/);
    assert.equal(m.sentBack[0].text, '1 of 3 sent back');
    assert.equal(m.sentBack[0].label, 'Product');
    assert.deepEqual(await t.hosted.services.metrics(), m);
    assert.deepEqual((await t.hosted.services.gatesFor('PRD-031')).map((g) => g.attribute), ['Latency', 'Consistency', 'Availability', 'Cost']);
  } finally {
    await t.close();
  }
});
