// Phase 17 in the real app (root roadmap Phase 17 test script): an epic and a feature under Digital › Digital Commerce,
// an idea filed under the feature and the board filtered by it; the idea refused at the Discover exit until its business
// case is complete, an agent's draft with an estimate that says where its numbers came from, then accepted; a budget for
// the Digital portfolio and Metrics' spend by value stream (agent and cloud); and the Business owner's home. The
// Software Factory (its Product section) and Infrastructure are hosted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let priya;
const product = '/factory/product/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const put = (c, url, json = {}) => c.request(url, { method: 'PUT', json });
let ideaId;

before(async () => {
  env = await startApp({ hostedApps: [{ package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true }, { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true }] });
  [stevie, lerato, priya] = [env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [priya, 'priya-s']]) await c.signIn(id);
});
after(async () => { await env?.stop(); });

test('step 1: an epic and a feature under Digital › Digital Commerce; an idea filed under the feature; the board filters by it', async () => {
  const epic = await post(priya, `${product}/catalogue/epics`, { kind: 'epic', name: 'Same-day everything', portfolio: 'Digital', valueStream: 'Digital Commerce' });
  assert.equal(epic.status, 201);
  const e = (await epic.json()).epic;
  assert.deepEqual([e.id, e.kind, e.portfolio, e.valueStream], ['EPIC-001', 'epic', 'Digital', 'Digital Commerce']);
  const feature = await post(priya, `${product}/catalogue/features`, { name: 'See capacity by store', epic: 'EPIC-001' });
  assert.equal(feature.status, 201);
  const f = (await feature.json()).feature;
  assert.deepEqual([f.id, f.epic.id, f.valueStream], ['FEAT-001', 'EPIC-001', 'Digital Commerce']);
  // Each has a document from its template, like a portfolio.
  const doc = (await priya.json(`${product}/epics/EPIC-001`)).body;
  assert.deepEqual(doc.sections.map((s) => s.heading), ['Summary', 'Outcome', 'Non-functional requirements', 'Dependencies']);
  assert.equal((await priya.json(`${product}/features/FEAT-001`)).body.sections[1].heading, 'Benefit hypothesis');
  // A feature that isn't there is refused; the idea under FEAT-001 is filed.
  assert.equal((await post(priya, `${product}/ideas`, { title: 'Nowhere', feature: 'FEAT-999' })).status, 404);
  const idea = await post(priya, `${product}/ideas`, { title: 'Show capacity by store on the home page', product: 'Delivery', feature: 'FEAT-001', problem: 'Customers find out a store is full only at the slot step.' });
  assert.equal(idea.status, 201);
  const i = await idea.json();
  ideaId = i.id;
  assert.deepEqual([i.feature, i.epic], [{ id: 'FEAT-001', name: 'See capacity by store' }, { id: 'EPIC-001', name: 'Same-day everything' }]);
  const board = (await priya.json(`${product}/board?feature=FEAT-001`)).body;
  assert.deepEqual(board.columns.find((c) => c.key === 'ideas').cards.map((c) => c.id), [ideaId]);
  assert.equal(board.columns.reduce((n, c) => n + c.count, 0), 1, 'only what is filed under the feature');
  const all = (await priya.json(`${product}/board?valueStream=Digital%20Commerce`)).body;
  assert.deepEqual(all.epics.map((x) => [x.id, x.count]), [['EPIC-001', 1]]);
  assert.deepEqual(all.features.map((x) => [x.id, x.count]), [['FEAT-001', 1]]);
  assert.deepEqual((await priya.json(`${product}/board?epic=EPIC-001`)).body.columns.find((c) => c.key === 'ideas').cards.map((c) => c.id), [ideaId]);
});

test('step 2: the idea can\'t be accepted until its business case is complete; the agent\'s draft has an estimate with its sources', async () => {
  const refused = await post(lerato, `${product}/ideas/${ideaId}/accept`, {});
  assert.equal(refused.status, 422);
  const err = (await refused.json()).error;
  assert.equal(err.code, 'readiness_failed');
  assert.match(err.message, /Business case not complete: there is none yet/);
  const drafted = await post(priya, `${product}/business-cases/${ideaId}/draft`);
  assert.equal(drafted.status, 200);
  const c = await drafted.json();
  assert.equal(c.draftedBy.name, 'Ada Quill');
  assert.ok(c.valueHypothesis && c.beneficiaries.startsWith('Customers of Delivery'));
  // The estimate, from the factory's history of similar items (the Delivery product's specs), each part with its source.
  const e = c.estimate;
  assert.equal(e.like, 'the Delivery product');
  assert.ok(e.similar.includes('PRD-031'));
  assert.ok(e.agentUsd > 0, JSON.stringify(e));
  assert.match(e.basis.find((b) => b.part === 'agentUsd').text, /^The median agent spend of \d+ similar items? in the Delivery product \(.*PRD-031 \$[\d.,]+.*\), from the event log$/);
  assert.ok(e.cloudUsdMonth > 0);
  assert.match(e.basis.find((b) => b.part === 'cloudUsdMonth').text, /PRD-031: INF-031 at \$[\d.,]+ a day\), from Infrastructure$/);
  assert.ok(e.peopleDays > 0);
  assert.match(e.basis.find((b) => b.part === 'peopleDays').text, /spent in Product, Design and Engineer \(.*PRD-031 [\d.]+.*\), from the lifecycle$/);
  // The measure's target is a person's: still not complete, still refused.
  assert.deepEqual(c.missing, ['the measure (what, today and target)']);
  assert.equal((await post(lerato, `${product}/ideas/${ideaId}/accept`, {})).status, 422);
  // An agent can't save one.
  const services = env.noobly.hosted.apps.find((a) => a.name === 'factory').provides.product;
  assert.ok(services.businessCases);
  const saved = await put(lerato, `${product}/business-cases/${ideaId}`, { measure: { target: '25% of same-day orders' } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).complete, true);
  const accepted = await post(lerato, `${product}/ideas/${ideaId}/accept`, {});
  assert.equal(accepted.status, 200, await accepted.clone().text());
  const a = await accepted.json();
  assert.deepEqual([a.outcome, a.item.stage], ['approved', 'product']);
  assert.equal((await priya.json(`${product}/ideas/${ideaId}`)).body.status, 'accepted');
  await eventually(async () => assert.ok((await today(env.store, 'events')).some((ev) => ev.type === 'approval.decided' && ev.payload.type === 'idea' && ev.payload.itemId === ideaId)));
});

test('step 3: a budget for the Digital portfolio; Metrics shows agent and cloud spend by value stream', async () => {
  assert.equal((await put(priya, '/api/v1/platform/settings/budgets/portfolios/Digital', { monthly: 5000 })).status, 403, 'set-budgets is an Owner\'s');
  assert.equal((await put(stevie, '/api/v1/platform/settings/budgets/portfolios/Nowhere', { monthly: 5 })).status, 404);
  const set = await put(stevie, '/api/v1/platform/settings/budgets/portfolios/Digital', { monthly: 5000, reason: 'The Q4 plan' });
  assert.equal(set.status, 200);
  assert.deepEqual((await set.json()).budgets.portfolios, [{ name: 'Digital', monthly: 5000 }]);
  const s = (await stevie.json('/api/v1/home/metrics')).body.spendByValueStream;
  const commerce = s.rows.find((r) => r.valueStream === 'Digital Commerce');
  assert.ok(commerce.agentUsd > 0 && commerce.cloudUsd > 0, JSON.stringify(commerce));
  assert.ok(commerce.items.includes('PRD-031'));
  assert.ok(s.rows.find((r) => r.valueStream === 'Rewards')?.agentUsd > 0, 'PRD-030 is Rewards');
  const digital = s.portfolios.find((p) => p.name === 'Digital');
  assert.equal(digital.budgetUsd, 5000);
  assert.match(digital.text, /^\$[\d,.]+ of \$5,000 this month/);
  assert.match(s.unplaced.text, /spend this month is on no item or environment the factory can place|Everything spent this month is placed/);
  // Platform · Settings shows the portfolio's budget with its spend.
  const settings = (await stevie.json('/api/v1/platform/settings')).body.portfolioBudgets;
  assert.deepEqual(settings.portfolios.find((p) => p.name === 'Digital').monthly, 5000);
});

test('step 4: a Business owner\'s home leads with business cases waiting and spend against budget', async () => {
  const onboarding = (await lerato.json('/api/v1/me/onboarding')).body;
  assert.ok(onboarding.roles.some((r) => r.key === 'business-owner' && r.name === 'Business owner'), 'the onboarding card');
  await env.store.updateDoc(['people', 'lerato-m', 'profile.md'], (doc) => ({ ...doc, data: { ...doc.data, workRole: 'business-owner' } }));
  const home = (await lerato.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(home.layout, 'business-owner');
  assert.deepEqual(home.tiles.map((t) => t.key), ['cases', 'accept', 'epics', 'spend']);
  assert.ok(home.tiles[0].value >= 2);
  assert.equal(home.tiles[3].label, 'Digital this month');
  assert.match(home.tiles[3].note, /^of \$5,000 · agent \$[\d,.]+, cloud \$[\d,.]+$/);
  const cases = home.panels.lists.find((l) => l.key === 'cases').rows.map((r) => r.id);
  assert.ok(cases.includes('EPIC-001') && cases.includes('IDEA-018'), cases.join(', '));
  assert.ok(!cases.includes(ideaId), 'its business case is complete');
  assert.match(home.panels.lists.find((l) => l.key === 'spend').rows.find((r) => r.id === 'Digital').text, /of \$5,000 this month/);
  assert.match(home.summary, /business cases? needs? you/);
});
