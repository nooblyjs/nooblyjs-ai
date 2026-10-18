// Stage 3 · UX design (docs/roadmap-history.md P5): journey, flows, research, open questions and the design agent's drafts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

const API = '/product/api/v1';

test('step 1: the journey has its five steps, four rows, and the out-of-scope link to PRD-033', async () => {
  const t = await startApp({ seed: true });
  try {
    const j = (await t.get(`${API}/ux/PRD-031/journey`, { as: 'naledi-k' })).json;
    assert.equal(j.title, 'Journey · evening shopper');
    assert.equal(j.basis, 'Built from 412 tickets and 8 interviews');
    assert.deepEqual(j.steps.map((s) => s.name), ['Plan the shop', 'Pick a slot', 'Build basket', 'Checkout', 'Delivery']);
    assert.deepEqual(j.rows.map((r) => r.label), ['Doing', 'Feeling', 'Pain', 'Opportunity']);
    assert.equal(j.steps[3].opportunityText, 'Out of scope · PRD-033');
    assert.equal(j.steps[1].pain, '"Every slot today says full"');
  } finally {
    await t.close();
  }
});

test('flows, research and the open question', async () => {
  const t = await startApp({ seed: true });
  try {
    const flows = (await t.get(`${API}/ux/PRD-031/flows`, { as: 'naledi-k' })).json.flows;
    assert.deepEqual(flows.map((f) => [f.title, f.summary]), [['Choose and hold a slot', '5 screens · 1 decision']]);
    const flow = (await t.get(`${API}/ux/PRD-031/flows/choose-and-hold-a-slot`, { as: 'naledi-k' })).json;
    assert.deepEqual(flow.edges.filter((e) => e.from === 'free').map((e) => [e.to, e.label]), [['hold', 'yes'], ['alternatives', 'no']]);
    const studies = (await t.get(`${API}/ux/PRD-031/research`, { as: 'naledi-k' })).json.studies;
    assert.deepEqual(studies.map((s) => s.headline).sort(), ['7 of 8', 'Day tabs']);
    const q = (await t.get(`${API}/ux/PRD-031/questions`, { as: 'naledi-k' })).json;
    assert.equal(q.questions[0].text, 'Should the hold timer be visible on every screen?');
    assert.equal((await t.get(`${API}/ux/PRD-031/flows/nope`, { as: 'naledi-k' })).status, 404);
  } finally {
    await t.close();
  }
});

test('editing the journey and a flow takes If-Match; a flow can\'t point at a node it doesn\'t have', async () => {
  const t = await startApp({ seed: true });
  try {
    const j = await t.get(`${API}/ux/PRD-031/journey`, { as: 'lerato-m' });
    const steps = j.json.steps.map(({ opportunityText, ...s }) => s);
    steps[0].feeling = 'Calm';
    const saved = await t.put(`${API}/ux/PRD-031/journey`, { as: 'lerato-m', headers: { 'if-match': j.etag }, body: { steps } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.steps[0].feeling, 'Calm');
    assert.equal((await t.put(`${API}/ux/PRD-031/journey`, { as: 'lerato-m', headers: { 'if-match': j.etag }, body: { steps } })).status, 409);
    assert.equal((await t.put(`${API}/ux/PRD-031/journey`, { as: 'lerato-m', body: { steps } })).status, 428);

    const loose = await t.put(`${API}/ux/PRD-031/flows/checkout`, {
      as: 'lerato-m', headers: { 'if-match': '"PRD-031.flow.checkout@0"' },
      body: { title: 'Checkout', nodes: [{ id: 'cart', kind: 'screen', label: 'Cart' }], edges: [{ from: 'cart', to: 'pay' }] },
    });
    assert.equal(loose.status, 422);
    assert.match(loose.json.error.details.edges, /cart → pay/);
  } finally {
    await t.close();
  }
});

test('step 2: the design agent drafts a flow, which arrives as a version, attributed and costed', async () => {
  const t = await startApp({ seed: true });
  try {
    const noBrief = await t.post(`${API}/ux/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'flow' } });
    assert.equal(noBrief.status, 422);
    const asked = await t.post(`${API}/ux/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'flow', brief: 'release extra evening capacity' } });
    assert.equal(asked.status, 202);
    assert.equal(asked.json.teammate.name, 'Design agent');
    await t.hosted.idle();
    const flow = (await t.get(`${API}/ux/PRD-031/flows/release-extra-evening-capacity`, { as: 'lerato-m' })).json;
    assert.equal(flow.version, 1);
    assert.equal(flow.summary, '3 screens · 1 decision');
    const action = t.eventLog.find((e) => e.type === 'agent.action').payload;
    assert.deepEqual([action.teammateId, action.action, action.costUsd], ['design-agent', 'flow', 0.9]);
    assert.ok(t.eventLog.some((e) => e.type === 'ux.flow_drafted'));
  } finally {
    await t.close();
  }
});

test('Run a quick test: a study for the open question, linked to it', async () => {
  const t = await startApp({ seed: true });
  try {
    const asked = await t.post(`${API}/ux/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'quick-test', questionId: 'hold-timer-everywhere' } });
    assert.equal(asked.status, 202);
    await t.hosted.idle();
    const studies = (await t.get(`${API}/ux/PRD-031/research`, { as: 'lerato-m' })).json.studies;
    const quick = studies.find((s) => s.kind === 'quick-test');
    assert.equal(quick.title, 'Quick test: Should the hold timer be visible on every screen?');
    const q = (await t.get(`${API}/ux/PRD-031/questions`, { as: 'lerato-m' })).json.questions[0];
    assert.equal(q.quickTest.studyId, quick.id);
    const unknown = await t.post(`${API}/ux/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'quick-test', questionId: 'nope' } });
    assert.equal(unknown.status, 422);
  } finally {
    await t.close();
  }
});

test('the design agent drafts a journey for an item without one', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.post(`${API}/ux/PRD-027/drafts`, { as: 'lerato-m', body: { kind: 'journey', brief: 'customer waiting for a delivery' } });
    await t.hosted.idle();
    const j = (await t.get(`${API}/ux/PRD-027/journey`, { as: 'lerato-m' })).json;
    assert.equal(j.version, 1);
    assert.equal(j.persona, 'customer waiting for a delivery');
    assert.equal(j.steps.length, 4);
    const items = (await t.get(`${API}/ux`, { as: 'lerato-m' })).json.items;
    assert.deepEqual(items.map((i) => i.itemId), ['PRD-031', 'PRD-027']);
  } finally {
    await t.close();
  }
});

test('UX edits need draft; Viewers can read', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal((await t.get(`${API}/ux/PRD-031/journey`, { as: 'naledi-k' })).status, 200);
    assert.equal((await t.put(`${API}/ux/PRD-031/questions`, { as: 'naledi-k', headers: { 'if-match': '"PRD-031.questions@1"' }, body: { questions: [] } })).status, 403);
  } finally {
    await t.close();
  }
});
