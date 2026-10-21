// Phase 20 in the real app (root roadmap Phase 20 test script): PRD-031's three stories past Design, STORY-031-1 built by
// the line (its run passes) and STORY-031-2 built by a scripted agent whose own test for TC-031-2-1 fails. Each verify is
// a test run recorded against the story's cases and requirements; Coverage reads across STORY-031-1 to -3 in words; a
// criterion changed in Design marks its test cases for review; a defect raised from the failing run is a lifecycle item
// linked to the requirement and story it breaks; and the tester's home shows coverage gaps and the defect. The Software
// Factory and Digital Teammates are hosted, and the Factory's scheduler runs the scripted agents on the demo repository.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let thabo;
let priya;
let naledi;
const design = '/factory/design/api/v1';
const factory = '/factory/api/v1';
const quality = '/factory/quality/api/v1';
const lifecycle = '/workflows/api/v1';
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const patch = (c, url, json = {}) => c.request(url, { method: 'PATCH', json });
const RUN_MS = { ms: 120_000, every: 250 };
const AGENT = { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' };
const runsOf = async (storyId) => (await stevie.json(`${quality}/test-runs?storyId=${storyId}`)).body.testRuns;
const coverage = async () => (await stevie.json(`${quality}/coverage/PRD-031`)).body;
const services = () => env.noobly.hosted.apps.find((a) => a.name === 'factory').provides.quality;
function find(node, id, path = []) {
  if (node.id === id) return [...path, node.id];
  for (const child of node.children) {
    const found = find(child, id, [...path, node.id]);
    if (found) return found;
  }
  return null;
}

before(async () => {
  env = await startApp({ env: { CHAT_MOCK_REPLY_MS: '0' }, hostedApps: [{ package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true }, { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true }] });
  [stevie, thabo, priya, naledi] = [env.client(), env.client(), env.client(), env.client()];
  for (const [c, id] of [[stevie, 'stevie'], [thabo, 'thabo-n'], [priya, 'priya-s'], [naledi, 'naledi-k']]) await c.signIn(id);
  // The 16c script, in short: PRD-031 into Design, its design drafted, ADR-014 accepted, its three stories handed off.
  await post(stevie, `${lifecycle}/approvals/apr_prd031spec/decision`, { decision: 'approve', override: { reason: 'The rollout plan follows in the pilot review' } });
  for (const part of ['requirements', 'solution', 'functional', 'stories']) assert.equal((await post(priya, `${design}/items/PRD-031/draft/${part}`)).status, 200, part);
  await post(thabo, `${lifecycle}/approvals/apr_adr014/decision`, { decision: 'approve' });
  for (const story of ['STORY-031-1', 'STORY-031-2', 'STORY-031-3']) assert.equal((await post(thabo, `${design}/items/PRD-031/stories/${story}/handoff`, {})).status, 200, story);
  // The 16d script, in short: STORY-031-1's architecture accepted, every case ready, signed off; STORY-031-2's test
  // analysis ready and signed off with a reason; STORY-031-3's analysis drafted, its criterion's case ready.
  for (const name of ['web-storefront', 'slots-api', 'stores-service']) {
    assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/draft`)).status, 200, name);
    assert.equal((await post(thabo, `${factory}/engineering/architecture/STORY-031-1/systems/${name}/accept`)).status, 200, name);
  }
  for (const story of ['STORY-031-1', 'STORY-031-2', 'STORY-031-3']) {
    const analysis = await (await post(priya, `${quality}/stories/${story}/draft`)).json();
    for (const c of analysis.cases.filter((x) => story !== 'STORY-031-3' || x.criterion === 0)) assert.equal((await post(priya, `${quality}/stories/${story}/cases/${c.id}/ready`)).status, 200, c.id);
  }
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-1/sign-off`, {})).status, 200);
  assert.equal((await post(thabo, `${factory}/engineering/STORY-031-2/sign-off`, { override: { reason: 'Its architecture follows STORY-031-1\'s' } })).status, 200);
  // Naledi is the Delivery squad's tester.
  assert.equal((await stevie.request('/api/v1/platform/members/naledi-k', { method: 'PATCH', json: { accessRole: 'Approver', reason: 'Naledi tests the Delivery squad\'s pull requests' } })).status, 200);
  assert.equal((await post(naledi, '/api/v1/me/onboarding', { workRole: 'test-analyst', teams: ['delivery-squad'] })).status, 200);
  // Both runs are verified and delivered: STORY-031-1's passes, STORY-031-2's fails TC-031-2-1.
  await eventually(async () => {
    const [one] = await runsOf('STORY-031-1');
    assert.ok(one?.status === 'passed' && one.cases.find((c) => c.id === 'TC-031-1-1')?.status === 'passing', JSON.stringify(one?.cases?.slice(0, 2)));
  }, RUN_MS);
  await eventually(async () => {
    const [two] = await runsOf('STORY-031-2');
    assert.ok(two?.status === 'failed' && two.cases.find((c) => c.id === 'TC-031-2-1')?.status === 'failing', JSON.stringify(two ?? null));
  }, RUN_MS);
});
after(async () => { await env?.stop(); });

test('test runs: each verify is recorded against the story\'s cases and requirements; a failing run names its failures', async () => {
  const [one] = await runsOf('STORY-031-1');
  assert.match(one.id, /^TRN-031-1-\d+$/);
  assert.deepEqual([one.level, one.environment, one.repo, one.itemId], ['build', 'Pull request branch', 'web-storefront', 'PRD-031']);
  assert.ok(one.requirements.includes('BR-031-01'));
  assert.equal(one.cases.find((c) => c.id === 'TC-031-1-1').criterionRef, 'AC-031-1-1');
  assert.equal(one.cases.find((c) => c.id === 'TC-031-1-4').status, 'missing', 'the 16e script\'s missing contract test');
  const [two] = await runsOf('STORY-031-2');
  assert.deepEqual(two.requirements, ['BR-031-05']);
  assert.ok(two.failures.some((f) => /^test: TC-031-2-1: the slot returns to the pool within 5 seconds/.test(f)), JSON.stringify(two.failures));
  // The Factory's Test runs page lists them before the sample.
  const page = (await naledi.json(`${factory}/test/runs`)).body;
  assert.ok(page.recorded >= 2);
  assert.ok(page.runs[0].recorded && page.runs.at(-1).sample);
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'test_run.recorded' && e.payload.itemId === 'STORY-031-2'));
});

test('step 1: PRD-031 · Coverage reads across STORY-031-1 to -3 in words', async () => {
  const c = await coverage();
  assert.deepEqual(c.stories.map((s) => s.id), ['STORY-031-1', 'STORY-031-2', 'STORY-031-3']);
  assert.equal(c.text, '1 of 3 criteria have a passing test (Build), across STORY-031-1 to -3');
  assert.equal(c.detail, '3 with a ready test case · 2 with an automated test · 1 with a passing test');
  assert.deepEqual(c.stories.map((s) => s.text), ['1 of 1 criterion has a passing test (Build)', '0 of 1 criterion have a passing test (Build)', '0 of 1 criterion have a passing test (Build)']);
  assert.deepEqual(c.features.map((f) => [f.id, f.stories]), [['FEAT-031-1', ['STORY-031-1']], ['FEAT-031-2', ['STORY-031-2']], ['FEAT-031-3', ['STORY-031-3']]]);
  assert.equal(c.stories[0].rows[0].ref, 'AC-031-1-1');
  // The Coverage page has it.
  const page = (await naledi.json(`${factory}/test/coverage`)).body;
  assert.ok(page.items.some((i) => i.itemId === 'PRD-031' && i.text === c.text));
});

test('step 2: a criterion changed in Design marks its test cases for review; a person marks them ready again', async () => {
  // An agent can't change a criterion; a reason is needed.
  assert.equal((await patch(priya, `${design}/items/PRD-031/stories/STORY-031-1/criteria/1`, { text: 'x' })).status, 400);
  const changed = await patch(priya, `${design}/items/PRD-031/stories/STORY-031-1/criteria/1`, {
    text: 'Given two customers pick the last slot, when both confirm within 50 ms, then exactly one hold succeeds and the other sees the next slot.',
    reason: 'The pilot showed both confirming within 50 ms',
  });
  assert.equal(changed.status, 200, await changed.clone().text());
  const view = (await priya.json(`${quality}/stories/STORY-031-1`)).body;
  const flagged = view.cases.filter((c) => c.criterionChanged);
  assert.deepEqual(flagged.map((c) => c.id), ['TC-031-1-1']);
  assert.match(flagged[0].criterionChanged.from, /^Given two customers pick the last slot, when both confirm, then/);
  assert.equal(view.summary.changedText, '1 test case has a changed criterion: TC-031-1-1');
  assert.equal(view.criteria[0].ready, false);
  await eventually(async () => assert.ok((await today(env.store, 'events')).some((e) => e.type === 'quality.cases_flagged' && e.payload.storyId === 'STORY-031-1' && e.payload.cases.includes('TC-031-1-1'))));
  assert.equal((await coverage()).stories[0].rows[0].ready, false, 'not ready while its criterion changed');
  // In Build only a flagged case may change: another one is refused.
  assert.equal((await post(priya, `${quality}/stories/STORY-031-1/cases/TC-031-1-2/ready`)).status, 409);
  assert.equal((await post(priya, `${quality}/stories/STORY-031-1/cases/TC-031-1-1/ready`)).status, 200);
  const after = (await priya.json(`${quality}/stories/STORY-031-1`)).body;
  assert.deepEqual([after.cases.filter((c) => c.criterionChanged).length, after.criteria[0].ready], [0, true]);
});

test('step 3: a defect raised from the failing run appears in Lifecycle, linked to BR-031-05 and STORY-031-2', async () => {
  const [two] = await runsOf('STORY-031-2');
  const raised = await post(priya, `${factory}/test/runs/${two.id}/defects`, { severity: 'S2' });
  assert.equal(raised.status, 201, await raised.clone().text());
  const d = await raised.json();
  assert.equal(d.id, 'DEF-031-1');
  assert.equal(d.title, 'TC-031-2-1 fails: The slot returns to the pool within 5 seconds');
  assert.deepEqual([d.severityLabel, d.state, d.storyId], ['S2 Major', 'open', 'STORY-031-2']);
  assert.deepEqual(d.breaks, { story: 'STORY-031-2', requirements: ['BR-031-05'], criterion: 'AC-031-2-1' });
  assert.equal(d.breaksText, 'Breaks STORY-031-2 · BR-031-05 · AC-031-2-1');
  // In Lifecycle: an item of its own, under its story, which lists it.
  const item = (await stevie.json(`${lifecycle}/items/DEF-031-1`)).body.item;
  assert.deepEqual([item.type, item.stage, item.parent.id, item.defect.foundIn.testRunId], ['defect', 'build', 'STORY-031-2', two.id]);
  const story = (await stevie.json(`${lifecycle}/items/STORY-031-2`)).body.item;
  assert.deepEqual(story.defects.rows.map((x) => x.id), ['DEF-031-1']);
  assert.equal((await stevie.json(`${quality}/test-runs/${two.id}`)).body.defects[0], 'DEF-031-1');
  // In the item's trace: under the requirement, the story and the criterion it breaks.
  const t = (await stevie.json('/api/v1/home/items/PRD-031/trace')).body;
  assert.deepEqual(find(t.root, 'DEF-031-1'), ['PRD-031', 'BR-031-05', 'STORY-031-2', 'AC-031-2-1', 'DEF-031-1'], 'under the criterion it breaks');
  // A defect doesn't move through the stages.
  const moved = await post(stevie, `${lifecycle}/items/DEF-031-1/advance`, {});
  assert.deepEqual([moved.status, (await moved.json()).error.code], [422, 'per_defect']);
  // An agent can't close or reject it (refused and audited); a person needs a reason to reject it.
  await assert.rejects(services().decideDefect({ defectId: 'DEF-031-1', decision: 'reject', reason: 'x', actor: AGENT }), { code: 'people_only' });
  await eventually(async () => assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'access.refused' && r.actor === 'ada-quill')));
  assert.equal((await post(priya, `${factory}/test/defects/DEF-031-1/decision`, { decision: 'reject' })).status, 400);
  assert.equal((await post(priya, `${factory}/test/defects/DEF-031-1/decision`, { decision: 'close' })).status, 409, 'not fixed yet');
  // The Defects page lists it before the sample.
  const page = (await naledi.json(`${factory}/test/defects`)).body;
  assert.equal(page.defects[0].id, 'DEF-031-1');
  assert.ok((await today(env.store, 'events')).some((e) => e.type === 'defect.raised' && e.payload.itemId === 'DEF-031-1' && e.payload.parentId === 'STORY-031-2'));
});

test('the tester\'s home: coverage gaps and open defects', async () => {
  const home = (await naledi.json('/api/v1/home/for-you?scope=all')).body;
  assert.equal(home.layout, 'test-analyst');
  const tile = (k) => home.tiles.find((x) => x.key === k);
  assert.equal(tile('defects').value, 1);
  assert.ok(tile('gaps').value >= 1, JSON.stringify(tile('gaps')));
  assert.deepEqual(home.panels.lists.find((l) => l.key === 'defects').rows.map((r) => r.id), ['DEF-031-1']);
  assert.ok(home.panels.lists.find((l) => l.key === 'gaps').rows.some((r) => r.id === 'STORY-031-2'));
});

test('a passing run of the story marks the defect fixed; a person closes it', async () => {
  // A later passing run (recorded as the line would) passes TC-031-2-1: the proof.
  const q = services();
  const passed = await q.recordGates({ runId: 'run-later', itemId: 'STORY-031-2', repo: 'web-storefront', sha: 'abc1234', gates: [{ name: 'test', status: 'passed' }] });
  await q.recordRequired({ runId: 'run-later', sha: 'abc1234', requiredTests: { cases: [{ id: 'TC-031-2-1', status: 'passing' }] } });
  const fixed = (await stevie.json(`${quality}/defects/DEF-031-1`)).body;
  assert.deepEqual([fixed.state, fixed.fixedBy.testRunId], ['fixed', passed.id]);
  const closed = await post(naledi, `${factory}/test/defects/DEF-031-1/decision`, { decision: 'close' });
  assert.equal(closed.status, 200, await closed.clone().text());
  assert.equal((await closed.json()).state, 'closed');
  assert.equal((await stevie.json(`${lifecycle}/items/DEF-031-1`)).body.item.status, 'completed');
});
