// Phase 16e in the real app (root roadmap Phase 16e test script): STORY-031-1, signed off by the 16d script, is built
// by the Software Factory's line. Its pull request is a lifecycle item: its evidence lists the required tests by test
// case id, an engineer gives the Build approval or asks for changes (the line repairs it), a tester gives the Test
// approval or sends it back, a new commit clears both, and a person merges it after both. The story then passes Test and
// its feature goes to Release while PRD-031's other feature is still being built. The steps run in order on one data
// folder, with the Factory hosted and its scheduler running the scripted agent on the demo repository.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
const lifecycle = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const AGENT = { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' };
const RUN_MS = { ms: 60_000, every: 250 };

/** STORY-031-1's pull request as the Pull requests page lists it. */
const listed = async (c = lerato) => (await c.json(`${factory}/pull-requests`)).body.pullRequests.find((r) => r.story?.id === 'STORY-031-1');
const page = async (id, c = lerato) => (await c.json(`${factory}/pull-requests/${id}`)).body;
const decide = (c, id, json) => post(c, `${factory}/pull-requests/${id}/decision`, json);
const openOf = (d, type) => d.approvals.find((a) => a.type === type && a.status === 'open');
/** Waits until the pull request's commit has a Build approval waiting (the line delivered it and its checks passed). */
async function delivered(prId, { not = null } = {}) {
  let d;
  await eventually(async () => {
    d = await page(prId);
    assert.ok(d.pr && !d.pr.checking && d.pr.sha !== not && openOf(d, 'build-approval'), `${prId}: ${JSON.stringify(d.pr?.evidence?.text ?? d.pr ?? d)}`);
  }, RUN_MS);
  return d;
}
const demoRepo = () => path.join(env.dataDir, 'factory', 'repos', 'web-storefront');
const git = (...args) => spawnSync('git', ['-c', 'user.name=Priya S.', '-c', 'user.email=priya-s@noobly.invalid', ...args], { cwd: demoRepo(), encoding: 'utf8' });

let prId;

before(async () => {
  env = await startApp({ hostedApps: [{ package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true }] });
  [stevie, lerato, thabo, priya, naledi] = [env.client(), env.client(), env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [lerato, 'lerato-m'], [thabo, 'thabo-n'], [priya, 'priya-s'], [naledi, 'naledi-k']]) await c.signIn(id);
  // The 16c script, in short: PRD-031 into Design, its design drafted, ADR-014 accepted, STORY-031-1 and -2 handed off.
  await post(stevie, `${lifecycle}/approvals/apr_prd031spec/decision`, { decision: 'approve', override: { reason: 'The rollout plan follows in the pilot review' } });
  for (const part of ['requirements', 'solution', 'functional', 'stories']) assert.equal((await post(priya, `${design}/items/PRD-031/draft/${part}`)).status, 200, part);
  await post(thabo, `${lifecycle}/approvals/apr_adr014/decision`, { decision: 'approve' });
  for (const story of ['STORY-031-1', 'STORY-031-2']) assert.equal((await post(thabo, `${design}/items/PRD-031/stories/${story}/handoff`, {})).status, 200, story);
  // The 16d script, in short: STORY-031-1's architecture drawn and accepted, its test analysis ready, signed off.
  for (const name of ['web-storefront', 'slots-api', 'stores-service']) {
    assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/draft`)).status, 200, name);
    assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/accept`)).status, 200, name);
  }
  const analysis = await (await post(priya, `${quality}/stories/STORY-031-1/draft`)).json();
  for (const c of analysis.cases) assert.equal((await post(priya, `${quality}/stories/STORY-031-1/cases/${c.id}/ready`)).status, 200, c.id);
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-1/sign-off`, {})).status, 200);
  // PRD-031's other feature is being built: STORY-031-2 signed off too (its work item has nobody to build it here).
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-2/sign-off`, { override: { reason: 'Its architecture follows STORY-031-1\'s' } })).status, 200);
  // Naledi is the Delivery squad's tester: Stevie makes her an Approver (she gets sign-off-tests), and she onboards.
  assert.equal((await stevie.request('/api/v1/platform/members/naledi-k', { method: 'PATCH', json: { accessRole: 'Approver', reason: 'Naledi tests the Delivery squad\'s pull requests' } })).status, 200);
  assert.equal((await post(naledi, '/api/v1/me/onboarding', { workRole: 'test-analyst', teams: ['delivery-squad'] })).status, 200);
});
after(async () => { await env?.stop(); });

test('step 1: the run delivers a pull request for STORY-031-1; its evidence says "9 of 10 required tests present (TC-031-1-4 missing)"', async () => {
  await eventually(async () => assert.ok(await listed()), RUN_MS);
  prId = (await listed()).id;
  assert.equal(prId, 'PR-031-1-1');
  const d = await delivered(prId);
  assert.equal(d.pr.evidence.text, '9 of 10 required tests present (TC-031-1-4 missing)');
  assert.deepEqual(d.pr.evidence.missing, ['TC-031-1-4']);
  assert.equal(d.pr.gates, 'passed');
  assert.deepEqual(d.pr.evidence.manual.map((c) => c.id), ['TC-031-1-11']);
  assert.ok(d.pr.evidence.cases.find((c) => c.id === 'TC-031-1-1').found[0].startsWith('test/stores-same-day-capacity.test.js:'));
  assert.equal(d.item.stage, 'build');
  const build = openOf(d, 'build-approval');
  assert.ok(build.reviewers.some((r) => r.id === 'lerato-m' && r.status === 'waiting'), 'its Build approval waits on Lerato');
  // Home · Approvals shows it to Lerato, with the evidence and a link to the pull request's page.
  const mine = (await lerato.json(`${lifecycle}/approvals/${build.id}`)).body;
  assert.match(JSON.stringify(mine), /9 of 10 required tests present \(TC-031-1-4 missing\)/);
  assert.match(JSON.stringify(mine), /\/factory\/pull-requests\/PR-031-1-1/);
  // The PR's evidence in the Factory says so too.
  const prFile = fs.readdirSync(path.join(env.dataDir, 'factory', 'forge'), { recursive: true }).map(String).find((f) => /prs\/.+\.md$/.test(f));
  assert.match(fs.readFileSync(path.join(env.dataDir, 'factory', 'forge', prFile), 'utf8'), /## Required tests \(from the test analysis\)[\s\S]*TC-031-1-4 \| contract[\s\S]*⛔ missing/);
  // Nothing merges yet.
  const merge = await post(lerato, `${factory}/pull-requests/${prId}/merge`);
  assert.deepEqual([merge.status, (await merge.json()).error.code], [422, 'not_mergeable']);
});

test('step 2: Lerato asks for changes naming TC-031-1-4; the line repairs it (10 of 10); her Build approval moves it to Test, and it can\'t merge yet', async () => {
  const before = (await page(prId)).pr.sha;
  const asked = await decide(lerato, prId, { approval: 'build', decision: 'request-changes', reason: 'TC-031-1-4 is missing: add the API gateway → Slot API contract test' });
  assert.equal(asked.status, 200);
  assert.equal((await asked.json()).outcome, 'changes-requested');
  const d = await delivered(prId, { not: before });
  assert.equal(d.pr.evidence.text, '10 of 10 required tests present, all passing');
  assert.equal(d.approvals.find((a) => a.type === 'build-approval' && a.status === 'changes-requested').reviewers[0].reason, 'TC-031-1-4 is missing: add the API gateway → Slot API contract test');
  // The repair had Lerato's words as its brief.
  const run = (await stevie.json('/api/v1/home/items/STORY-031-1/runs')).body.runs[0];
  const log = env.noobly.hosted.apps.find((a) => a.name === 'factory').internals.store;
  assert.ok(log.read({ stream: `run:${run.id}`, types: ['pr.changes_requested'] }).some((e) => /^Lerato M\. asked for changes at the Build approval: TC-031-1-4 is missing/.test(e.data.body)));
  const given = await decide(lerato, prId, { approval: 'build', decision: 'approve' });
  assert.equal(given.status, 200);
  const after = await page(prId);
  assert.equal(after.item.stage, 'test');
  assert.ok(openOf(after, 'test-approval'), 'its Test approval waits');
  assert.equal((await lerato.json(`${lifecycle}/items/STORY-031-1`)).body.item.stage, 'test', 'the story follows its pull request');
  const merge = await post(lerato, `${factory}/pull-requests/${prId}/merge`);
  assert.equal(merge.status, 422);
  assert.match((await merge.json()).error.message, /it needs the Test approval/);
});

test('step 3: Naledi sends it back with a reason (in Build again); after the repair and Lerato\'s approval, she gives the Test approval: it can merge', async () => {
  const before = (await page(prId)).pr.sha;
  const back = await decide(naledi, prId, { approval: 'test', decision: 'request-changes', reason: 'TC-031-1-9 doesn\'t check that a store disappears once its last slot is taken' });
  assert.equal(back.status, 200);
  assert.equal((await page(prId)).item.stage, 'build');
  const d = await delivered(prId, { not: before });
  assert.equal(d.pr.evidence.text, '10 of 10 required tests present, all passing');
  assert.equal(d.item.stage, 'build');
  assert.equal((await decide(lerato, prId, { approval: 'build', decision: 'approve' })).status, 200);
  const ok = await decide(naledi, prId, { approval: 'test', decision: 'approve' });
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).text, /may merge now/);
  const ready = await page(prId, naledi);
  assert.equal(ready.can.merge, true);
  assert.deepEqual(ready.given.map((g) => [g.label, g.byName, g.forName]), [['Build approval', 'Lerato M.', null], ['Test approval', 'Naledi K.', null]]);
});

test('step 6: a commit pushed to the approved pull request clears both approvals; the Factory checks it again', async () => {
  const before = await page(prId);
  assert.equal(git('checkout', '-q', before.pr.head).status, 0);
  fs.appendFileSync(path.join(demoRepo(), 'README.md'), '\nSame-day capacity: see stores-same-day-capacity.js.\n');
  git('add', 'README.md');
  assert.equal(git('commit', '-q', '-m', 'Say where same-day capacity is worked out').status, 0);
  const pushed = git('rev-parse', 'HEAD').stdout.trim();
  assert.equal(git('checkout', '-q', 'main').status, 0);
  const now = await page(prId); // reading it notices the commit
  assert.equal(now.pr.sha, pushed);
  // Both approvals given on the approved commit are cleared (a Build approval from before step 3's repair was already).
  assert.deepEqual(now.approvals.filter((a) => a.status === 'cleared' && a.sha === before.pr.sha).map((a) => a.type).sort(), ['build-approval', 'test-approval']);
  assert.deepEqual(now.given, []);
  assert.equal(now.item.stage, 'build');
  assert.equal(now.can.merge, false);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.equal(audit.filter((r) => r.action === 'approval.cleared' && r.itemId === prId && /was pushed/.test(r.reason)).length, 2);
  });
  const d = await delivered(prId, { not: before.pr.sha });
  assert.equal(d.pr.sha, pushed, 'checked again at the pushed commit');
  assert.equal(d.pr.evidence.text, '10 of 10 required tests present, all passing');
});

test('step 4: an agent is refused both approvals, and audited; Lerato gives both, the Test approval on Naledi\'s behalf', async () => {
  const services = env.noobly.lifecycle.services;
  const build = openOf(await page(prId), 'build-approval');
  await assert.rejects(services.decideApproval({ approvalId: build.id, decision: 'approve', actor: AGENT }), { code: 'people_only' });
  assert.equal((await decide(lerato, prId, { approval: 'build', decision: 'approve' })).status, 200);
  const testApproval = openOf(await page(prId), 'test-approval');
  await assert.rejects(services.decideApproval({ approvalId: testApproval.id, decision: 'approve', actor: AGENT }), { code: 'people_only' });
  // Lerato is waited on too (she has sign-off-tests): she says whom she gives it for.
  const forNaledi = await decide(lerato, prId, { approval: 'test', decision: 'approve', for: 'naledi-k' });
  assert.equal(forNaledi.status, 200);
  assert.match((await forNaledi.json()).text, /^Approved for Naledi K\./);
  const d = await page(prId);
  assert.deepEqual(d.given.map((g) => [g.label, g.byName, g.forName]), [['Build approval', 'Lerato M.', null], ['Test approval', 'Lerato M.', 'Naledi K.']]);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.equal(audit.filter((r) => r.action === 'access.refused' && r.actor === 'ada-quill').length, 2);
    assert.ok(audit.some((r) => r.action === 'approval.on_behalf' && r.actor === 'lerato-m' && r.for === 'naledi-k' && r.target === testApproval.id));
  });
  // The Test approvals page says who gave it and for whom.
  const { given } = (await naledi.json(`${factory}/test/approvals`)).body;
  assert.equal(given.find((a) => a.id === testApproval.id).decidedFor, 'Naledi K.');
});

test('the merge, and step 5: STORY-031-1 passes Test, and its feature is in Release while PRD-031\'s other feature is still being built', async () => {
  // A Contributor can't merge; Lerato (merge) can.
  assert.equal((await post(priya, `${factory}/pull-requests/${prId}/merge`)).status, 403);
  const merged = await post(lerato, `${factory}/pull-requests/${prId}/merge`);
  assert.equal(merged.status, 200, await merged.clone().text());
  assert.match((await merged.json()).text, /^web-storefront PR-031-1-1 is merged into main/);
  assert.ok(fs.existsSync(path.join(demoRepo(), 'stores-same-day-capacity.js')), 'main has the change');
  assert.match(git('log', '-1', '--format=%an %s').stdout, /^Lerato M\. Merge factory\//);
  const story = (await lerato.json(`${lifecycle}/items/STORY-031-1`)).body.item;
  assert.equal(story.stage, 'release');
  assert.ok(story.passedTest, 'it passed Test');
  assert.deepEqual(story.passedTest.notBuiltHere.map((w) => w.repo).sort(), ['slots-api', 'stores-service']);
  const prd = (await lerato.json(`${lifecycle}/items/PRD-031`)).body.item;
  const features = Object.fromEntries(prd.features.map((f) => [f.id, f]));
  assert.equal(features['FEAT-031-1'].stage, 'release');
  assert.equal(features['FEAT-031-1'].text, 'In Release: all its stories passed Test');
  assert.equal(features['FEAT-031-2'].stage, 'build');
  assert.equal(prd.stage, 'design', 'PRD-031 waits on its stories still in Design');
  await eventually(async () => {
    const events = await today(env.store, 'events');
    assert.ok(events.some((e) => e.type === 'feature.in_release' && e.payload.featureId === 'FEAT-031-1'));
    assert.ok(events.some((e) => e.type === 'pr.merged' && e.payload.pullRequestId === prId && e.payload.mergedBy === 'Lerato M.'));
  });
});
