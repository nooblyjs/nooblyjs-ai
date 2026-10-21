// Phase 18 in the real app (root roadmap Phase 18 test script): PRD-033 (made here: it is not in the seed) gets three
// stakeholders and an interview; Ada drafts four candidate requirements, each quoting the notes; two are accepted, one
// merged into another, one rejected with a reason, and only the accepted ones are in the spec; an agent is refused; the
// NFR walk's two performance answers reach Design as NFRs and quality attributes; an open question holds the spec
// approval until a person overrides it; and meeting notes posted from the Teams simulator become a session. The
// Software Factory (its Product and Design sections) and Digital Teammates are hosted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

const MEETING = 'sim-slot-rollout-sync';
let env;
let stevie;
let lerato;
let priya;
const product = '/product/api/v1';
const design = '/design/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const put = (c, url, json = {}) => c.request(url, { method: 'PUT', json });
const say = (c, text) => post(c, `/api/v1/dev/teams/${MEETING}/messages`, { text });
const press = (c, data) => post(c, `/api/v1/dev/teams/${MEETING}/actions`, { data });
const elicitation = async (c = lerato) => (await c.json(`${product}/elicitation/PRD-033`)).body;
const NOTES = [
  'Interview with the Delivery store manager, 21 October.',
  'Customers need to pick up their order from a locker after 9pm.',
  'Store staff must be able to see which lockers are free.',
  'Customers want a code by text message when the order is in the locker.',
  'The locker screen should load in under two seconds.',
].join('\n');

before(async () => {
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0' },
    hostedApps: [{ package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true }, { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true }, { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true }, { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true }],
  });
  [stevie, lerato, priya] = [env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [priya, 'priya-s']]) await c.signIn(id);
  // PRD-033, a new spec in Delivery.
  const made = await post(lerato, `${product}/specs`, {
    title: 'Click and collect lockers', product: 'Delivery', problem: 'Customers who work late can\'t collect before the store closes.',
    goals: [{ measure: 'Orders collected after 9pm', today: '0%', target: '15%' }], stories: ['As a customer working late, I can collect my order from a locker after 9pm.'],
  });
  assert.equal(made.status, 201);
  assert.equal((await made.json()).id, 'PRD-033');
});
after(async () => { await env?.stop(); });

test('step 1: three stakeholders and an interview; Ada drafts four candidates, each quoting the notes', async () => {
  for (const [name, role] of [['Store managers', 'affected'], ['Lerato M.', 'decides'], ['Locker supplier', 'consulted']]) {
    assert.equal((await post(lerato, `${product}/elicitation/PRD-033/stakeholders`, { name, role })).status, 201, name);
  }
  const session = await post(lerato, `${product}/elicitation/PRD-033/sessions`, { kind: 'interview', title: 'Store manager interview', notes: NOTES });
  assert.equal(session.status, 201);
  assert.equal((await session.json()).id, 'SES-033-1');
  const drafted = await post(lerato, `${product}/elicitation/PRD-033/candidates/draft`);
  assert.equal(drafted.status, 200);
  const { candidates } = await drafted.json();
  assert.equal(candidates.length, 4);
  assert.deepEqual(candidates.map((c) => c.id), ['CAN-033-1', 'CAN-033-2', 'CAN-033-3', 'CAN-033-4']);
  assert.ok(candidates.every((c) => c.quotes.length === 1 && c.quotes[0].session === 'SES-033-1' && NOTES.includes(c.quotes[0].quote)), 'each quotes the notes');
  assert.equal(candidates[3].kind, 'nfr');
  assert.equal(candidates[0].draftedBy.name, 'Ada Quill');
  const e = await elicitation();
  assert.deepEqual(e.stakeholders.map((s) => [s.name, s.role]), [['Store managers', 'affected'], ['Lerato M.', 'decides'], ['Locker supplier', 'consulted']]);
});

test('steps 2 and 3: two accepted, one merged into another, one rejected with a reason; an agent is refused; only the accepted ones are in the spec', async () => {
  // A Contributor can't decide.
  assert.equal((await post(priya, `${product}/elicitation/PRD-033/candidates/CAN-033-1/accept`)).status, 403);
  assert.equal((await post(lerato, `${product}/elicitation/PRD-033/candidates/CAN-033-3/merge`, { into: 'CAN-033-1' })).status, 200);
  const first = await post(lerato, `${product}/elicitation/PRD-033/candidates/CAN-033-1/accept`);
  assert.equal(first.status, 200);
  const r1 = await first.json();
  assert.equal(r1.id, 'REQ-033-01');
  assert.deepEqual(r1.from, ['CAN-033-1', 'CAN-033-3']);
  assert.equal(r1.quotes.length, 2, 'it carries the merged one\'s quote too');
  assert.equal((await post(lerato, `${product}/elicitation/PRD-033/candidates/CAN-033-2/accept`)).status, 200);
  // Step 3: an agent (a fixture actor) tries to accept the last one.
  const services = env.noobly.hosted.apps.find((a) => a.name === 'product').services;
  await assert.rejects(services.decideCandidate({ itemId: 'PRD-033', candidateId: 'CAN-033-4', decision: 'accept', actor: { id: 'ada-quill', name: 'Ada Quill', kind: 'agent', accessRole: 'Owner' } }), { code: 'people_only' });
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'access.refused' && r.actor === 'ada-quill' && /accept a requirement/.test(r.reason))));
  const rejected = await post(lerato, `${product}/elicitation/PRD-033/candidates/CAN-033-4/reject`, { reason: 'Covered by the NFR walk' });
  assert.equal(rejected.status, 200);
  assert.equal((await post(lerato, `${product}/elicitation/PRD-033/candidates/CAN-033-2/reject`, { reason: 'x' })).status, 409, 'decided already');
  const spec = (await lerato.json(`${product}/specs/PRD-033`)).body;
  assert.deepEqual(spec.requirements.map((r) => r.id), ['REQ-033-01', 'REQ-033-02']);
  assert.ok(spec.requirements.every((r) => r.acceptedBy.id === 'lerato-m'));
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'requirement.rejected' && r.candidate === 'CAN-033-4')));
});

test('step 4 (the walk): each category answered or not applicable; the two performance answers are accepted NFRs and quality attributes', async () => {
  const cats = (await lerato.json(`${product}/nfr-catalogue`)).body.categories;
  assert.ok(cats.find((c) => c.key === 'performance').prompt.startsWith('How fast must it be'));
  const perf = await put(lerato, `${product}/elicitation/PRD-033/nfr/performance`, { answers: [
    { text: 'The list of free lockers loads quickly at the evening peak', target: 'p95 < 300 ms at 18:00' },
    { text: 'A locker opens soon after the code is typed', target: 'p95 < 1 s' },
  ] });
  assert.equal(perf.status, 200);
  assert.deepEqual((await perf.json()).requirements.map((r) => r.id), ['REQ-033-03', 'REQ-033-04']);
  for (const c of cats.filter((x) => x.key !== 'performance')) {
    assert.equal((await put(lerato, `${product}/elicitation/PRD-033/nfr/${c.key}`, { notApplicable: true, reason: 'Covered by the platform defaults' })).status, 200, c.key);
  }
  assert.equal((await elicitation()).nfr.text, `${cats.length} of ${cats.length} categories walked`);
  const qa = await services().gatesFor('PRD-033');
  assert.deepEqual(qa.filter((q) => q.attribute === 'Performance').map((q) => q.target), ['p95 < 300 ms at 18:00', 'p95 < 1 s']);
  assert.ok(qa.some((q) => q.scenario.endsWith('(REQ-033-03)')));
});
const services = () => env.noobly.hosted.apps.find((a) => a.name === 'product').services;

test('step 5: an open question holds the spec approval, naming it; an override with a reason is allowed and audited; Design gets the NFRs', async () => {
  assert.equal((await post(lerato, `${product}/elicitation/PRD-033/questions`, { text: 'Which stores get lockers first?', owner: 'lerato-m' })).status, 201);
  assert.equal((await post(lerato, `${product}/specs/PRD-033/review`)).status < 300, true);
  const { id } = (await env.noobly.lifecycle.services.approvals({ type: 'spec' })).find((a) => a.itemId === 'PRD-033' && a.status === 'open');
  const refused = await post(stevie, `/workflows/api/v1/approvals/${id}/decision`, { decision: 'approve', for: 'thabo-n' });
  assert.equal(refused.status, 422, `${id} ${await refused.clone().text()}`);
  const err = (await refused.json()).error;
  assert.equal(err.code, 'readiness_failed');
  assert.match(err.message, /A question is still open: Q-033-1 "Which stores get lockers first\?" \(owner lerato-m\)/);
  const ok = await post(stevie, `/workflows/api/v1/approvals/${id}/decision`, { decision: 'approve', for: 'thabo-n', override: { reason: 'The pilot stores are picked next week' } });
  assert.equal(ok.status, 200, await ok.clone().text());
  const both = await post(stevie, `/workflows/api/v1/approvals/${id}/decision`, { decision: 'approve', for: 'lerato-m', override: { reason: 'The pilot stores are picked next week' } });
  assert.equal((await both.json()).item.stage, 'design');
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'readiness.overridden' && r.target === 'PRD-033' && r.failing.includes('questions-answered'))));
  // Step 4's end: in Design, the solution draft's NFRs carry the two performance answers.
  for (const part of ['requirements', 'solution']) assert.equal((await post(priya, `${design}/items/PRD-033/draft/${part}`)).status, 200, part);
  const nfrs = (await priya.json(`${design}/items/PRD-033`)).body.nfrs;
  assert.ok(nfrs.some((n) => /REQ-033-03/.test(`${n.requirement} ${n.source?.text ?? ''}`) && n.target === 'p95 < 300 ms at 18:00'), JSON.stringify(nfrs));
  assert.ok(nfrs.some((n) => /REQ-033-04/.test(`${n.requirement} ${n.source?.text ?? ''}`)));
});

test('step 6: meeting notes posted from the Teams simulator to PRD-033 appear as an elicitation session', async () => {
  assert.equal((await (await press(stevie, { noobly: 'add', teammateId: 'ada-quill' })).json()).did, 'added');
  await say(lerato, 'Customers should get a reminder before the locker is emptied.');
  const res = await say(lerato, '@NooblyJS post meeting notes to PRD-033');
  assert.equal(res.status, 201);
  await eventually(async () => {
    const e = await elicitation();
    const s = e.sessions.find((x) => x.source === 'teams');
    assert.ok(s, JSON.stringify(e.sessions.map((x) => x.id)));
    assert.deepEqual([s.id, s.kind], ['SES-033-2', 'meeting']);
    assert.match(s.notes, /Customers should get a reminder before the locker is emptied/);
  });
});

test('the Business analyst: the onboarding card, and a home of candidates to decide, open questions, specs with no session and walks to finish', async () => {
  const onboarding = (await priya.json('/api/v1/me/onboarding')).body;
  assert.ok(onboarding.roles.some((r) => r.key === 'business-analyst' && r.name === 'Business analyst'), 'the onboarding card');
  await env.store.updateDoc(['people', 'priya-s', 'profile.md'], (doc) => ({ ...doc, data: { ...doc.data, workRole: 'business-analyst' } }));
  // One more candidate, from the Teams session, for her to decide.
  await post(lerato, `${product}/elicitation/PRD-033/candidates/draft`);
  const home = (await priya.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(home.layout, 'business-analyst');
  assert.deepEqual(home.tiles.map((t) => t.key), ['candidates', 'no-session', 'questions', 'nfr']);
  assert.ok(home.tiles[0].value >= 1, JSON.stringify(home.tiles));
  assert.equal(home.tiles[2].value, 1, 'Q-033-1');
  assert.deepEqual(home.panels.lists.find((l) => l.key === 'questions').rows.map((r) => r.id), ['PRD-033']);
  assert.ok(home.panels.lists.find((l) => l.key === 'candidates').rows.some((r) => r.id === 'PRD-033'));
  assert.ok(!home.panels.side.find((l) => l.key === 'no-session').rows.some((r) => r.id === 'PRD-033'), 'it has sessions');
  assert.ok(!home.panels.side.find((l) => l.key === 'nfr').rows.some((r) => r.id === 'PRD-033'), 'its walk is finished');
  assert.match(home.summary, /candidate requirements? waits? for your decision/);
});
