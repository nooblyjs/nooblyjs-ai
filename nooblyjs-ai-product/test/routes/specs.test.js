// The Spec screen's data for PRD-031 (product.md §5.2). The content is the mockup's sample data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let t;
before(async () => {
  t = await startApp({ seed: true });
});
after(() => t.close());

const getSpec = (id, as = 'stevie') => t.get(`/product/api/v1/specs/${id}`, { as });

test('PRD-031 has its header: status, product, portfolio and value stream, and authorship', async () => {
  const { status, json: spec } = await getSpec('PRD-031');
  assert.equal(status, 200);
  assert.equal(spec.title, 'Same-day delivery slots');
  assert.equal(spec.status, 'in-review');
  assert.deepEqual([spec.product, spec.portfolio, spec.valueStream], ['Delivery', 'Digital', 'Digital Commerce']);
  assert.equal(spec.authorship.text, 'Drafted by Ada Quill · edited by Lerato M. · v4');
  assert.deepEqual(spec.authorship.draftedBy, { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' });
});

test('the ETag names the version, for If-Match in P2', async () => {
  const res = await fetch(`${t.base}/product/api/v1/specs/PRD-031`, { headers: { 'x-dev-person': 'stevie' } });
  assert.equal(res.headers.get('etag'), '"PRD-031@4"');
});

test('the body comes back as its parts', async () => {
  const { json: spec } = await getSpec('PRD-031');
  assert.match(spec.problem, /^Customers who shop after work .* abandoned there\.$/);
  assert.deepEqual(spec.goals, [
    { measure: 'Same-day slots still open at 12:00', today: '18%', target: '45%' },
    { measure: 'Basket abandonment at slot step', today: '31%', target: '20%' },
    { measure: 'Slot list load time, p95', today: '1.8 s', target: '300 ms' },
  ]);
  assert.equal(spec.stories.length, 3);
  assert.deepEqual(spec.acceptanceCriteria[1], {
    given: 'two customers pick the last slot',
    when: 'both confirm',
    then: 'exactly one hold succeeds and the other sees the next slot.',
  });
  assert.equal(spec.outOfScope, 'Dynamic slot pricing, courier partner integration, and changes to click-and-collect.');
  assert.equal(spec.rolloutPlan, null);
});

test('"Where this is" marks the review step as yours when you are the waiting reviewer', async () => {
  const mine = (await getSpec('PRD-031', 'stevie')).json;
  assert.deepEqual(mine.tracker.map((s) => [s.label, s.state]), [
    ['Signal clustered', 'done'], ['Spec drafted', 'done'], ['Product review — you', 'current'],
    ['Architecture', 'next'], ['UX & UI design', 'next'], ['Software Factory', 'next'],
  ]);
  const theirs = (await getSpec('PRD-031', 'thabo-n')).json;
  assert.equal(theirs.tracker[2].label, 'Product review');
});

test('readiness is 6 of 7, with one agent action for the gap', async () => {
  const { json: spec } = await getSpec('PRD-031');
  assert.equal(spec.readiness.text, '6 of 7');
  const failing = spec.readiness.checks.filter((c) => !c.passed);
  assert.deepEqual(failing, [{ key: 'rollout-plan', passed: false, text: 'Rollout plan missing', action: { label: 'Ask Ada to draft rollout', draft: 'rollout-plan' } }]);
  assert.ok(spec.readiness.checks.filter((c) => c.passed).every((c) => !c.action));
  assert.equal(spec.readiness.checks[0].text, 'Problem backed by evidence');
});

test('linked knowledge is typed', async () => {
  const { json: spec } = await getSpec('PRD-031');
  assert.deepEqual(spec.knowledge.map((k) => [k.title, k.text]), [
    ['Slot capacity model', 'Runbook · delivery-planner'],
    ['ADR-013 · Event-driven slot release', 'Architecture decision · accepted'],
    ['September support themes', 'Customer insight · 412 tickets'],
  ]);
});

test('reviewers have names, status in words, and "you"', async () => {
  const { json: spec } = await getSpec('PRD-031', 'stevie');
  assert.deepEqual(spec.reviewers.map((r) => [r.name, r.role, r.statusText, r.you]), [
    ['Lerato M.', 'Product lead', 'Approved', false],
    ['Stevie', 'Engineering', 'Waiting', true],
  ]);
  assert.equal(spec.statusText, 'Needs your approval');
  assert.equal((await getSpec('PRD-031', 'naledi-k')).json.statusText, '1 of 2 reviewers approved');
});

test('agent cost so far comes from the drafting jobs', async () => {
  const { json: spec } = await getSpec('PRD-031');
  assert.deepEqual(spec.agentCost, { usd: 7.4, research: 1, drafts: 4, text: 'Agent cost so far $7.40 · Research + 4 drafts' });
});

test('a spec awaiting a brief has no content, readiness or authorship yet', async () => {
  const { json: spec } = await getSpec('PRD-030');
  assert.equal(spec.statusText, 'Awaiting your brief');
  assert.equal(spec.readiness, null);
  assert.equal(spec.authorship.text, 'Not drafted yet');
  assert.equal(spec.problem, '');
  assert.equal(spec.agentCost.text, 'No agent work yet');
});

test('versions list v1–v4, oldest first, with who made each', async () => {
  const { json } = await t.get('/product/api/v1/specs/PRD-031/versions', { as: 'naledi-k' });
  assert.deepEqual(json.versions.map((v) => [v.version, v.by.name, v.current]), [
    [1, 'Ada Quill', false], [2, 'Lerato M.', false], [3, 'Ada Quill', false], [4, 'Lerato M.', true],
  ]);
  const none = (await t.get('/product/api/v1/specs/PRD-030/versions', { as: 'naledi-k' })).json;
  assert.deepEqual(none.versions, []);
});

test('the spec list filters by status, product and portfolio', async () => {
  const all = (await t.get('/product/api/v1/specs', { as: 'naledi-k' })).json.specs;
  assert.deepEqual(all.map((s) => s.id), ['PRD-032', 'PRD-031', 'PRD-030', 'PRD-029', 'PRD-027', 'PRD-025']);
  const review = (await t.get('/product/api/v1/specs?status=in-review', { as: 'naledi-k' })).json.specs;
  assert.deepEqual(review.map((s) => s.id), ['PRD-031', 'PRD-029']);
  const checkout = (await t.get('/product/api/v1/specs?product=checkout', { as: 'naledi-k' })).json.specs;
  assert.deepEqual(checkout.map((s) => s.id), ['PRD-032', 'PRD-029']);
  const digital = (await t.get('/product/api/v1/specs?portfolio=digital', { as: 'naledi-k' })).json.specs;
  assert.ok(digital.length === all.length && digital.every((s) => s.portfolio === 'Digital'));
  assert.deepEqual((await t.get('/product/api/v1/specs?portfolio=buying', { as: 'naledi-k' })).json.specs, []);
});

test('an unknown or malformed spec id is a 404', async () => {
  for (const id of ['PRD-999', 'prd-031', 'PRD-031.md', 'seed']) {
    const res = await getSpec(id);
    assert.equal(res.status, 404, id);
    assert.equal(res.json.error.code, 'not_found', id);
  }
});
