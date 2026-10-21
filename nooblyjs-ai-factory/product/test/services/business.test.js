// NooblyJS Phase 17: the work hierarchy and business cases, on the section on its own (the seed's catalogue). A portfolio
// epic, an epic and a feature are added where they may sit, each with its document; an idea names its feature; the board
// filters by epic and feature. A business case is drafted by an agent (with no history here, its estimate says so),
// saved by a person (never an agent), complete only when every required field is filled; it is the Discover check of an
// idea; and Accept asks the lifecycle engine (a stand-in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';
import { missingFrom } from '../../src/services/business-cases.js';
import { median, workingDays } from '../../src/services/estimate.js';

const API = '/product/api/v1';

test('the hierarchy: where each may sit, documents from templates, an idea\'s feature, the board\'s filters', async () => {
  const t = await startApp({ seed: true });
  try {
    const pe = await t.post(`${API}/catalogue/epics`, { as: 'priya-s', body: { kind: 'portfolio-epic', name: 'Grow online', portfolio: 'Digital' } });
    assert.equal(pe.status, 201);
    assert.equal(pe.json.epic.id, 'PEPIC-001');
    const epic = await t.post(`${API}/catalogue/epics`, { as: 'priya-s', body: { kind: 'epic', name: 'Same-day everything', portfolio: 'Digital', valueStream: 'Digital Commerce', parent: 'PEPIC-001' } });
    assert.deepEqual([epic.status, epic.json.epic.id, epic.json.epic.parent], [201, 'EPIC-001', 'PEPIC-001']);
    // Refused: no portfolio; a value stream of another portfolio; an epic under an epic; a feature under a portfolio epic.
    assert.equal((await t.post(`${API}/catalogue/epics`, { as: 'priya-s', body: { name: 'Nowhere' } })).status, 400);
    assert.equal((await t.post(`${API}/catalogue/epics`, { as: 'priya-s', body: { name: 'X', portfolio: 'Buying', valueStream: 'Rewards' } })).status, 400);
    assert.equal((await t.post(`${API}/catalogue/epics`, { as: 'priya-s', body: { name: 'X', portfolio: 'Digital', parent: 'EPIC-001' } })).status, 400);
    assert.equal((await t.post(`${API}/catalogue/features`, { as: 'priya-s', body: { name: 'X', epic: 'PEPIC-001' } })).status, 400);
    // A Viewer can't add one.
    assert.equal((await t.post(`${API}/catalogue/epics`, { as: 'naledi-k', body: { name: 'X', portfolio: 'Digital' } })).status, 403);
    const feature = await t.post(`${API}/catalogue/features`, { as: 'priya-s', body: { name: 'See capacity by store', epic: 'EPIC-001' } });
    assert.deepEqual([feature.json.feature.id, feature.json.feature.portfolioEpic.id, feature.json.feature.valueStream], ['FEAT-001', 'PEPIC-001', 'Digital Commerce']);
    assert.equal((await t.get(`${API}/portfolio-epics/PEPIC-001`, { as: 'priya-s' })).json.sections[0].heading, 'Outcome');
    const doc = (await t.get(`${API}/features/FEAT-001`, { as: 'priya-s' })).json;
    assert.deepEqual([doc.epic, doc.portfolio, doc.valueStream], ['EPIC-001', 'Digital', 'Digital Commerce']);
    // Its document is saved like a portfolio's.
    const saved = await t.put(`${API}/features/FEAT-001`, { as: 'priya-s', body: { sections: [{ heading: 'Description', text: 'Customers see which stores have capacity.' }] }, headers: { 'If-Match': doc.etag } });
    assert.equal(saved.status, 200);
    // The catalogue's own writes keep the hierarchy.
    assert.equal((await t.post(`${API}/catalogue/products`, { as: 'priya-s', body: { name: 'Lockers', portfolio: 'Digital' } })).status, 201);
    assert.deepEqual((await t.get(`${API}/hierarchy`, { as: 'priya-s' })).json.features.map((f) => f.id), ['FEAT-001']);
    // An idea under FEAT-001, and the board's filters.
    const idea = await t.post(`${API}/ideas`, { as: 'priya-s', body: { title: 'Capacity on the home page', product: 'Delivery', feature: 'FEAT-001' } });
    assert.equal(idea.status, 201);
    assert.equal((await t.post(`${API}/ideas`, { as: 'priya-s', body: { title: 'Bad', feature: 'EPIC-001' } })).status, 422);
    const board = (await t.get(`${API}/board?feature=FEAT-001`, { as: 'priya-s' })).json;
    assert.deepEqual(board.columns.flatMap((c) => c.cards.map((x) => x.id)), [idea.json.id]);
    assert.deepEqual(board.features.map((f) => [f.id, f.count, f.active]), [['FEAT-001', 1, true]]);
  } finally {
    await t.close();
  }
});

test('a business case: drafted by an agent with an estimate that says it has no history here; saved by a person; complete; the Discover check', async () => {
  const accepted = [];
  const workflows = { acceptIdea: async (input) => { accepted.push(input); return { outcome: 'approved', text: 'Approved.', item: { id: input.itemId, stage: 'product' } }; } };
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    const empty = (await t.get(`${API}/business-cases/IDEA-018`, { as: 'priya-s' })).json;
    assert.deepEqual([empty.exists, empty.complete, empty.text], [false, false, 'No business case yet']);
    assert.deepEqual(await t.hosted.services.readinessFacts('IDEA-018'), { itemId: 'IDEA-018', facts: { 'business-case-complete': { value: false, detail: 'there is none yet' } } });
    const drafted = await t.post(`${API}/business-cases/IDEA-018/draft`, { as: 'priya-s' });
    assert.equal(drafted.status, 200);
    const c = drafted.json;
    assert.equal(c.draftedBy.name, 'Ada Quill');
    assert.deepEqual([c.estimate.agentUsd, c.estimate.cloudUsdMonth], [0, 0]);
    assert.match(c.estimate.basis.find((b) => b.part === 'agentUsd').text, /^No similar item in the Delivery product has agent spend yet: 0 until a person sets it$/);
    assert.deepEqual(c.missing, ['the measure (what, today and target)']);
    // An agent never saves one; a person does, and a number they set says it is theirs.
    const agent = await t.put(`${API}/business-cases/IDEA-018`, { as: 'ada-quill', body: { measure: { target: '30%' } } });
    assert.deepEqual([agent.status, agent.json.error.code], [403, 'people_only']);
    assert.equal((await t.post(`${API}/ideas/IDEA-018/accept`, { as: 'ada-quill' })).status, 403, 'nor accepts an idea');
    const bad = await t.put(`${API}/business-cases/IDEA-018`, { as: 'priya-s', body: { horizonMonths: 0 } });
    assert.equal(bad.status, 400);
    const done = await t.put(`${API}/business-cases/IDEA-018`, { as: 'priya-s', body: { measure: { target: '30%' }, estimate: { agentUsd: 120 } } });
    assert.equal(done.status, 200);
    assert.equal(done.json.complete, true);
    assert.match(done.json.estimate.basis.find((b) => b.part === 'agentUsd').text, /^Set by a person \(the history said 0\)$/);
    assert.deepEqual((await t.hosted.services.readinessFacts('IDEA-018')).facts, { 'business-case-complete': { value: true } });
    // Accept asks the lifecycle engine, then the idea is accepted here.
    const a = await t.post(`${API}/ideas/IDEA-018/accept`, { as: 'lerato-m' });
    assert.deepEqual([a.status, a.json.outcome], [200, 'approved']);
    assert.deepEqual([accepted[0].itemId, accepted[0].title], ['IDEA-018', 'Smarter substitutions']);
    assert.equal((await t.get(`${API}/ideas/IDEA-018`, { as: 'priya-s' })).json.status, 'accepted');
    // The Business owner's list: every open idea and epic, each in words.
    const all = await t.hosted.services.businessCases();
    assert.ok(all.some((x) => x.ownerId === 'IDEA-019' && !x.exists));
    assert.ok(!all.some((x) => x.ownerId === 'IDEA-018'), 'accepted, no longer waiting');
  } finally {
    await t.close();
  }
});

test('completeness, the median and working days', () => {
  assert.deepEqual(missingFrom(null), ['the value hypothesis', 'who benefits', 'the measure (what, today and target)', 'the cost estimate', 'the horizon']);
  assert.deepEqual(missingFrom({ valueHypothesis: 'v', beneficiaries: 'b', measure: { what: 'w', today: '1', target: '[PLACEHOLDER: x]' }, estimate: { agentUsd: 0, cloudUsdMonth: 0, peopleDays: 0 }, horizonMonths: 6 }), ['the measure (what, today and target)']);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(workingDays('2026-10-16T00:00:00.000Z', '2026-10-20T00:00:00.000Z'), 2, 'Friday and Monday');
});
