// Phase 22 in the real app (root roadmap Phase 22 test script): STORY-031-1 is built, approved and merged (as in Phase
// 16e), so its feature FEAT-031-1 is in Release while PRD-031's other feature is still in Build. Its release "Slots 1.0"
// carries the evidence (tests, scans, approvals, SBOM), the release agent's notes, a rollout and a rollback. The seed's
// open high finding holds the deploy approval until an Owner accepts its risk; one approval isn't enough, the second
// deploys a 10% pilot through Infrastructure (the mock deployer), and Activity shows each step; the rollback returns
// Production to what it ran, with the reason; applying to prod without a release is refused and audited. The Factory,
// Digital Teammates, Infrastructure, Security and Operations are hosted.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let thabo;
let priya;
let naledi;
const design = '/factory/design/api/v1';
const factory = '/factory/api/v1';
const quality = '/factory/quality/api/v1';
const infra = '/infrastructure/api/v1';
const security = '/security/api/v1';
const ops = '/operations/api/v1';
const lifecycle = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const RUN_MS = { ms: 120_000, every: 250 };
const PR = 'PR-031-1-1';
const release = async (c = stevie) => (await c.json(`${ops}/releases/REL-001`)).body;
const events = async (type) => (await today(env.store, 'events')).filter((e) => e.type === type);

before(async () => {
  process.env.INFRA_MOCK_STEP_MS = '0';
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0' },
    hostedApps: [
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
      { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: true },
      { package: 'nooblyjs-ai-security', mountPath: '/security', enabled: true },
      { package: 'nooblyjs-ai-operations', mountPath: '/operations', enabled: true },
    ],
  });
  [stevie, lerato, thabo, priya, naledi] = [env.client(), env.client(), env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [thabo, 'thabo-n'], [priya, 'priya-s'], [naledi, 'naledi-k']]) await c.signIn(id);
  // The 16c–16e scripts, in short.
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
  // STORY-031-1's pull request: delivered, its Build and Test approvals given, merged.
  await eventually(async () => {
    const p = (await lerato.json(`${factory}/pull-requests/${PR}`)).body;
    assert.ok(p.pr && !p.pr.checking && p.approvals?.some((a) => a.type === 'build-approval' && a.status === 'open'), JSON.stringify(p.pr?.evidence?.text ?? p.error ?? null));
  }, RUN_MS);
  const build = await post(lerato, `${factory}/pull-requests/${PR}/decision`, { approval: 'build', decision: 'approve' });
  assert.equal(build.status, 200, await build.clone().text());
  const tested = await post(naledi, `${factory}/pull-requests/${PR}/decision`, { approval: 'test', decision: 'approve', override: { reason: 'TC-031-1-4 follows in the slots-api pull request' } });
  assert.equal(tested.status, 200, await tested.clone().text());
  const merged = await post(lerato, `${factory}/pull-requests/${PR}/merge`);
  assert.equal(merged.status, 200, await merged.clone().text());
});
after(async () => {
  await env?.stop();
  delete process.env.INFRA_MOCK_STEP_MS;
});

test('step 1: "Slots 1.0" releases FEAT-031-1 while PRD-031\'s other feature is still in Build; its evidence lists tests, scans and approvals', async () => {
  const features = (await stevie.json(`${lifecycle}/items/PRD-031`)).body.item.features;
  assert.deepEqual(features.map((f) => [f.id, f.stage]).slice(0, 2), [['FEAT-031-1', 'release'], ['FEAT-031-2', 'build']]);
  // The other feature can't be released yet.
  const early = await post(priya, `${ops}/releases`, { itemId: 'PRD-031', featureId: 'FEAT-031-2' });
  assert.deepEqual([early.status, (await early.json()).error.code], [409, 'feature_not_ready']);
  const made = await post(priya, `${ops}/releases`, { itemId: 'PRD-031', featureId: 'FEAT-031-1', version: '1.0.0' });
  assert.equal(made.status, 201, await made.clone().text());
  const r = await made.json();
  assert.deepEqual([r.id, r.name, r.version, r.product, r.production, r.status], ['REL-001', 'Slots 1.0', '1.0.0', 'slots', 'prod', 'draft']);
  assert.deepEqual(r.evidence.approvals.map((a) => [a.label, a.by]), [['Build approval', 'Lerato M.'], ['Test approval', 'Naledi K.']]);
  assert.equal(r.evidence.pullRequests[0].mergedBy, 'Lerato M.');
  assert.equal(r.evidence.tests.stories[0].storyId, 'STORY-031-1');
  assert.ok(r.evidence.tests.stories[0].latestRun, 'its latest Build-level run');
  assert.ok(r.evidence.findings.open.some((f) => f.id === 'FND-001' && f.severity === 'high'), 'the seed\'s open high finding');
  assert.ok(r.evidence.sbom.repos.some((s) => s.repo === 'web-storefront'), 'the SBOM of its run');
  assert.match(r.notes.text, /^Slots 1\.0 \(1\.0\.0\) releases /);
  assert.equal(r.rollout.text, '10% pilot, then Everyone');
  assert.equal(r.rollback.text, 'Return prod to web 4.11.2 in one action (the deployer, through Infrastructure).');
});

test('step 4: a release with an open high finding is refused until a risk is accepted', async () => {
  const held = await post(priya, `${ops}/releases/REL-001/approval`);
  assert.equal(held.status, 422);
  const err = (await held.json()).error;
  assert.equal(err.code, 'risk_not_accepted');
  assert.match(err.message, /FND-001 \(High\)/);
  // Thabo (Architect) can't accept a high risk; Stevie (Owner) can.
  assert.equal((await post(thabo, `${security}/findings/FND-001/accept-risk`, { reason: 'x', expiresInDays: 30 })).status, 403);
  assert.equal((await post(stevie, `${security}/findings/FND-001/accept-risk`, { reason: 'The key is escaped in slots-api 0.9.5, in the next release', expiresInDays: 14 })).status, 200);
  const asked = await post(priya, `${ops}/releases/REL-001/approval`);
  assert.equal(asked.status, 200, await asked.clone().text());
  const r = await asked.json();
  assert.equal(r.status, 'waiting-approval');
  assert.match(r.notes.text, /Accepted risks:\n- FND-001 \(High\)/);
});

test('step 2: one approval isn\'t enough; the second deploys a 10% pilot; Activity shows each step', async () => {
  const { approvalId } = await release();
  const approval = (await lerato.json(`${lifecycle}/approvals/${approvalId}`)).body;
  assert.match(JSON.stringify(approval), /REL-001 · Slots 1\.0 1\.0\.0/);
  // Priya (Contributor) has no deploy-production, even deciding on Lerato's behalf: refused, and audited.
  assert.equal((await post(priya, `${lifecycle}/approvals/${approvalId}/decision`, { decision: 'approve', for: 'lerato-m' })).status, 403);
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'access.refused' && a.actor === 'priya-s' && a.permission === 'deploy-production')));
  const first = await post(lerato, `${lifecycle}/approvals/${approvalId}/decision`, { decision: 'approve' });
  assert.equal(first.status, 200, await first.clone().text());
  assert.equal((await first.json()).outcome, 'pending');
  assert.equal((await release()).status, 'waiting-approval', 'one approval is not enough');
  // Lerato can't give the second one too, even for someone else: two different people.
  const again = await post(lerato, `${lifecycle}/approvals/${approvalId}/decision`, { decision: 'approve', for: 'thabo-n' });
  assert.deepEqual([again.status, (await again.json()).error.code], [403, 'already_given']);
  const second = await post(thabo, `${lifecycle}/approvals/${approvalId}/decision`, { decision: 'approve' });
  assert.equal((await second.json()).outcome, 'approved');
  const r = await eventually(async () => { const x = await release(); assert.equal(x.status, 'piloting'); return x; });
  assert.deepEqual([r.percent, r.deployments[0].label, r.deployments[0].by.name], [10, '10% pilot', 'Thabo N.']);
  const prod = (await stevie.json(`${infra}/environments/prod`)).body;
  assert.deepEqual(prod.deployedServices, r.deploys);
  // The feature is in Operate; PRD-031's other feature is still being built.
  assert.equal((await stevie.json(`${lifecycle}/items/STORY-031-1`)).body.item.stage, 'operate');
  // The tag is asked for through the write gate, and recorded (the gate is closed).
  assert.ok(r.writes.some((w) => w.kind === 'bitbucket.tag' && w.target === 'web-storefront' && w.state === 'recorded'), JSON.stringify(r.writes));
  // Activity: each step.
  for (const type of ['release.created', 'release.approval_requested', 'approval.decided', 'environment.deployed', 'release.deployed', 'feature.deployed']) {
    assert.ok((await events(type)).length, type);
  }
  const rows = (await stevie.json('/api/v1/activity?limit=100')).body.rows;
  assert.ok(rows.some((x) => /deployed REL-001 · Slots 1\.0 to prod: 10% pilot/.test(x.action ?? x.text ?? JSON.stringify(x))), 'Activity says the pilot');
});

test('step 3: roll back: Production returns to the previous version and the release says why', async () => {
  assert.equal((await post(priya, `${ops}/releases/REL-001/rollback`, { reason: 'x' })).status, 403);
  const back = await post(lerato, `${ops}/releases/REL-001/rollback`, { reason: 'Slot list p95 doubled in the pilot stores' });
  assert.equal(back.status, 200, await back.clone().text());
  const r = await back.json();
  assert.deepEqual([r.status, r.rolledBack.reason, r.rolledBack.by.name], ['rolled-back', 'Slot list p95 doubled in the pilot stores', 'Lerato M.']);
  const prod = (await stevie.json(`${infra}/environments/prod`)).body;
  assert.deepEqual(prod.deployedServices, [{ service: 'web', version: '4.11.2' }]);
  assert.ok((await events('environment.rolled_back')).some((e) => e.payload.releaseId === 'REL-001'));
});

test('step 5: applying to prod without a release is refused by Infrastructure, and audited', async () => {
  const refused = await post(stevie, `${infra}/environments/prod/deploy`, { deployed: [{ service: 'web', version: '9.9.9' }] });
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).error.code, 'release_only');
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((a) => a.action === 'deploy.refused' && a.actor === 'stevie' && a.target === 'prod')));
  // Nor can a release's deploy be faked: Infrastructure checks the approval itself.
  const svc = env.noobly.hosted.apps.find((a) => a.name === 'infrastructure').services;
  await assert.rejects(svc.deployRelease({ product: 'slots', releaseId: 'REL-999', approvalId: 'apr_nope', deployed: [], percent: 100 }), { code: 'no_release_approval' });
  assert.deepEqual((await stevie.json(`${infra}/environments/prod`)).body.deployedServices, [{ service: 'web', version: '4.11.2' }]);
});
