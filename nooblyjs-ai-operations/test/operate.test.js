// Operate and learn (root roadmap Phase 23 on the app on its own): a release's first deploy turns the item's quality
// attributes into SLOs and schedules its outcome review; burning a budget with the mock alerts on call (once per level);
// an incident raises a signal linked to the release, and resolved, the SRE agent's review is drafted, accepted by a
// person and written to Knowledge; follow-ups become ideas; the outcome review opens its approval when due, shows the
// goals against target, and closes when it is approved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { fakes } from './fakes.js';
import { slosFrom } from '../src/services/slos.js';
import { goalMet } from '../src/services/outcomes.js';
import { scriptedReview } from '../src/services/incidents.js';

const API = '/operations/api/v1';
const DAY = 86_400_000;
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; for (;;) { try { return await fn(); } catch (err) { if (Date.now() > end) throw err; await new Promise((r) => setTimeout(r, 10)); } } };
const QA = [
  { attribute: 'Latency', scenario: 'Slot list at 18:00 peak', target: 'p95 < 300 ms' },
  { attribute: 'Consistency', scenario: 'Two holds', target: '0 double-books' },
  { attribute: 'Availability', scenario: 'Cache node lost', target: '99.9% monthly' },
];
const GOALS = [{ measure: 'Same-day slots still open at 12:00', today: '18%', target: '45%' }, { measure: 'Slot list load time, p95', today: '1.8 s', target: '300 ms' }];

function more(f) {
  const calls = f.calls;
  const rec = (name, answer) => async (input) => { calls.push({ name, input }); return typeof answer === 'function' ? answer(input) : answer; };
  f.services.product.designInputs = async () => ({ jiraProject: 'DTE', qualityAttributes: QA, spec: { goals: GOALS } });
  f.services.product.raiseSignal = rec('product.raiseSignal', (i) => ({ id: 'sig_slotlisttimeouts', ...i }));
  f.services.product.createIdea = rec('product.createIdea', () => ({ id: 'IDEA-012', title: 'x' }));
  f.services.knowledge = { writePage: rec('knowledge.writePage', (i) => ({ spaceName: 'Acme Space', path: `${i.folder}/${i.title}.md`, href: '/wiki/#/Acme%20Space/x' })) };
  f.services.oncall = { alert: rec('oncall.alert', () => ({ sent: true, where: 'simulator' })) };
  f.services.workflows.storiesOf = async () => [{ id: 'STORY-031-2', title: 'Hold a slot', stage: 'build', status: 'active' }];
  return f;
}

test('SLOs from quality attributes; goals met or not, either way up or down', () => {
  assert.deepEqual(slosFrom(QA).map((s) => [s.kind, s.budgetMinutes]), [['latency', 432], ['availability', 43.2]]);
  assert.equal(goalMet(GOALS[0], '31.5%'), false);
  assert.equal(goalMet(GOALS[0], '46%'), true);
  assert.equal(goalMet(GOALS[1], '280 ms'), true, 'lower is better, across units');
  assert.equal(goalMet(GOALS[1], '0.4 s'), false);
  assert.equal(goalMet({ measure: 'x', today: 'n/a', target: '?' }, '1'), null);
  assert.match(scriptedReview({ id: 'INC-001', title: 'T', severity: 'SEV2', release: 'REL-001 · Slots 1.0', itemId: 'PRD-031', detail: '', declaredAt: '2026-10-21T10:00:00Z', resolvedAt: '2026-10-21T10:30:00Z', timeline: [{ at: '2026-10-21T10:00:00Z', what: 'declared' }], followUps: [] }), /Release: REL-001 · Slots 1\.0[\s\S]*Open for 30 minutes/);
});

test('in production: SLOs watched, alerts once per level; an incident with its signal, its review, Knowledge and a follow-up; the outcome review', async () => {
  const f = more(fakes());
  let now = Date.parse('2026-10-21T10:00:00Z');
  const t = await startApp({ seed: true, services: f.services, clock: { now: () => now } });
  try {
    // Phase 22, in short: the release goes to its pilot.
    await t.post(`${API}/releases`, { as: 'priya-s', body: { itemId: 'PRD-031', featureId: 'FEAT-031-1' } });
    await t.post(`${API}/releases/REL-001/approval`, { as: 'priya-s' });
    await t.emit('approval.decided', { type: 'deploy', outcome: 'approved', by: 'stevie', ref: { app: 'operations', id: 'REL-001' } });
    const slos = await until(async () => { const s = (await t.get(`${API}/slos`, { as: 'naledi-k' })).json.slos; assert.equal(s.length, 2); return s; });
    assert.deepEqual(slos.map((s) => [s.id, s.kind, s.release]), [['SLO-031-1', 'latency', 'REL-001 · Slots 1.0'], ['SLO-031-2', 'availability', 'REL-001 · Slots 1.0']]);
    // Burning: a Viewer can't; 22 minutes is half; again nothing new; the rest is the second alert.
    assert.equal((await t.post(`${API}/slos/SLO-031-2/burn`, { as: 'naledi-k', body: { minutes: 5 } })).status, 403);
    assert.equal((await t.post(`${API}/slos/SLO-031-2/burn`, { as: 'thabo-n', body: { minutes: 0 } })).status, 400);
    const half = (await t.post(`${API}/slos/SLO-031-2/burn`, { as: 'thabo-n', body: { minutes: 22 } })).json;
    assert.deepEqual([half.status, half.alerts.map((a) => a.level)], ['burning', ['burning']]);
    await t.post(`${API}/slos/SLO-031-2/burn`, { as: 'thabo-n', body: { minutes: 1 } });
    const gone = (await t.post(`${API}/slos/SLO-031-2/burn`, { as: 'thabo-n', body: { minutes: 30 } })).json;
    assert.deepEqual([gone.status, gone.alerts.map((a) => a.level), gone.leftMinutes], ['exhausted', ['burning', 'exhausted'], 0]);
    assert.equal(f.calls.filter((c) => c.name === 'oncall.alert').length, 2);
    assert.equal((await t.hosted.status()).badges.slos, 1);
    // An incident raised from the SLO: linked to the release; its signal on the board. An agent can't declare one.
    await assert.rejects(Promise.resolve().then(async () => { const r = await t.post(`${API}/incidents`, { as: 'ada-quill', body: { title: 'x' } }); if (r.status !== 403) throw new Error(String(r.status)); throw Object.assign(new Error('refused'), { code: 'refused' }); }), { code: 'refused' });
    const inc = (await t.post(`${API}/slos/SLO-031-2/incident`, { as: 'thabo-n', body: { title: 'Slot list timeouts at peak' } })).json;
    assert.deepEqual([inc.id, inc.itemId, inc.release, inc.sloId, inc.signalId], ['INC-001', 'PRD-031', 'REL-001 · Slots 1.0', 'SLO-031-2', 'sig_slotlisttimeouts']);
    assert.deepEqual(f.calls.find((c) => c.name === 'product.raiseSignal').input.release, 'REL-001 · Slots 1.0');
    now += 40 * 60_000;
    assert.equal((await t.post(`${API}/incidents/INC-001/review`, { as: 'thabo-n', body: {} })).status, 409, 'no review before it is resolved');
    const resolved = (await t.post(`${API}/incidents/INC-001/resolve`, { as: 'thabo-n', body: { resolution: 'Warmed the cache' } })).json;
    assert.deepEqual([resolved.status, resolved.minutesOpen, resolved.review.draftedBy.name], ['resolved', 40, 'Pip Okafor']);
    assert.match(resolved.review.text, /availability SLO|Availability SLO/);
    const accepted = (await t.post(`${API}/incidents/INC-001/review`, { as: 'lerato-m', body: {} })).json;
    assert.deepEqual([accepted.status, accepted.review.page.path], ['reviewed', 'Post-incident reviews/INC-001 Slot list timeouts at peak.md']);
    const follow = (await t.post(`${API}/incidents/INC-001/follow-ups`, { as: 'thabo-n', body: { title: 'Warm the cache before each deploy' } })).json;
    assert.deepEqual(follow.followUps.map((x) => [x.kind, x.ref]), [['idea', 'IDEA-012']]);
    assert.deepEqual(f.calls.find((c) => c.name === 'product.createIdea').input.signals, ['sig_slotlisttimeouts']);
    // The outcome review: scheduled for 30 days on; due, its approval opens; the goals against target; closed.
    const scheduled = (await t.get(`${API}/outcome-reviews/OR-031`, { as: 'naledi-k' })).json;
    assert.deepEqual([scheduled.status, scheduled.days], ['scheduled', 30]);
    now += 31 * DAY;
    const due = (await t.get(`${API}/outcome-reviews/OR-031`, { as: 'naledi-k' })).json;
    assert.equal(due.status, 'due');
    const asked = f.calls.filter((c) => c.name === 'workflows.requestAppApproval').map((c) => c.input).find((i) => i.type === 'outcome-review');
    assert.deepEqual([asked.itemId, asked.ref], ['PRD-031', { app: 'operations', id: 'OR-031', kind: 'outcome-review' }]);
    assert.deepEqual(due.goals.map((g) => [g.now, g.met]), [['31.5%', false], ['1050 ms', false]]);
    assert.deepEqual(due.stillUnderWay.map((s) => s.id), ['STORY-031-2']);
    await assert.rejects(t.hosted.services.decideApproval({ id: 'OR-031', decision: 'approve', person: { id: 'priya-s', accessRole: 'Contributor' } }), { status: 403 });
    const idea = (await t.post(`${API}/outcome-reviews/OR-031/idea`, { as: 'lerato-m', body: {} })).json;
    assert.deepEqual(idea.ideas.map((i) => i.id), ['IDEA-012']);
    await t.emit('approval.decided', { type: 'outcome-review', outcome: 'approved', by: 'lerato-m', ref: { app: 'operations', id: 'OR-031' } });
    await until(async () => assert.equal((await t.get(`${API}/outcome-reviews/OR-031`, { as: 'naledi-k' })).json.status, 'closed'));
    assert.ok(t.eventLog.some((e) => e.type === 'outcome_review.closed' && e.payload.goals === 2));
  } finally {
    await t.close();
  }
});
