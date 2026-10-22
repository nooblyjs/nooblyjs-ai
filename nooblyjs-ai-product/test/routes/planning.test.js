// NooblyJS Phase 25b in this app: objectives and key results, why on every card, the roadmap from the items with
// capacity in Now, saved views, strategy documents the drafting agents read, and the Product reports. On the stand-in
// host, with fakes for NooblyJS's teams, the lifecycle (each item's team), Operations (the monitor, releases) and Design.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let t;
const API = '/product/api/v1';
const TEAMS = { 'PRD-025': 'delivery-squad', 'PRD-027': 'delivery-squad', 'PRD-031': 'delivery-squad', 'PRD-029': 'checkout-squad', 'PRD-030': 'checkout-squad', 'PRD-032': 'checkout-squad', 'IDEA-020': null };
let measureNow = '20%';
const services = {
  teams: { list: async () => [{ id: 'delivery-squad', name: 'Delivery squad', capacityDays: 50 }, { id: 'checkout-squad', name: 'Checkout squad', capacityDays: 40 }] },
  workflows: { item: async ({ itemId }) => (itemId in TEAMS ? { id: itemId, team: TEAMS[itemId] } : null) },
  operations: {
    measure: async () => ({ value: measureNow, monitor: 'mock', real: false }),
    releases: async () => [{ id: 'REL-001', itemId: 'PRD-031', name: 'Slots 1.0', version: '1.0.0', statusText: 'In production: pilot', inProduction: true, href: '/operations/releases/REL-001', createdAt: '2026-10-22T09:00:00.000Z' }],
  },
  design: { designFor: async (itemId) => (itemId === 'PRD-031' ? { features: [{ id: 'FEAT-031-1', title: 'Book a same-day slot' }, { id: 'FEAT-031-2', title: 'See slots by store', dependsOn: ['FEAT-031-1'] }] } : null) },
};
const as = (id, body) => ({ as: id, ...(body === undefined ? {} : { body }) });

before(async () => {
  t = await startApp({ seed: true, services });
});
after(() => t?.close());

test('step 1: Lerato sets OBJ-04 in Now with a key result read from the monitor; PRD-031 serves it; agents and Viewers are refused', async () => {
  assert.deepEqual((await t.get(`${API}/objectives`, as('naledi-k'))).json.objectives.map((o) => [o.id, o.horizon]), [['OBJ-01', 'now'], ['OBJ-02', 'next'], ['OBJ-03', 'later']]);
  assert.equal((await t.post(`${API}/objectives`, as('naledi-k', { title: 'x' }))).status, 403);
  assert.equal((await t.post(`${API}/objectives`, as('ada-quill', { title: 'x' }))).status, 403);
  const made = await t.post(`${API}/objectives`, as('lerato-m', { title: 'More same-day orders', horizon: 'now', themes: ['Solve the every day'], links: ['PRD-031'] }));
  assert.equal(made.status, 201, made.text);
  assert.equal(made.json.id, 'OBJ-04');
  const kr = await t.post(`${API}/objectives/OBJ-04/key-results`, as('lerato-m', { measure: 'Same-day slots still open at 12:00', start: '18%', target: '45%', source: 'monitor' }));
  assert.equal(kr.status, 201, kr.text);
  const k = kr.json.keyResults[0];
  assert.deepEqual([k.id, k.now, k.status], ['KR-04-1', '20%', 'on-the-way']);
  assert.equal(k.text, 'Same-day slots still open at 12:00: 18% → 20% now, target 45% (on the way, from the monitor)');
  assert.equal(kr.json.progressText, '0 of 1 key result met');
  // An item serves one objective.
  assert.equal((await t.patch(`${API}/objectives/OBJ-01`, as('lerato-m', { links: ['PRD-029', 'PRD-031'] }))).status, 409);
  // Metrics as a source isn't there yet, and says so.
  assert.match((await t.post(`${API}/objectives/OBJ-04/key-results`, as('lerato-m', { measure: 'x', start: '1', target: '2', source: 'metrics' }))).json.error.message, /Metrics can't be read yet/);
  assert.ok(t.auditLog.some((a) => a.action === 'objective.created' && a.target === 'OBJ-04'));
});

test('step 2: the board orders by RICE as before; each card says why it is there', async () => {
  const board = (await t.get(`${API}/board`, as('lerato-m'))).json;
  const cards = board.columns.flatMap((c) => c.cards);
  const prd031 = cards.find((c) => c.id === 'PRD-031');
  assert.equal(prd031.why, 'serves OBJ-04 (Now)');
  assert.deepEqual(prd031.objective, { id: 'OBJ-04', title: 'More same-day orders', horizon: 'now' });
  const ideas = board.columns.find((c) => c.key === 'ideas').cards;
  assert.deepEqual(ideas.map((i) => i.id), ['IDEA-018', 'IDEA-019', 'IDEA-020'], 'by RICE, as before');
  assert.equal(ideas[0].why, 'RICE 42 · serves OBJ-02 (Next)');
});

test('steps 3 and 4: the roadmap from the items; capacity; Lerato moves PRD-027 to Next and PRD-025 to Later; a saved view, read-only', async () => {
  const r = (await t.get(`${API}/roadmap`, as('naledi-k'))).json;
  assert.deepEqual(r.horizons.map((h) => h.label), ['Now', 'Next', 'Later']);
  assert.match(r.horizons[0].text, /^\d+ [A-Z][a-z]{2} \d{4} to \d+ [A-Z][a-z]{2} \d{4}$/);
  const now = r.lanes.flatMap((l) => l.columns.now);
  assert.deepEqual(now.map((i) => i.id).sort(), ['PRD-025', 'PRD-027', 'PRD-029', 'PRD-030', 'PRD-031', 'PRD-032']);
  const prd031 = now.find((i) => i.id === 'PRD-031');
  assert.deepEqual([prd031.team.name, prd031.days.text, prd031.objective.id, prd031.release.name], ['Delivery squad', '30 days planned', 'OBJ-04', 'Slots 1.0']);
  assert.deepEqual(prd031.features.map((f) => f.text), ['depends on nothing', 'depends on FEAT-031-1']);
  const delivery = () => r2.capacity.find((c) => c.team.id === 'delivery-squad');
  let r2 = r;
  assert.equal(delivery().text, 'Delivery squad: 64 of 50 days planned in Now, 14 over');
  assert.equal(delivery().over, true);
  assert.equal(r.capacity.find((c) => c.team.id === 'checkout-squad').text, 'Checkout squad: 35 of 40 days planned in Now');
  assert.ok(r.timeline.items.some((i) => i.id === 'PRD-031'));

  // Only draft moves, and only people.
  assert.equal((await t.put(`${API}/roadmap/items/PRD-027`, as('naledi-k', { horizon: 'next' }))).status, 403);
  assert.equal((await t.put(`${API}/roadmap/items/PRD-027`, as('ada-quill', { horizon: 'next' }))).status, 403);
  const moved = await t.put(`${API}/roadmap/items/PRD-027`, as('lerato-m', { horizon: 'next' }));
  assert.equal(moved.status, 200, moved.text);
  assert.equal(moved.json.text, 'PRD-027 is in Next now.');
  assert.ok(t.auditLog.some((a) => a.action === 'roadmap.moved' && a.target === 'PRD-027' && a.from === 'now' && a.to === 'next'));
  r2 = (await t.get(`${API}/roadmap`, as('naledi-k'))).json;
  assert.equal(delivery().text, 'Delivery squad: 54 of 50 days planned in Now, 4 over');
  await t.put(`${API}/roadmap/items/PRD-025`, as('lerato-m', { horizon: 'later' }));
  r2 = (await t.get(`${API}/roadmap`, as('naledi-k'))).json;
  assert.deepEqual([delivery().text, delivery().over], ['Delivery squad: 30 of 50 days planned in Now', false]);

  // Grouped by objective and filtered to a team.
  const grouped = (await t.get(`${API}/roadmap?groupBy=objective&team=delivery-squad`, as('naledi-k'))).json;
  assert.deepEqual(grouped.lanes.map((l) => l.label), ['OBJ-04 More same-day orders', 'Serves no objective']);
  // A saved view, and its read-only page.
  const saved = await t.post(`${API}/roadmap/views`, as('lerato-m', { name: 'Delivery by objective', groupBy: 'objective', filter: { team: 'delivery-squad' } }));
  assert.equal(saved.status, 201, saved.text);
  const page = (await t.get(`${API}/roadmap/views/${saved.json.id}`, as('naledi-k'))).json;
  assert.equal(page.view.name, 'Delivery by objective');
  assert.deepEqual(page.roadmap.lanes.map((l) => l.label), grouped.lanes.map((l) => l.label));
  assert.ok(page.roadmap.lanes.flatMap((l) => l.columns.next).some((i) => i.id === 'PRD-027'), 'it shows PRD-027 in Next');
});

test('an item placed earlier than its objective is pointed out', async () => {
  // IDEA-020 serves OBJ-03, which is in Later.
  assert.equal((await t.put(`${API}/roadmap/items/IDEA-020`, as('lerato-m', { horizon: 'now' }))).status, 200);
  const r = (await t.get(`${API}/roadmap`, as('naledi-k'))).json;
  assert.ok(r.mismatches.includes('IDEA-020 is in Now, but OBJ-03 is in Later'), JSON.stringify(r.mismatches));
  assert.deepEqual((await t.get(`${API}/objectives/OBJ-03`, as('naledi-k'))).json.mismatches, ['IDEA-020 is in Now, but OBJ-03 is in Later']);
});

test('step 5: the outcome review of PRD-031 moves the key result; the objective is "1 of 1 key result behind"; a Product lead moves it', async () => {
  await t.emit('outcome_review.closed', { outcomeId: 'OR-031', itemId: 'PRD-031', met: 0, goals: 3, text: '0 of 3 goals met', measured: [{ measure: 'Same-day slots still open at 12:00', before: '18%', now: '31.5%', target: '45%', met: false }] }, 'lerato-m');
  await new Promise((r) => setTimeout(r, 50));
  const o = (await t.get(`${API}/objectives/OBJ-04`, as('naledi-k'))).json;
  assert.deepEqual([o.keyResults[0].now, o.keyResults[0].status], ['31.5%', 'behind']);
  assert.equal(o.progressText, '1 of 1 key result behind');
  assert.match(o.keyResults[0].text, /at PRD-031's outcome review/);
  // Moving between horizons is a Product lead's (approve), a person's.
  assert.equal((await t.post(`${API}/objectives/OBJ-04/move`, as('priya-s', { horizon: 'next' }))).status, 403);
  assert.equal((await t.post(`${API}/objectives/OBJ-04/move`, as('lerato-m', { horizon: 'next' }))).json.horizonText, 'Next');
  assert.ok(t.auditLog.some((a) => a.action === 'objective.moved' && a.from === 'now' && a.to === 'next'));
  // A typed reading that reaches the target is met.
  await t.post(`${API}/objectives/OBJ-01/key-results/KR-01-1/readings`, as('priya-s', { value: '8.5%' }));
  assert.equal((await t.get(`${API}/objectives/OBJ-01`, as('naledi-k'))).json.progressText, '1 of 1 key result met');
});

test('strategy documents: started from a template, filled in, and read by the drafting agents (designInputs)', async () => {
  const made = await t.post(`${API}/strategy-docs`, as('priya-s', { kind: 'persona', name: 'After-work shopper' }));
  assert.equal(made.status, 201, made.text);
  assert.deepEqual(made.json.sections.map((s) => s.heading), ['Who they are', 'Goals', 'Frustrations', 'How they shop', 'Quotes']);
  const saved = await t.put(`${API}/strategy-docs/${made.json.id}`, { ...as('priya-s', { sections: [{ heading: 'Goals', text: 'Get groceries home the same evening.' }] }), headers: { 'if-match': made.etag } });
  assert.equal(saved.status, 200, saved.text);
  const list = (await t.get(`${API}/strategy-docs`, as('naledi-k'))).json;
  assert.deepEqual(list.documents.map((d) => [d.kindLabel, d.name, d.text]), [['Persona', 'After-work shopper', '1 of 5 sections filled in']]);
  const inputs = await t.hosted.services.designInputs('PRD-031');
  assert.deepEqual(inputs.strategy, [{ kind: 'persona', kindLabel: 'Persona', name: 'After-work shopper', sections: [{ heading: 'Goals', text: 'Get groceries home the same evening.' }] }]);
  assert.equal((await t.post(`${API}/strategy-docs`, as('naledi-k', { kind: 'vision', name: 'x' }))).status, 403);
});

test('step 6: the Product reports: feedback by portfolio and month, planned days by objective and horizon, key results', async () => {
  await t.post(`${API}/feedback/notes`, as('priya-s', { text: 'Slots sell out early.', product: 'Delivery', from: { name: 'Store manager' } }));
  const r = (await t.get(`${API}/reports`, as('naledi-k'))).json;
  assert.deepEqual(r.feedback.byPortfolio, [{ label: 'Digital', count: 1 }]);
  assert.equal(r.feedback.byMonth.length, 1);
  const byObjective = Object.fromEntries(r.plannedDays.byObjective.map((x) => [x.label, x.days]));
  assert.equal(byObjective['OBJ-04 More same-day orders'], 30);
  assert.deepEqual(r.plannedDays.byHorizon.map((h) => h.label), ['Now', 'Next', 'Later']);
  assert.ok(r.keyResults.some((k) => k.keyResult === 'KR-04-1' && k.status === 'behind'));
  assert.deepEqual(await t.hosted.services.reports(), r);
});
