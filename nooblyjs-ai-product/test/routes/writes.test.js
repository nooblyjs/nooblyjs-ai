// Stage 1 writes (docs/roadmap-history.md P2): signal → idea, RICE, spec versions with If-Match, linked knowledge,
// and decisions passed to the NooblyJS lifecycle engine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from '../helpers.js';

const API = '/product/api/v1';

/** Waits for something another app's event causes (event handlers run after the emit returns). */
async function eventually(check, { timeoutMs = 3000 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** A fake lifecycle engine that records decisions and, like the real one will, emits approval.decided. */
function fakeWorkflows(t, { outcome = 'approved' } = {}) {
  const calls = [];
  return {
    calls,
    async decide(input) {
      calls.push(input);
      await t().emit('approval.decided', { itemId: input.itemId, system: 'product', decision: input.decision, outcome: input.decision === 'approve' ? outcome : 'changes-requested' }, input.actor.id);
      return { approvalId: 'apr_test0001' };
    },
  };
}

test('step 1: Lerato turns "Substitutions feel random" into an idea and scores it', async () => {
  const t = await startApp({ seed: true });
  try {
    const created = await t.post(`${API}/signals/sig_substitutionsrandom/idea`, { as: 'lerato-m', body: {} });
    assert.equal(created.status, 201);
    assert.equal(created.json.id, 'IDEA-021');
    assert.equal(created.json.title, 'Substitutions feel random');
    assert.deepEqual(created.json.signals, ['sig_substitutionsrandom']);
    assert.equal(created.json.text, 'Search · RICE not scored');
    assert.equal(created.etag, '"IDEA-021@1"');

    const scored = await t.put(`${API}/ideas/IDEA-021`, {
      as: 'lerato-m', headers: { 'if-match': created.etag }, body: { rice: { reach: 12, impact: 2, confidence: 0.8, effort: 1 } },
    });
    assert.equal(scored.status, 200);
    assert.equal(scored.json.rice.score, 19);
    assert.equal(scored.etag, '"IDEA-021@2"');

    const board = (await t.get(`${API}/board`, { as: 'lerato-m' })).json;
    const col = (key) => board.columns.find((c) => c.key === key);
    assert.equal(col('signals').count, 3);
    assert.ok(col('ideas').cards.some((c) => c.id === 'IDEA-021' && c.text === 'Search · RICE 19'));
    assert.deepEqual(t.eventLog.map((e) => e.type), ['idea.created', 'idea.updated', 'idea.scored']);

    const again = await t.post(`${API}/signals/sig_substitutionsrandom/idea`, { as: 'lerato-m', body: {} });
    assert.equal(again.status, 409);
  } finally {
    await t.close();
  }
});

test('two people converting the same signal at once get one idea', async () => {
  const t = await startApp({ seed: true });
  try {
    const [a, b] = await Promise.all([
      t.post(`${API}/signals/sig_editafterorder/idea`, { as: 'lerato-m', body: {} }),
      t.post(`${API}/signals/sig_editafterorder/idea`, { as: 'priya-s', body: {} }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal((await t.get(`${API}/ideas`, { as: 'lerato-m' })).json.ideas.length, 4);
  } finally {
    await t.close();
  }
});

test('RICE and idea fields are checked, each problem by field', async () => {
  const t = await startApp({ seed: true });
  try {
    const bad = await t.post(`${API}/ideas`, { as: 'lerato-m', body: { rice: { reach: 'lots', impact: 9, confidence: 1, effort: 1 }, status: 'won' } });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.json.error.details, {
      title: 'title is required',
      'rice.reach': 'reach must be a number',
      'rice.impact': 'impact must be between 0.25 and 3',
      status: 'status must be one of open, closed',
    });
    const unknown = await t.post(`${API}/ideas`, { as: 'lerato-m', body: { title: 'X', version: 9 } });
    assert.equal(unknown.json.error.details.version, "version can't be set here");

    const ok = await t.post(`${API}/ideas`, { as: 'priya-s', body: { title: 'Faster checkout', product: 'Checkout', rice: { reach: 10, impact: 1, confidence: 1, effort: 2 } } });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.rice.score, 5);
    assert.equal(ok.json.owner.name, 'Priya S.');
  } finally {
    await t.close();
  }
});

test('idea edits need If-Match: missing is 428, stale is 409', async () => {
  const t = await startApp({ seed: true });
  try {
    assert.equal((await t.put(`${API}/ideas/IDEA-018`, { as: 'lerato-m', body: { title: 'Better substitutions' } })).status, 428);
    const first = await t.put(`${API}/ideas/IDEA-018`, { as: 'lerato-m', headers: { 'if-match': '"IDEA-018@1"' }, body: { title: 'Better substitutions' } });
    assert.equal(first.status, 200);
    const stale = await t.put(`${API}/ideas/IDEA-018`, { as: 'lerato-m', headers: { 'if-match': '"IDEA-018@1"' }, body: { title: 'Other' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.error.details.current, '"IDEA-018@2"');
  } finally {
    await t.close();
  }
});

test('step 2: saving PRD-031 twice with the same If-Match: the second is 409', async () => {
  const t = await startApp({ seed: true });
  try {
    const etag = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).etag;
    assert.equal(etag, '"PRD-031@4"');
    const first = await t.put(`${API}/specs/PRD-031`, {
      as: 'lerato-m', headers: { 'if-match': etag },
      body: { rolloutPlan: 'Pilot in 3 Cape Town stores for two weeks, then all stores.', changeNote: 'Added the rollout plan' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.etag, '"PRD-031@5"');
    assert.equal(first.json.authorship.text, 'Drafted by Ada Quill · edited by Lerato M. · v5');
    // The rollout plan is now in the content, so readiness is 7 of 7.
    assert.equal(first.json.readiness.text, '7 of 7');

    const second = await t.put(`${API}/specs/PRD-031`, { as: 'lerato-m', headers: { 'if-match': etag }, body: { outOfScope: 'Nothing.' } });
    assert.equal(second.status, 409);
    assert.equal(second.json.error.code, 'conflict');

    // v4 was kept, and the versions list now ends with v5 by Lerato.
    const versions = (await t.get(`${API}/specs/PRD-031/versions`, { as: 'lerato-m' })).json.versions;
    assert.deepEqual(versions.map((v) => [v.version, v.by.name, v.current]).slice(-2), [[4, 'Lerato M.', false], [5, 'Lerato M.', true]]);
    const kept = await fs.readFile(path.join(t.dataDir, 'specs', 'PRD-031', 'versions', 'v4.md'), 'utf8');
    assert.match(kept, /Same-day slots still open at 12:00 \| 18% \| 45%/);
    assert.doesNotMatch(kept, /Rollout plan/);
  } finally {
    await t.close();
  }
});

test('a save that changes nothing is not a new version', async () => {
  const t = await startApp({ seed: true });
  try {
    const spec = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
    const res = await t.put(`${API}/specs/PRD-031`, { as: 'lerato-m', headers: { 'if-match': '"PRD-031@4"' }, body: { goals: spec.goals } });
    assert.equal(res.status, 200);
    assert.equal(res.etag, '"PRD-031@4"');
    assert.equal(t.eventLog.length, 0);
  } finally {
    await t.close();
  }
});

test('creating a spec: with content it is drafting at v1; without, it awaits a brief', async () => {
  const t = await startApp({ seed: true });
  try {
    const empty = await t.post(`${API}/specs`, { as: 'lerato-m', body: { title: 'Smarter substitutions', product: 'Delivery', idea: 'IDEA-018' } });
    assert.equal(empty.status, 201);
    assert.equal(empty.json.id, 'PRD-033');
    assert.equal(empty.json.statusText, 'Awaiting your brief');
    assert.equal(empty.json.version, 0);
    assert.equal(empty.json.readiness, null);
    // IDEA-018 now has a spec, so it leaves the Ideas column.
    const board = (await t.get(`${API}/board`, { as: 'lerato-m' })).json;
    assert.ok(!board.columns.find((c) => c.key === 'ideas').cards.some((c) => c.id === 'IDEA-018'));
    assert.equal((await t.post(`${API}/specs`, { as: 'lerato-m', body: { title: 'Again', idea: 'IDEA-018' } })).status, 409);

    const full = await t.post(`${API}/specs`, {
      as: 'priya-s',
      body: {
        title: 'Faster slot list',
        problem: 'The slot list takes 1.8 s at peak.',
        goals: [{ measure: 'Slot list load time, p95', today: '1.8 s', target: '300 ms' }],
        acceptanceCriteria: [{ given: 'the 18:00 peak', when: 'a customer opens slots', then: 'the list loads in under 300 ms' }],
      },
    });
    assert.equal(full.status, 201);
    assert.equal(full.json.version, 1);
    assert.equal(full.json.status, 'drafting');
    assert.equal(full.json.authorship.text, 'Edited by Priya S. · v1');
    const passed = full.json.readiness.checks.filter((c) => c.passed).map((c) => c.key);
    assert.deepEqual(passed, ['problem-evidence', 'goals-measurable', 'criteria-testable', 'performance-targets']);
  } finally {
    await t.close();
  }
});

test('spec content is checked part by part', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.put(`${API}/specs/PRD-031`, {
      as: 'lerato-m', headers: { 'if-match': '"PRD-031@4"' },
      body: { goals: [{ measure: 'x' }], acceptanceCriteria: [{ given: 'a' }], status: 'approved' },
    });
    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.json.error.details).sort(), ['acceptanceCriteria[0]', 'goals[0]', 'status']);
  } finally {
    await t.close();
  }
});

test('an approved spec cannot be edited', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.put(`${API}/specs/PRD-027`, { as: 'naledi-k', headers: { 'if-match': '"PRD-027@5"' }, body: { problem: 'Changed' } });
    // Naledi is a Viewer, so she is refused before anything else.
    assert.equal(res.status, 403);
    const lerato = await t.put(`${API}/specs/PRD-027`, { as: 'lerato-m', headers: { 'if-match': '"PRD-027@5"' }, body: { problem: 'Changed' } });
    assert.equal(lerato.status, 409);
    assert.equal(lerato.json.error.code, 'approved');
  } finally {
    await t.close();
  }
});

test('linking knowledge replaces the list, is typed, and is not a new version', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.put(`${API}/specs/PRD-032/knowledge`, {
      as: 'lerato-m',
      body: { knowledge: [{ id: 'kn-promo-engine', title: 'Promo engine', kind: 'runbook', detail: 'promotions-api' }, { id: 'ADR-009', title: 'Promotions service', kind: 'adr', detail: 'accepted' }] },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.knowledge.map((k) => k.text), ['Runbook · promotions-api', 'Architecture decision · accepted']);
    assert.equal(res.etag, '"PRD-032@1"');
    assert.equal(t.eventLog.at(-1).payload.change, 'knowledge');

    const bad = await t.put(`${API}/specs/PRD-032/knowledge`, { as: 'lerato-m', body: { knowledge: [{ id: '../x', title: 'X', kind: 'wiki' }] } });
    assert.equal(bad.status, 422);
  } finally {
    await t.close();
  }
});

test('readinessFacts says which facts come from the content and which were recorded', async () => {
  const t = await startApp({ seed: true });
  try {
    const { facts, version } = await t.hosted.services.readinessFacts('PRD-031');
    assert.equal(version, 4);
    assert.deepEqual(facts['rollout-plan'], { value: false, source: 'content' });
    assert.deepEqual(facts['privacy-reviewed'], { value: true, source: 'recorded' });
    assert.equal(await t.hosted.services.readinessFacts('PRD-999'), null);
  } finally {
    await t.close();
  }
});

test('a decision goes to the NooblyJS lifecycle engine, and the spec follows approval.decided', async () => {
  let t;
  const workflows = fakeWorkflows(() => t);
  t = await startApp({ seed: true, services: { workflows } });
  try {
    const res = await t.post(`${API}/specs/PRD-031/decision`, { as: 'stevie', body: { decision: 'approve' } });
    assert.equal(res.status, 202);
    assert.match(res.json.text, /^Your approval of v4 was sent/);
    assert.deepEqual(workflows.calls, [{ itemId: 'PRD-031', system: 'product', decision: 'approve', reason: null, version: 4, actor: { id: 'stevie', kind: 'person' } }]);

    const spec = await eventually(async () => {
      const s = (await t.get(`${API}/specs/PRD-031`, { as: 'stevie' })).json;
      return s.status === 'approved' && s;
    });
    assert.equal(spec.status, 'approved');
    assert.deepEqual(spec.reviewers.map((r) => r.statusText), ['Approved', 'Approved']);
    // The engine moved nothing itself: the status follows workflows' outcome, and no stage event came from here.
    assert.ok(!t.eventLog.some((e) => e.type === 'item.stage_changed'));

    // Now approved: nothing left to decide.
    assert.equal((await t.post(`${API}/specs/PRD-031/decision`, { as: 'stevie', body: { decision: 'approve' } })).status, 409);
  } finally {
    await t.close();
  }
});

test('Send for review asks the NooblyJS lifecycle engine to open the approval; the spec is then In review with its reviewers', async () => {
  const asked = [];
  const workflows = {
    async requestApproval(input) {
      asked.push(input);
      return { approvalId: 'apr_test0002', reviewers: [{ id: 'stevie', role: 'Platform engineer', status: 'waiting' }, { id: 'thabo-n', role: 'Architect', status: 'waiting' }] };
    },
  };
  const t = await startApp({ seed: true, services: { workflows } });
  try {
    // Nothing drafted yet, already in review, a Viewer, an agent: none of them can send it.
    assert.equal((await t.post(`${API}/specs/PRD-030/review`, { as: 'lerato-m', body: {} })).json.error.code, 'nothing_to_review');
    assert.equal((await t.post(`${API}/specs/PRD-031/review`, { as: 'lerato-m', body: {} })).json.error.code, 'not_draft');
    assert.equal((await t.post(`${API}/specs/PRD-032/review`, { as: 'naledi-k', body: {} })).status, 403);
    assert.equal((await t.post(`${API}/specs/PRD-032/review`, { as: 'ada-quill', body: {} })).status, 403);
    assert.deepEqual(asked, []);

    const sent = await t.post(`${API}/specs/PRD-032/review`, { as: 'lerato-m', body: {} });
    assert.equal(sent.status, 200);
    assert.equal(sent.json.status, 'in-review');
    assert.deepEqual(sent.json.reviewers.map((r) => [r.id, r.status]), [['stevie', 'waiting'], ['thabo-n', 'waiting']]);
    assert.deepEqual(asked, [{ itemId: 'PRD-032', type: 'spec', title: sent.json.title, version: sent.json.version, actor: { id: 'lerato-m', kind: 'person' } }]);
    const board = (await t.get(`${API}/board`, { as: 'lerato-m' })).json;
    assert.ok(board.columns.find((c) => c.key === 'in-review').cards.some((c) => c.id === 'PRD-032'));
    assert.ok(t.eventLog.some((e) => e.type === 'spec.updated' && e.payload.specId === 'PRD-032' && e.payload.change === 'review-requested'));
    assert.equal((await t.post(`${API}/specs/PRD-032/review`, { as: 'lerato-m', body: {} })).status, 409, 'once is enough');
  } finally {
    await t.close();
  }
});

test('without the NooblyJS lifecycle engine a review request is 503 and the spec stays a draft', async () => {
  const t = await startApp({ seed: true, services: { workflows: null } });
  try {
    assert.equal((await t.post(`${API}/specs/PRD-032/review`, { as: 'lerato-m', body: {} })).status, 503);
    assert.equal((await t.get(`${API}/specs/PRD-032`, { as: 'lerato-m' })).json.status, 'drafting');
  } finally {
    await t.close();
  }
});

test('requesting changes needs a reason', async () => {
  let t;
  const workflows = fakeWorkflows(() => t);
  t = await startApp({ seed: true, services: { workflows } });
  try {
    const noReason = await t.post(`${API}/specs/PRD-029/decision`, { as: 'lerato-m', body: { decision: 'request-changes' } });
    assert.equal(noReason.status, 422);
    const ok = await t.post(`${API}/specs/PRD-029/decision`, { as: 'lerato-m', body: { decision: 'request-changes', reason: 'Add the keyboard-only criteria.' } });
    assert.equal(ok.status, 202);
    const spec = await eventually(async () => {
      const s = (await t.get(`${API}/specs/PRD-029`, { as: 'lerato-m' })).json;
      return s.status === 'changes-requested' && s;
    });
    assert.equal(spec.statusText, 'Changes requested');
  } finally {
    await t.close();
  }
});

test('without the NooblyJS lifecycle engine a decision is 503 and nothing changes', async () => {
  const t = await startApp({ seed: true });
  try {
    const res = await t.post(`${API}/specs/PRD-031/decision`, { as: 'stevie', body: { decision: 'approve' } });
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, 'workflows_unavailable');
    assert.equal((await t.get(`${API}/specs/PRD-031`, { as: 'stevie' })).json.status, 'in-review');
  } finally {
    await t.close();
  }
});

test('approval.decided for another system or an unknown item is ignored; close() stops listening', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.emit('approval.decided', { itemId: 'PRD-031', system: 'factory', decision: 'approve', outcome: 'approved' }, 'stevie');
    await t.emit('approval.decided', { itemId: 'PRD-999', decision: 'approve', outcome: 'approved' }, 'stevie');
    await t.hosted.close();
    await t.emit('approval.decided', { itemId: 'PRD-031', decision: 'approve', outcome: 'approved' }, 'stevie');
    await new Promise((r) => setTimeout(r, 200)); // long enough for a handler that should not be there
    assert.equal((await t.get(`${API}/specs/PRD-031`, { as: 'stevie' })).json.status, 'in-review');
  } finally {
    await t.close();
  }
});
