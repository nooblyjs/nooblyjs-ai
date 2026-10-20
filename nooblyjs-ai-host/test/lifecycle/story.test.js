// The NooblyJS Phase 2 test script, at the API: the seeded PRD-031 story on a stand-in host whose clock starts at the
// story's "now" (Friday 2026-10-09 10:00 UTC). Steps run in order and share the data folder. The story is in lifecycle
// v3's eight stages (Phase 16b; rebuilt 2026-10-20, BUG-006), and any person but a Viewer may give an approval on
// behalf of someone it waits on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { ANCHOR } from '../../src/lifecycle/seed/index.js';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.js';

let dir;
let server;
let base;
let stand;
let hosted;
const productCalls = [];

async function call(person, method, url, body) {
  const res = await fetch(`${base}/workflows/api/v1${url}`, {
    method,
    headers: { [PERSON_HEADER]: person, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}
const get = (person, url) => call(person, 'GET', url);
const post = (person, url, body = {}) => call(person, 'POST', url, body);
const events = (type) => stand.eventLog.filter((e) => e.type === type);
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-lifecycle-'));
  stand = createHost({
    dataDir: dir,
    now: ANCHOR,
    // The Product Factory's readiness facts for its specs; it knows nothing about PRD-028.
    services: { product: { readinessFacts: async (itemId) => (productCalls.push(itemId), null) } },
  });
  const app = express();
  app.use(express.json());
  hosted = await register(app, createTestServerManager(), { dataDir: dir, host: stand.host, sweepEveryMs: 0 });
  await hosted.seed();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await hosted?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dir, { recursive: true, force: true });
});

test('it is API only: no UI, a services object, and nothing outside its API', async () => {
  assert.equal(hosted.ui, undefined);
  assert.equal(hosted.mountPath, '/workflows');
  for (const name of ['decide', 'sendBack', 'handoff', 'item', 'waitingFor', 'counts', 'sweep']) assert.equal(typeof hosted.services[name], 'function', name);
  assert.equal((await fetch(`${base}/workflows/api/v1/overview`)).status, 401, 'signed in only');
  assert.equal((await get('stevie', '/nope')).status, 404);
});

test('step 1: Overview counts the seed: 12 in flight, the eight-stage strip, 4 waiting on Stevie', async () => {
  const { body } = await get('stevie', '/overview');
  assert.equal(body.inFlight, 12);
  assert.equal(body.waitingOnYou, 4);
  assert.match(body.summary, /^12 items in flight across 2 systems\. Four are waiting on you\.$/);
  assert.deepEqual(body.stages.map((s) => s.label), ['Discover', 'Product', 'Design', 'Engineer', 'Build', 'Test', 'Release', 'Operate']);
  assert.deepEqual(body.stages.map((s) => s.count), [3, 4, 3, 0, 1, 1, 0, 0]);
  assert.equal(body.stages[1].note, 'specs, UX and UI · 2 in review');
  assert.equal(body.stages[2].note, '2 ADRs proposed · 1 awaiting handoff');
  assert.equal(body.stages[4].note, 'on the line · 1 PR awaiting the Build approval');
  assert.deepEqual(body.waiting.map((w) => w.tag), ['Product', 'ADR', 'Design', 'PR']);
  assert.equal(body.waiting[0].context, 'Drafted by Ada Quill · readiness 6 of 7 checks');
  // Someone else sees their own queue.
  assert.equal((await get('lerato-m', '/overview')).body.waitingOnYou, 1);
});

test('step 2: the PRD-031 Product handoff says 6 of 7, rollout plan missing, Lerato approved, 26 h and due today', async () => {
  const queue = (await get('stevie', '/approvals')).body;
  assert.deepEqual(queue.counts, { mine: 4, others: 2, done: 4 });
  assert.equal(queue.summary, 'Four are waiting on you; the oldest for 26 hours.');
  assert.equal(queue.rows[0].id, 'apr_prd031spec');
  assert.equal(queue.rows[0].age, '26 h');
  assert.equal(queue.rows[0].due.text, 'due today');
  assert.equal(queue.rows[0].line, 'Approve & hand off to Design · from Ada Quill');

  const { approval } = (await get('stevie', '/approvals/apr_prd031spec')).body;
  assert.equal(approval.readiness.passed, 6);
  assert.equal(approval.readiness.total, 7);
  assert.deepEqual(approval.readiness.failing.map((c) => c.text), ['Rollout plan missing']);
  assert.deepEqual(approval.others, { approved: 1, total: 1, names: ['Lerato M.'] });
  assert.equal(approval.cost.usd, 7.4);
  assert.equal(approval.decide.can, true);
  assert.equal(approval.decide.approveLabel, 'Approve & hand off to Design');
  assert.deepEqual([approval.from, approval.to], ['Product', 'Design']);
  assert.ok(productCalls.includes('PRD-031'), 'the Product Factory was asked for the facts first');
});

test('step 3: approving is refused while readiness fails; an override with a reason moves PRD-031 to Design', async () => {
  const refused = await post('stevie', '/approvals/apr_prd031spec/decision', { decision: 'approve' });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'readiness_failed');
  assert.deepEqual(refused.body.error.details.failing.map((f) => f.key), ['rollout-plan']);
  assert.equal((await get('stevie', '/items/PRD-031')).body.item.stage, 'product', 'nothing moved');

  const ok = await post('stevie', '/approvals/apr_prd031spec/decision', { decision: 'approve', comment: 'Go', override: { reason: 'Rollout plan follows in the pilot review' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.outcome, 'approved');
  assert.equal(ok.body.item.stage, 'design');
  assert.equal(ok.body.approval.override.reason, 'Rollout plan follows in the pilot review');

  const decided = events('approval.decided').at(-1);
  assert.equal(decided.actor, 'stevie');
  assert.deepEqual(
    { itemId: decided.payload.itemId, type: decided.payload.type, system: decided.payload.system, decision: decided.payload.decision, outcome: decided.payload.outcome, role: decided.payload.role },
    { itemId: 'PRD-031', type: 'spec', system: 'product', decision: 'approve', outcome: 'approved', role: 'Engineering' },
  );
  const moved = events('item.stage_changed').at(-1);
  assert.deepEqual({ itemId: moved.payload.itemId, from: moved.payload.from, to: moved.payload.to }, { itemId: 'PRD-031', from: 'product', to: 'design' });
  assert.equal(events('readiness.overridden').length, 1);
});

test('step 5: the item file has the new stage, and the audit log has the approval and the override with its reason', async () => {
  const file = await fs.readFile(path.join(dir, 'items', 'PRD-031.md'), 'utf8');
  assert.match(file, /^stage: design$/m);
  assert.match(file, /stage: product\s+enteredAt: \S+\s+by: lerato-m\s+leftAt: /, 'the history closed the Product visit');
  await settle();
  const override = stand.auditLog.find((r) => r.action === 'readiness.overridden');
  assert.equal(override.actor, 'stevie');
  assert.equal(override.reason, 'Rollout plan follows in the pilot review');
  assert.deepEqual(override.failing, ['rollout-plan']);
  const decided = stand.auditLog.find((r) => r.action === 'approval.decided' && r.status === 200);
  assert.deepEqual({ actor: decided.actor, target: decided.target, itemId: decided.itemId, outcome: decided.outcome, override: decided.override }, { actor: 'stevie', target: 'apr_prd031spec', itemId: 'PRD-031', outcome: 'approved', override: 'Rollout plan follows in the pilot review' });
  const refusal = stand.auditLog.find((r) => r.action === 'rule.refused');
  assert.equal(refusal.code, 'readiness_failed');
});

test('step 6: a Viewer cannot accept the ADR, is told why, and the refusal is audited; a Contributor must say for whom', async () => {
  const res = await post('naledi-k', '/approvals/apr_adr014/decision', { decision: 'approve' });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'viewers_cannot_approve');
  assert.match(res.body.error.message, /^Viewers can't approve, for themselves or on anyone's behalf\. Your access role is Viewer\.$/);
  await settle();
  const refusal = stand.auditLog.find((r) => r.actor === 'naledi-k' && r.action === 'access.refused');
  assert.equal(refusal.target, 'approval apr_adr014');
  const detail = (await get('naledi-k', '/approvals/apr_adr014')).body.approval.decide;
  assert.equal(detail.can, false);
  assert.match(detail.cannot, /^Viewers can't approve/);
  // Priya (a Contributor) may decide on someone's behalf (Phase 16b), but ADR-014 waits on two people: she must say whom.
  const which = await post('priya-s', '/approvals/apr_adr014/decision', { decision: 'approve' });
  assert.equal(which.status, 400);
  assert.match(which.body.error.message, /Say whom you are deciding for: this approval is waiting on stevie, thabo-n/);
  assert.equal((await get('stevie', '/approvals/apr_adr014')).body.approval.status, 'open');
});

test('governance: an agent is refused even with an Owner role, and so is a person who is not a reviewer', async () => {
  const agent = await post('ada-quill', '/approvals/apr_adr014/decision', { decision: 'approve' });
  assert.equal(agent.status, 403);
  assert.equal(agent.body.error.code, 'people_only');
  const viaService = await hosted.services.decide({ itemId: 'PRD-029', decision: 'approve', actor: { id: 'ada-quill', kind: 'agent' } }).catch((err) => err);
  assert.equal(viaService.code, 'people_only');
  assert.ok(stand.auditLog.some((r) => r.actor === 'ada-quill' && /agents propose, people decide/.test(r.reason ?? '')));
  // ADR-015 waits on Thabo, not Stevie: Stevie may give it only on Thabo's behalf, and the panel says so.
  const behalf = (await get('stevie', '/approvals/apr_adr015')).body.approval;
  assert.deepEqual([behalf.status, behalf.decide.can, behalf.decide.mine, behalf.decide.for.map((r) => r.id)], ['open', true, false, ['thabo-n']]);
});

test('an ADR needs one architect: Thabo accepts ADR-014 and it leaves Stevie\'s queue; request-changes needs a reason', async () => {
  const noReason = await post('lerato-m', '/approvals/apr_prd029spec/decision', { decision: 'request-changes' });
  assert.equal(noReason.status, 400);
  const res = await post('thabo-n', '/approvals/apr_adr014/decision', { decision: 'approve' });
  assert.equal(res.body.outcome, 'approved');
  assert.equal(res.body.item.stage, 'design', 'an ADR does not move the item');
  assert.equal(events('approval.decided').at(-1).payload.subject, 'ADR-014');
  assert.equal((await get('stevie', '/approvals')).body.counts.mine, 2);
  const again = await post('stevie', '/approvals/apr_adr014/decision', { decision: 'approve' });
  assert.equal(again.status, 409);
});

test('the Design handoff moves PRD-028 to Engineer with nothing built; the Engineering sign-off creates six work items', async () => {
  const design = await post('stevie', '/approvals/apr_slotpickerdesign/decision', { decision: 'approve' });
  assert.equal(design.status, 200);
  assert.deepEqual([design.body.item.stage, design.body.handoff], ['engineer', null]);
  assert.equal(events('handoff.created').length, 0, 'nothing goes to the Software Factory before the Engineering sign-off');
  await assert.rejects(fs.readdir(path.join(dir, 'handoffs')));

  // Thabo (an Architect) holds both places of the sign-off: the Application Architect's and the test lead's.
  const signoff = await post('thabo-n', '/items/PRD-028/advance', {});
  assert.equal(signoff.status, 200);
  assert.equal(signoff.body.approval.type, 'engineering-signoff');
  assert.equal(signoff.body.item.stage, 'build');
  assert.equal(signoff.body.handoff.workItems.length, 6);
  assert.equal(signoff.body.handoff.repoCount, 4);
  const files = await fs.readdir(path.join(dir, 'handoffs'));
  assert.equal(files.length, 1);
  assert.match(await fs.readFile(path.join(dir, 'handoffs', files[0]), 'utf8'), /WI-PRD-028-6/);
  const created = events('handoff.created').at(-1);
  assert.deepEqual([created.payload.from, created.payload.to, created.payload.workItemIds.length], ['engineer', 'build', 6]);
  // The Software Factory reads the work items through the service, by the id the event carries.
  const read = await hosted.services.handoffOf({ handoffId: created.payload.handoffId });
  assert.deepEqual([read.itemId, read.workItems.length, read.workItems[0].status, read.estimate], ['PRD-028', 6, 'new', '$18–$26']);
  assert.equal(await hosted.services.handoffOf({ handoffId: 'hof_nope' }), null);
});

test('the Build approval moves slots-api #482 to Test; the Test approval, to Release, when the pull request may merge', async () => {
  const build = await post('stevie', '/approvals/apr_slotsapi482/decision', { decision: 'approve' });
  assert.equal(build.status, 200);
  assert.deepEqual([build.body.item.stage, build.body.item.status], ['test', 'active']);
  assert.equal((await get('lerato-m', '/items/slots-api-482')).body.actions.advanceLabel, 'Give the Test approval');
  const tested = await post('lerato-m', '/items/slots-api-482/advance', {});
  assert.equal(tested.status, 200);
  assert.deepEqual([tested.body.approval.type, tested.body.approval.subject, tested.body.item.stage], ['test-approval', 'slots-api #482', 'release']);
  assert.equal((await get('stevie', '/overview')).body.inFlight, 12, 'released, not done: it is done after Operate');
});

test('reassign hands the reviewer slot to someone who may approve, and refuses someone who may not', async () => {
  const no = await post('lerato-m', '/approvals/apr_prd029spec/reassign', { to: 'priya-s' });
  assert.equal(no.status, 422);
  assert.equal(no.body.error.code, 'cannot_approve');
  const detail = (await get('lerato-m', '/approvals/apr_prd029spec')).body.approval;
  assert.deepEqual(detail.decide.eligible.map((p) => p.id), [], 'Stevie and Thabo already reviewed it');
});

test('step 7: two working days on, ADR-015 is reminded only, and the PRD-029 spec is reminded then escalated to the Owner', async () => {
  assert.deepEqual(await hosted.services.sweep(), { reminded: [], escalated: [] }, 'nothing is late on the day itself');
  stand.setNow('2026-10-13T10:00:00.000Z'); // Friday + 2 working days = Tuesday
  const done = await hosted.services.sweep();
  assert.deepEqual(done.reminded.sort(), ['apr_adr015', 'apr_prd029spec']);
  assert.deepEqual(done.escalated, ['apr_prd029spec']);
  const order = stand.eventLog.filter((e) => e.payload.approvalId === 'apr_prd029spec' && /reminded|escalated/.test(e.type)).map((e) => e.type);
  assert.deepEqual(order, ['approval.reminded', 'approval.escalated']);
  assert.deepEqual(events('approval.escalated')[0].payload.to, ['stevie']);
  assert.deepEqual(await hosted.services.sweep(), { reminded: [], escalated: [] }, 'once each');

  const adr = (await get('thabo-n', '/approvals/apr_adr015')).body.approval;
  assert.equal(adr.reminders.length, 1);
  assert.equal(adr.escalated, null);
  const spec = (await get('lerato-m', '/approvals/apr_prd029spec')).body.approval;
  assert.deepEqual(spec.escalated.toNames, ['Stevie']);
  assert.ok(stand.auditLog.some((r) => r.actor === 'system' && r.action === 'approval.escalated' && r.target === 'apr_prd029spec'));

  const rows = (await get('stevie', '/items?filter=waiting')).body.rows;
  const late = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(late['PRD-027'].cells.design.state, 'waiting', 'ADR-015 is past its target');
  assert.equal(late['PRD-029'].cells.product.state, 'waiting');
  assert.equal(late['PRD-025'].now, 'Waiting 8 d');
});

test('step 8: PRD-027 goes back to Product with a reason; its ADR approval is withdrawn and Sent back goes up by 1', async () => {
  const before = (await get('stevie', '/flow')).body.sentBack;
  assert.equal((await post('stevie', '/items/PRD-027/send-back', { to: 'product' })).status, 400, 'a reason is required');
  assert.equal((await post('stevie', '/items/PRD-027/send-back', { to: 'engineer', reason: 'x' })).status, 422, 'only to an earlier stage');
  assert.equal((await post('priya-s', '/items/PRD-027/send-back', { to: 'product', reason: 'x' })).status, 403);
  const res = await post('stevie', '/items/PRD-027/send-back', { to: 'product', reason: 'The tracking map needs the courier privacy review first' });
  assert.equal(res.status, 200);
  assert.equal(res.body.item.stage, 'product');
  const sent = events('item.sent_back').at(-1);
  assert.deepEqual({ itemId: sent.payload.itemId, system: sent.payload.system, from: sent.payload.from, to: sent.payload.to }, { itemId: 'PRD-027', system: 'product', from: 'design', to: 'product' });
  assert.equal((await get('thabo-n', '/approvals/apr_adr015')).body.approval.status, 'withdrawn');
  assert.equal((await get('stevie', '/flow')).body.sentBack, before + 1);
  const page = (await get('stevie', '/items/PRD-027')).body;
  assert.match(page.history[0].text, /^Sent back from Design to Product: The tracking map/);
});

test('a person can move an item on when no approval is waiting, and the Product Factory can use the services', async () => {
  const blocked = await post('lerato-m', '/items/PRD-029/advance');
  assert.equal(blocked.status, 409, 'its spec approval is open: decide that');
  const moved = await post('lerato-m', '/items/IDEA-018/advance', { comment: 'Accepted' });
  assert.equal(moved.body.item.stage, 'product');
  const viewer = await post('naledi-k', '/items/IDEA-019/advance');
  assert.deepEqual([viewer.status, viewer.body.error.code], [403, 'viewers_cannot_approve']);

  // Product's Approve on a spec: the open spec approval the person is waiting on.
  const viaProduct = await hosted.services.decide({ itemId: 'PRD-029', decision: 'approve', reason: null, version: 2, actor: { id: 'lerato-m', kind: 'person' } });
  assert.equal(viaProduct.outcome, 'approved');
  assert.equal((await hosted.services.item({ itemId: 'PRD-029' })).stage, 'design');
  // The stage names from before are understood: "specify" is Product.
  const back = await hosted.services.sendBack({ itemId: 'PRD-029', to: 'specify', reason: 'Add the keyboard-only criteria', actor: { id: 'lerato-m', kind: 'person' } });
  assert.equal(back.to, 'product');
  // The Design handoff leaves from Design only.
  const early = await hosted.services.handoff({ itemId: 'PRD-029', workItems: [{ repo: 'slots-api', title: 'x' }], actor: { id: 'stevie', kind: 'person' } }).catch((err) => err);
  assert.equal(early.code, 'wrong_stage');
});

test("asking for a spec review opens the approval, and the item when it is new; agents and Viewers can't ask, and agents never review", async () => {
  const ask = (actor, extra = {}) => hosted.services.requestApproval({ itemId: 'PRD-040', title: 'Smarter substitutions', version: 1, actor, ...extra }).catch((err) => err);
  assert.equal((await ask({ id: 'ada-quill', kind: 'agent' })).code, 'people_only');
  assert.equal((await ask({ id: 'naledi-k', kind: 'person' })).code, 'forbidden');
  assert.equal(await hosted.services.item({ itemId: 'PRD-040' }), null, 'a refused request opens nothing');

  const asked = await ask({ id: 'priya-s', kind: 'person' });
  assert.match(asked.approvalId, /^apr_/);
  // Nobody on a team here, so the Owners review. Ada is an agent with the Owner role in this fixture: never a reviewer.
  assert.deepEqual(asked.reviewers.map((r) => [r.id, r.status]), [['stevie', 'waiting']]);
  assert.ok(asked.dueAt, 'due by the target in the rule');
  const item = await hosted.services.item({ itemId: 'PRD-040' });
  assert.deepEqual([item.stage, item.status, item.owner, item.title], ['product', 'active', 'priya-s', 'Smarter substitutions']);
  assert.ok(events('item.created').some((e) => e.payload.itemId === 'PRD-040'));
  assert.ok(events('approval.requested').some((e) => e.payload.itemId === 'PRD-040' && e.actor === 'priya-s' && e.payload.reviewerIds.includes('stevie')));
  assert.equal((await ask({ id: 'priya-s', kind: 'person' })).code, 'approval_open', 'one spec approval at a time');

  // The reviewer decides it like any other approval. Readiness has no facts here, so Stevie overrides with a reason.
  const decided = await hosted.services.decide({ itemId: 'PRD-040', decision: 'request-changes', reason: 'Name the store pilot', version: 1, actor: { id: 'stevie', kind: 'person' } });
  assert.equal(decided.outcome, 'changes-requested');
  // After changes, it can be asked for again; an item past Product can't.
  assert.match((await ask({ id: 'priya-s', kind: 'person' }, { version: 2 })).approvalId, /^apr_/);
  const late = await hosted.services.requestApproval({ itemId: 'PRD-031', version: 5, actor: { id: 'lerato-m', kind: 'person' } }).catch((err) => err);
  assert.ok(['approval_open', 'wrong_stage'].includes(late.code), late.code);
});

test('nudge reminds whoever an item waits on, once every four hours, and never when nothing waits', async () => {
  const none = await post('lerato-m', '/items/IDEA-019/nudge');
  assert.equal(none.status, 409);
  assert.equal(none.body.error.code, 'nothing_waiting');
  const ok = await post('lerato-m', '/items/PRD-025/nudge');
  assert.equal(ok.status, 200);
  assert.equal(events('item.nudged').at(-1).payload.itemId, 'PRD-025');
  assert.equal((await post('stevie', '/items/PRD-025/nudge')).body.error.code, 'recently_nudged');
  assert.equal((await post('naledi-k', '/items/PRD-025/nudge')).status, 403, 'a Viewer may not');
  assert.equal((await post('ada-quill', '/items/PRD-025/nudge')).body.error.code, 'people_only');
});

test('the snapshot gives a home every item row and open approval, saying who may decide', async () => {
  const snap = await hosted.services.snapshot({ id: 'thabo-n', accessRole: 'Architect' });
  assert.ok(snap.items.length >= 12);
  assert.ok(snap.items.every((i) => 'team' in i && 'status' in i && i.cells));
  assert.equal(snap.stages.length, 8);
  for (const a of snap.approvals) assert.equal(a.canDecide, a.mine, 'an Architect may decide whatever waits on him');
  const naledi = await hosted.services.snapshot({ id: 'naledi-k', accessRole: 'Viewer' });
  assert.ok(naledi.approvals.every((a) => !a.canDecide), 'a Viewer decides nothing');
  const priya = await hosted.services.snapshot({ id: 'priya-s', accessRole: 'Contributor' });
  assert.ok(priya.approvals.every((a) => !a.canDecide));
});

test('the rules table is lifecycle v3\'s, with the app approvals, and the lifecycle page has stage health and where work waits', async () => {
  const { rules } = (await get('naledi-k', '/rules')).body;
  assert.deepEqual(rules.map((r) => [r.decision, r.approver, r.target, r.ifLate]), [
    ['Product → Design (spec, UX and UI)', 'Product lead + Engineering', '1 working day', 'Remind, then escalate'],
    ['New dependency (ADR)', 'Architect', '1 working day', 'Remind'],
    ['Design → Engineering (Design handoff)', 'Solution Architect', '1 working day', 'Remind, then escalate'],
    ['Engineering → Build (Engineering sign-off)', 'Application Architect and a test lead', '1 working day', 'Remind, then escalate'],
    ['Build → Test (Build approval)', 'Engineer (code owner of the repo)', '4 hours', 'Remind'],
    ['Test → Release (Test approval; then the PR may merge)', 'Tester', '4 hours', 'Remind'],
    ['Release → Operate (production deploy)', 'Two approvers', 'Same day', 'Hold deploy'],
    ['Infrastructure design → Test or Staging', 'Platform owner', '1 working day', 'Remind'], // Phase 9a
    ['Write to Jira or Bitbucket', 'Approver', '1 working day', 'Remind'], // Phase 13: a write whose kind needs approval
    ['Operate → done (outcome review)', 'Product lead', '5 working days', 'Remind'], // Phase 16a
    ['Threat model accepted', 'Architect', '1 working day', 'Remind, then escalate'],
    ['Risk acceptance', 'Risk owner', '1 working day', 'Hold the release'],
  ]);
  const life = (await get('stevie', '/items')).body;
  assert.equal(life.stages.length, 8);
  assert.equal(life.stages.filter((s) => s.slowest).length, 1);
  assert.ok(life.rows.every((r) => Object.keys(r.cells).length === 8));
  const flow = (await get('stevie', '/flow')).body;
  assert.ok(flow.gates.length >= 3);
  // The clock is on the next Tuesday by now: the gates of the last 30 days, the Test approval the slowest.
  assert.deepEqual(flow.gates[0].label, 'Test approval');
  assert.ok(['Design handoff', 'Engineering sign-off', 'Build approval'].every((label) => flow.gates.some((g) => g.label === label)));
  assert.ok(flow.handoffs.some((h) => h.label === 'Product → Design'));
});

test('it wrote only inside its own folder', async () => {
  assert.deepEqual((await fs.readdir(dir)).sort(), ['approval-rules.yaml', 'approvals', 'handoffs', 'items', 'readiness.yaml', 'seed.yaml']);
});

test('Phase 11: a handoff with the item\'s repositories refuses a work item outside them, and the handoff keeps the list', async () => {
  // An item of its own in Design (PRD-028 was handed off earlier in this file).
  const seedItem = await fs.readFile(new URL('../../src/lifecycle/seed/data/items/PRD-028.md', import.meta.url), 'utf8');
  await fs.writeFile(path.join(dir, 'items', 'PRD-077.md'), seedItem.replace(/PRD-028/g, 'PRD-077'));
  const send = (workItems) => hosted.services.handoff({
    itemId: 'PRD-077', repositories: ['acme/slots-api', 'acme/web-storefront'], workItems, actor: { id: 'stevie', kind: 'person' },
  }).catch((err) => err);
  const outside = await send([{ repo: 'acme/slots-api', title: 'hold & release endpoints' }, { repo: 'mobile-app', title: 'same four screens' }]);
  assert.deepEqual([outside.code, outside.details], ['outside_repositories', { outside: ['mobile-app'] }]);
  assert.equal((await hosted.services.item({ itemId: 'PRD-077' })).stage, 'design', 'nothing moved');

  const sent = await send([{ repo: 'acme/slots-api', title: 'hold & release endpoints' }, { repo: 'web-storefront', title: 'SlotChip, HoldTimer' }]);
  assert.equal(sent.outcome, 'approved', sent.message);
  assert.equal(sent.item.stage, 'engineer');
  // The work goes to the Software Factory with the Engineering sign-off, and keeps the repositories it was planned for.
  assert.equal((await post('stevie', '/items/PRD-077/advance', {})).body.item.stage, 'build');
  const created = events('handoff.created').find((e) => e.payload.itemId === 'PRD-077');
  const handoff = await hosted.services.handoffOf({ handoffId: created.payload.handoffId });
  assert.deepEqual(handoff.repositories, ['acme/slots-api', 'acme/web-storefront']);
  assert.deepEqual(handoff.workItems.map((w) => w.repo), ['acme/slots-api', 'web-storefront']);
});
