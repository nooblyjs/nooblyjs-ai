// Phase 21 in the real app (root roadmap Phase 21 test script): STORY-031-1's pull request (built by the line, as in
// Phase 16e) gets a preview environment where its suites run (e2e smoke, accessibility, DAST); the DAST finding is
// Security's, linked to the pull request and its story; the tester gives the Test approval from the evidence in one
// list; the merge destroys the preview. test-slots tests STORY-031-2, whose hold test fails (Phase 20): "41 of 42 e2e ·
// 1 failing", and promotion to Staging is refused naming it; once STORY-031-2's next run passes it, the suites pass,
// the load suite reports p95 against the 300 ms target, and promotion is allowed. The Software Factory, Digital
// Teammates, Infrastructure (the mock provisioner) and Security (the mock scanner) are hosted.
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
const infra = '/infrastructure/api/v1';
const security = '/security/api/v1';
const lifecycle = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const RUN_MS = { ms: 120_000, every: 250 };
const PR = 'PR-031-1-1';
const PREVIEW = 'pr-031-1-1';
const qualityServices = () => env.noobly.hosted.apps.find((a) => a.name === 'factory').provides.quality;
const page = async (c = naledi) => (await c.json(`${factory}/pull-requests/${PR}`)).body;
const decide = (c, json) => post(c, `${factory}/pull-requests/${PR}/decision`, json);

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
    ],
  });
  [stevie, lerato, thabo, priya, naledi] = [env.client(), env.client(), env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [thabo, 'thabo-n'], [priya, 'priya-s'], [naledi, 'naledi-k']]) await c.signIn(id);
  // The 16c–16e scripts, in short: PRD-031's stories handed off; STORY-031-1 and -2 analysed and signed off.
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
  // STORY-031-1's pull request is delivered; its preview is provisioned and its suites have run.
  await eventually(async () => {
    const p = await page(stevie);
    assert.ok(p.preview?.status === 'live' && p.preview.tests.length, JSON.stringify(p.preview ?? p.error ?? null));
  }, RUN_MS);
  // STORY-031-2's run has failed its hold test at Build (Phase 20).
  await eventually(async () => {
    const [two] = (await stevie.json(`${quality}/test-runs?storyId=STORY-031-2`)).body.testRuns;
    assert.ok(two?.cases?.find((c) => c.id === 'TC-031-2-1')?.status === 'failing', JSON.stringify(two ?? null));
  }, RUN_MS);
});
after(async () => {
  await env?.stop();
  delete process.env.INFRA_MOCK_STEP_MS;
});

test('step 1 (a preview): the pull request gets a preview; e2e smoke runs there; the tester opens it from the pull request', async () => {
  const preview = (await naledi.json(`${infra}/environments/${PREVIEW}`)).body;
  assert.deepEqual([preview.kind, preview.repo, preview.status], ['preview', 'web-storefront', 'live']);
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'environment.preview_opened' && e.payload.pullRequestId === PR && e.payload.itemId === 'STORY-031-1'));
  const [run] = (await naledi.json(`${quality}/environment-runs?prId=${PR}`)).body.testRuns;
  assert.deepEqual([run.environment, run.level, run.runner, run.storyIds], [PREVIEW, 'preview', 'mock', ['STORY-031-1']]);
  assert.deepEqual(run.suites.map((s) => s.suite), ['e2e-smoke', 'accessibility', 'dast']);
  const smoke = run.suites[0];
  assert.ok(smoke.total >= 1 && smoke.passed === smoke.total, JSON.stringify(smoke));
  // The pull request page has the preview's link.
  const p = await page();
  assert.match(p.preview.url, /^https:\/\/pr-031-1-1\.preview\.slots\./);
  assert.equal(p.preview.text, 'pr-031-1-1 is live: verify the pull request there');
});

test('step 4: a DAST finding in the preview is a Security finding linked to the pull request and its story', async () => {
  const found = (await stevie.json(`${security}/findings?repo=web-storefront`)).body.findings.find((f) => f.kind === 'dast');
  assert.ok(found, 'a DAST finding');
  assert.deepEqual([found.subject.prId, found.subject.itemId, found.subject.environment, found.severity], [PR, 'STORY-031-1', PREVIEW, 'medium']);
  assert.match(found.title, /Content-Security-Policy/);
  assert.equal(found.owner, 'priya-s', 'web-storefront\'s owner');
  // Medium is below the level a DAST suite blocks at (high): the suite passes and names it.
  const [run] = (await naledi.json(`${quality}/environment-runs?prId=${PR}`)).body.testRuns;
  const dast = run.suites.find((s) => s.suite === 'dast');
  assert.deepEqual([dast.passed, dast.total, dast.findings], [1, 1, [found.id]]);
  assert.match(dast.text, /mock scanner: not a real scan/);
});

test('step 5: the tester gives the Test approval with the environment results and the AI\'s test evidence in one list', async () => {
  const p = await page();
  const where = new Set(p.evidence.rows.map((r) => r.where));
  assert.ok(where.has('Build · the AI\'s tests') && where.has(`Preview · ${PREVIEW}`) && where.has('A person checks'), [...where].join(', '));
  assert.ok(p.evidence.rows.some((r) => r.id === 'TC-031-1-1'));
  assert.deepEqual(p.evidence.rows.filter((r) => r.where.startsWith('Preview')).map((r) => r.id), ['e2e-smoke', 'accessibility', 'dast']);
  assert.match(p.evidence.text, /with pr-031-1-1\)$/);
  assert.equal((await decide(lerato, { approval: 'build', decision: 'approve' })).status, 200);
  // TC-031-1-4 (the 16e script's missing contract test) still holds the readiness: the tester overrides it, with a reason.
  const given = await decide(naledi, { approval: 'test', decision: 'approve', override: { reason: 'TC-031-1-4 follows in the slots-api pull request; the preview\'s suites pass' } });
  assert.equal(given.status, 200, await given.clone().text());
  assert.match((await given.json()).text, /may merge now/);
});

test('step 1 (the merge): merged, the preview goes', async () => {
  const merged = await post(lerato, `${factory}/pull-requests/${PR}/merge`);
  assert.equal(merged.status, 200, await merged.clone().text());
  // Destroyed: it leaves every list; its record is kept for its history.
  await eventually(async () => assert.equal((await stevie.json(`${infra}/environments/${PREVIEW}`)).body.status, 'destroyed'));
  assert.ok(!(await stevie.json(`${infra}/environments`)).body.environments.some((e) => e.name === PREVIEW));
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'environment.destroyed' && e.payload.environment === PREVIEW && e.payload.reason === `${PR} merged`));
  assert.equal((await page()).preview.text, 'pr-031-1-1 was destroyed when it merged');
});

test('step 2: test-slots shows "41 of 42 e2e · 1 failing", linked to the criterion it proves; promotion to Staging is refused, naming it', async () => {
  const ran = await post(priya, `${infra}/environments/test-slots/tests`, { storyIds: ['STORY-031-2'] });
  assert.equal(ran.status, 201, await ran.clone().text());
  const run = await ran.json();
  const e2e = run.suites.find((s) => s.suite === 'e2e');
  assert.deepEqual([e2e.passed, e2e.total, e2e.text], [41, 42, '41 of 42 e2e · 1 failing']);
  assert.deepEqual(e2e.failing, [{ name: 'TC-031-2-1: The slot returns to the pool within 5 seconds', caseId: 'TC-031-2-1', criterionRef: 'AC-031-2-1' }]);
  const tile = (await stevie.json(`${infra}/promotion-paths/slots`)).body.tiles.find((t) => t.kind === 'test');
  assert.equal(tile.line.text, '41 of 42 e2e · 1 failing');
  // A Contributor can't promote; Stevie (the platform owner) is refused: a test is failing.
  assert.equal((await post(priya, `${infra}/promotion-paths/slots/promote`, { from: 'test' })).status, 403);
  const refused = await post(stevie, `${infra}/promotion-paths/slots/promote`, { from: 'test' });
  assert.equal(refused.status, 422);
  const err = (await refused.json()).error;
  assert.equal(err.code, 'tests_failing');
  assert.equal(err.message, 'Promotion to Staging is refused: a test is failing in test-slots: TC-031-2-1: The slot returns to the pool within 5 seconds (AC-031-2-1).');
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'environment.promotion_refused' && e.payload.from === 'test-slots'));
});

test('step 3: fixed, the run passes and promotion is allowed; the load suite reports p95 against the 300 ms target', async () => {
  // STORY-031-2's next run passes its hold test (recorded as the line records it).
  const q = qualityServices();
  await q.recordGates({ runId: 'run-hold-fix', itemId: 'STORY-031-2', repo: 'web-storefront', sha: 'f1x0000', gates: [{ name: 'test', status: 'passed' }] });
  await q.recordRequired({ runId: 'run-hold-fix', sha: 'f1x0000', requiredTests: { cases: [{ id: 'TC-031-2-1', status: 'passing' }] } });
  const run = await (await post(priya, `${infra}/environments/test-slots/tests`, { storyIds: ['STORY-031-2'] })).json();
  assert.equal(run.status, 'passed', JSON.stringify(run.suites));
  assert.equal(run.suites.find((s) => s.suite === 'e2e').text, '42 of 42 e2e');
  assert.match(run.suites.find((s) => s.suite === 'load').text, /^p95 240 ms against the 300 ms target/);
  assert.match(run.suites.find((s) => s.suite === 'image').text, /no image to scan/);
  const promoted = await post(stevie, `${infra}/promotion-paths/slots/promote`, { from: 'test' });
  assert.equal(promoted.status, 200, await promoted.clone().text());
  const body = await promoted.json();
  assert.deepEqual([body.from, body.to], ['test-slots', 'staging']);
  const staging = (await stevie.json(`${infra}/environments/staging`)).body;
  assert.deepEqual(staging.deployedServices.map((d) => `${d.service} ${d.version}`), ['api 0.9.4', 'web 4.12.0']);
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'environment.promoted' && e.payload.to === 'staging'));
  // Production only through a release.
  assert.equal((await (await post(stevie, `${infra}/promotion-paths/slots/promote`, { from: 'staging' })).json()).error.code, 'release_only');
});
