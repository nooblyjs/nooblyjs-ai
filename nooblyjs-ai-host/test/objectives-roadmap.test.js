// Phase 25b in the real app (root roadmap Phase 25b test script): Lerato sets OBJ-04 "More same-day orders" in Now with
// a key result read from the monitor, and PRD-031 serves it; PRD-031's card says why it is there; the roadmap made from
// the items shows PRD-031 in Now and the Delivery squad over-planned (its capacity from Teams & roles); Lerato moves
// PRD-027 to Next and PRD-025 to Later, which clears it; a saved view's page is read-only; once Slots 1.0 is released
// (the Phase 22 script, in short) the roadmap shows it and Design's features with their dependencies; the outcome
// review moves the key result and the objective is behind; Metrics shows the Product reports. Product, Design, the
// Factory, Teammates, Infrastructure, Security, Operations and Knowledge are hosted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let thabo;
let priya;
let naledi;
const design = '/design/api/v1';
const factory = '/factory/api/v1';
const quality = '/factory/quality/api/v1';
const security = '/security/api/v1';
const ops = '/operations/api/v1';
const product = '/product/api/v1';
const lifecycle = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const put = (c, url, json = {}) => c.request(url, { method: 'PUT', json });
const RUN_MS = { ms: 120_000, every: 250 };
const PR = 'PR-031-1-1';
const delivery = (r) => r.capacity.find((c) => c.team.id === 'delivery-squad');

before(async () => {
  process.env.INFRA_MOCK_STEP_MS = '0';
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0' },
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true },
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
      { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true },
      { package: 'nooblyjs-ai-security', mountPath: '/security', enabled: true },
      { package: 'nooblyjs-ai-operations', mountPath: '/operations', enabled: true },
      { package: 'nooblyjs-ai-knowledge', mountPath: '/wiki', enabled: true },
    ],
  });
  [stevie, lerato, thabo, priya, naledi] = [env.client(), env.client(), env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [thabo, 'thabo-n'], [priya, 'priya-s'], [naledi, 'naledi-k']]) await c.signIn(id);
});
after(async () => {
  await env?.stop();
  delete process.env.INFRA_MOCK_STEP_MS;
});

test('team capacity: the seed\'s sample people-days on Teams & roles; an Owner changes them, nobody else', async () => {
  const { teams } = (await naledi.json('/api/v1/home/teams')).body;
  assert.deepEqual(teams.map((t) => [t.id, t.capacityDays]), [['checkout-squad', 40], ['delivery-squad', 50], ['platform-team', 30]]);
  assert.equal((await lerato.request('/api/v1/home/teams/platform-team', { method: 'PATCH', json: { capacityDays: 35 } })).status, 403);
  const set = await stevie.request('/api/v1/home/teams/platform-team', { method: 'PATCH', json: { capacityDays: 35 } });
  assert.equal(set.status, 200, await set.clone().text());
  assert.equal((await set.json()).capacityText, '35 people-days in Now');
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'team.capacity_set' && a.target === 'platform-team')));
});

test('step 1: Lerato sets OBJ-04 in Now with a key result read from the monitor; PRD-031 serves it', async () => {
  const made = await post(lerato, `${product}/objectives`, { title: 'More same-day orders', horizon: 'now', themes: ['Solve the every day'], links: ['PRD-031'] });
  assert.equal(made.status, 201, await made.clone().text());
  assert.equal((await made.json()).id, 'OBJ-04');
  const kr = await post(lerato, `${product}/objectives/OBJ-04/key-results`, { measure: 'Same-day slots still open at 12:00', start: '18%', target: '45%', source: 'monitor' });
  assert.equal(kr.status, 201, await kr.clone().text());
  const k = (await kr.json()).keyResults[0];
  // The mock monitor: halfway from where it started to its target, until it's told otherwise.
  assert.deepEqual([k.now, k.statusText], ['31.5%', 'On the way']);
});

test('step 2: the board orders by RICE; PRD-031\'s card says it serves OBJ-04 (Now) and who asked', async () => {
  for (const name of ['Store manager, Sandton', 'Store manager, Rosebank', 'Store manager, Durbanville']) {
    const note = await (await post(priya, `${product}/feedback/notes`, { text: 'Same-day slots sell out before 10:00.', product: 'Delivery', from: { name } })).json();
    assert.equal((await post(lerato, `${product}/feedback/notes/${note.id}/insights`, { target: 'PRD-031', importance: 'important' })).status, 201);
  }
  const cards = (await lerato.json(`${product}/board`)).body.columns.flatMap((c) => c.cards);
  assert.equal(cards.find((c) => c.id === 'PRD-031').why, 'serves OBJ-04 (Now) · 3 colleagues asked');
  assert.deepEqual(cards.filter((c) => c.kind === 'idea').map((c) => c.id), ['IDEA-018', 'IDEA-019', 'IDEA-020']);
});

test('steps 3 and 4: the roadmap in Now; the Delivery squad over-planned; PRD-027 to Next, PRD-025 to Later; a read-only saved view', async () => {
  let r = (await naledi.json(`${product}/roadmap`)).body;
  assert.ok(r.lanes.flatMap((l) => l.columns.now).some((i) => i.id === 'PRD-031' && i.team?.name === 'Delivery squad' && i.objective?.id === 'OBJ-04'));
  assert.equal(delivery(r).text, 'Delivery squad: 64 of 50 days planned in Now, 14 over');
  assert.equal((await put(lerato, `${product}/roadmap/items/PRD-027`, { horizon: 'next' })).status, 200);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'roadmap.moved' && a.target === 'PRD-027' && a.to === 'next')));
  r = (await naledi.json(`${product}/roadmap`)).body;
  assert.equal(delivery(r).text, 'Delivery squad: 54 of 50 days planned in Now, 4 over');
  assert.equal((await put(lerato, `${product}/roadmap/items/PRD-025`, { horizon: 'later' })).status, 200);
  r = (await naledi.json(`${product}/roadmap`)).body;
  assert.deepEqual([delivery(r).text, delivery(r).over], ['Delivery squad: 30 of 50 days planned in Now', false]);
  const saved = await (await post(lerato, `${product}/roadmap/views`, { name: 'Delivery by objective', groupBy: 'objective', filter: { team: 'delivery-squad' } })).json();
  const page = (await naledi.json(`${product}/roadmap/views/${saved.id}`)).body;
  assert.ok(page.roadmap.lanes.flatMap((l) => l.columns.next).some((i) => i.id === 'PRD-027'));
  // A Viewer can read it, not change it.
  assert.equal((await put(naledi, `${product}/roadmap/items/PRD-031`, { horizon: 'next' })).status, 403);
});

test('steps 3 and 5: once Slots 1.0 is out, the roadmap shows it and Design\'s features; the outcome review puts the key result behind', async () => {
  // The 16c–22 scripts, in short (as Phase 23's test).
  await post(stevie, `${lifecycle}/approvals/apr_prd031spec/decision`, { decision: 'approve', override: { reason: 'The rollout plan follows in the pilot review' } });
  for (const part of ['requirements', 'solution', 'functional', 'stories']) assert.equal((await post(priya, `${design}/items/PRD-031/draft/${part}`)).status, 200, part);
  await post(thabo, `${lifecycle}/approvals/apr_adr014/decision`, { decision: 'approve' });
  for (const story of ['STORY-031-1', 'STORY-031-2']) assert.equal((await post(thabo, `${design}/items/PRD-031/stories/${story}/handoff`, {})).status, 200, story);
  for (const name of ['web-storefront', 'slots-api', 'stores-service']) {
    assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/draft`)).status, 200, name);
    assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/accept`)).status, 200, name);
  }
  for (const story of ['STORY-031-1', 'STORY-031-2']) {
    const analysis = await (await post(priya, `${quality}/stories/${story}/draft`)).json();
    for (const c of analysis.cases) assert.equal((await post(priya, `${quality}/stories/${story}/cases/${c.id}/ready`)).status, 200, c.id);
  }
  assert.equal((await stevie.request('/api/v1/platform/members/naledi-k', { method: 'PATCH', json: { accessRole: 'Approver', reason: 'Naledi tests the Delivery squad\'s pull requests' } })).status, 200);
  assert.equal((await post(naledi, '/api/v1/me/onboarding', { workRole: 'test-analyst', teams: ['delivery-squad'] })).status, 200);
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-1/sign-off`, {})).status, 200);
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-2/sign-off`, { override: { reason: 'Its architecture follows STORY-031-1\'s' } })).status, 200);
  await eventually(async () => {
    const p = (await lerato.json(`${factory}/pull-requests/${PR}`)).body;
    assert.ok(p.pr && !p.pr.checking && p.approvals?.some((a) => a.type === 'build-approval' && a.status === 'open'), JSON.stringify(p.pr?.evidence?.text ?? p.error ?? null));
  }, RUN_MS);
  assert.equal((await post(lerato, `${factory}/pull-requests/${PR}/decision`, { approval: 'build', decision: 'approve' })).status, 200);
  assert.equal((await post(naledi, `${factory}/pull-requests/${PR}/decision`, { approval: 'test', decision: 'approve', override: { reason: 'TC-031-1-4 follows in the slots-api pull request' } })).status, 200);
  assert.equal((await post(lerato, `${factory}/pull-requests/${PR}/merge`)).status, 200);
  assert.equal((await post(priya, `${ops}/releases`, { itemId: 'PRD-031', featureId: 'FEAT-031-1', version: '1.0.0' })).status, 201);
  assert.equal((await post(stevie, `${security}/findings/FND-001/accept-risk`, { reason: 'The key is escaped in slots-api 0.9.5', expiresInDays: 90 })).status, 200);
  const asked = await (await post(priya, `${ops}/releases/REL-001/approval`)).json();
  for (const c of [lerato, thabo]) assert.equal((await post(c, `${lifecycle}/approvals/${asked.approvalId}/decision`, { decision: 'approve' })).status, 200);
  await eventually(async () => assert.equal((await lerato.json(`${ops}/releases/REL-001`)).body.status, 'piloting'));

  // Step 3, the rest: PRD-031 in Now with Slots 1.0 and Design's features with what each depends on.
  const r = (await lerato.json(`${product}/roadmap`)).body;
  const prd031 = r.lanes.flatMap((l) => l.columns.now).find((i) => i.id === 'PRD-031');
  assert.match(prd031.release.name, /Slots/);
  assert.equal(prd031.release.inProduction, true);
  assert.ok(prd031.features.length >= 2, JSON.stringify(prd031.features));
  assert.ok(prd031.features.every((f) => /^FEAT-031-/.test(f.id) && /^depends on /.test(f.text)));

  // Step 5: the outcome review, 31 days on.
  assert.equal((await post(stevie, '/api/v1/dev/clock', { hours: 31 * 24 })).status, 200);
  const due = await eventually(async () => { const x = (await stevie.json(`${ops}/outcome-reviews/OR-031`)).body; assert.equal(x.status, 'due'); return x; });
  assert.equal((await post(lerato, `${lifecycle}/approvals/${due.approvalId}/decision`, { decision: 'approve' })).status, 200);
  const o = await eventually(async () => {
    const x = (await naledi.json(`${product}/objectives/OBJ-04`)).body;
    assert.equal(x.progressText, '1 of 1 key result behind');
    return x;
  });
  assert.deepEqual([o.keyResults[0].now, o.keyResults[0].statusText], ['31.5%', 'Behind']);
  await post(stevie, '/api/v1/dev/clock', { reset: true });
});

test('step 6: Metrics shows the Product reports: feedback by portfolio, planned days by objective', async () => {
  const m = (await stevie.json('/api/v1/home/metrics')).body;
  assert.deepEqual(m.product.feedback.byPortfolio, [{ label: 'Digital', count: 3 }]);
  assert.ok(m.product.plannedDays.byObjective.some((x) => x.label === 'OBJ-04 More same-day orders' && x.days === 30), JSON.stringify(m.product.plannedDays));
  assert.ok(m.product.keyResults.some((k) => k.keyResult === 'KR-04-1' && k.statusText === 'Behind'));
});
