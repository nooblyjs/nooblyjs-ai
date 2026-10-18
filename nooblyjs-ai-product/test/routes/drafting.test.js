// "Ask the agent to draft" (docs/roadmap-history.md P3): the pipeline, its cost and attribution, the budget, and the rule that a
// draft never lands on top of a newer human edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp } from '../helpers.js';

const API = '/product/api/v1';
const types = (t) => t.eventLog.map((e) => e.type);

async function eventually(check, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('step 1: Ada drafts a spec for IDEA-018 from Lerato\'s brief', async () => {
  const t = await startApp({ seed: true });
  try {
    const spec = await t.post(`${API}/specs`, { as: 'lerato-m', body: { title: 'Smarter substitutions', product: 'Delivery', idea: 'IDEA-018' } });
    assert.equal(spec.json.statusText, 'Awaiting your brief');

    const noBrief = await t.post(`${API}/specs/PRD-033/drafts`, { as: 'lerato-m', body: { kind: 'spec' } });
    assert.equal(noBrief.status, 422);
    assert.equal(noBrief.json.error.details.brief, 'brief is required to start a spec');

    const asked = await t.post(`${API}/specs/PRD-033/drafts`, { as: 'lerato-m', body: { kind: 'spec', brief: 'Substitutes should match what the customer usually buys.' } });
    assert.equal(asked.status, 202);
    assert.match(asked.json.draftId, /^drf_/);
    assert.equal(asked.json.teammate.name, 'Ada Quill');
    await t.hosted.idle();

    const job = (await t.get(`${API}/drafts/${asked.json.draftId}`, { as: 'lerato-m' })).json;
    assert.equal(job.status, 'done');
    assert.equal(job.text, 'Ada Quill drafted the spec (v1) · $1.40');

    const drafted = (await t.get(`${API}/specs/PRD-033`, { as: 'lerato-m' })).json;
    assert.equal(drafted.version, 1);
    assert.equal(drafted.status, 'drafting');
    assert.equal(drafted.authorship.text, 'Drafted by Ada Quill · v1');
    assert.match(drafted.problem, /^Substitutes should match/);
    assert.equal(drafted.agentCost.text, 'Agent cost so far $1.40 · 1 draft');

    // Progress came as events, then the result and its cost.
    const progress = t.eventLog.filter((e) => e.type === 'draft.progressed').map((e) => e.payload.text);
    assert.deepEqual(progress, ['Ada Quill drafting · 10%', 'Ada Quill drafting · 40%', 'Ada Quill drafting · 80%']);
    assert.ok(types(t).includes('spec.drafted'));
    const action = t.eventLog.find((e) => e.type === 'agent.action').payload;
    assert.deepEqual(
      [action.actor, action.teammateId, action.itemId, action.system, action.modelRoute, action.costUsd],
      ['ada-quill', 'ada-quill', 'PRD-033', 'product', 'mock', 1.4],
    );
  } finally {
    await t.close();
  }
});

test('while the agent works, the board card says so', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const teammates = { runTask: async () => { await gate; return { output: { rolloutPlan: 'Pilot, then all stores.' }, costUsd: 0.5, modelRoute: 'spec-drafting' }; } };
  const t = await startApp({ seed: true, services: { teammates } });
  try {
    const asked = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    const job = await eventually(async () => {
      const d = (await t.get(`${API}/drafts/${asked.json.draftId}`, { as: 'lerato-m' })).json;
      return d.progress === 40 && d;
    });
    assert.equal(job.text, 'Ada Quill drafting · 40%');
    const second = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'goals' } });
    assert.equal(second.status, 409);
  } finally {
    release(); // always, or close() would wait for the held job forever
    await t.close();
  }
});

test('step 2: the rollout-plan action takes PRD-031 to 7 of 7 at v5', async () => {
  const t = await startApp({ seed: true });
  try {
    const before = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
    const action = before.readiness.checks.find((c) => c.action).action;
    assert.deepEqual(action, { label: 'Ask Ada to draft rollout', draft: 'rollout-plan' });

    const asked = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: action.draft } });
    assert.equal(asked.status, 202);
    await t.hosted.idle();

    const after = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
    assert.equal(after.version, 5);
    assert.equal(after.readiness.text, '7 of 7');
    assert.match(after.rolloutPlan, /feature flag/);
    assert.equal(after.authorship.text, 'Drafted by Ada Quill · edited by Lerato M. · v5');
    assert.equal(after.agentCost.text, 'Agent cost so far $7.85 · Research + 5 drafts');
    const versions = (await t.get(`${API}/specs/PRD-031/versions`, { as: 'lerato-m' })).json.versions;
    assert.deepEqual(versions.at(-1), { ...versions.at(-1), version: 5, current: true, note: 'Drafted the rollout plan' });
    assert.equal(versions.at(-1).by.name, 'Ada Quill');
  } finally {
    await t.close();
  }
});

test('a Dependencies section answers "Dependencies named" from the content', async () => {
  const t = await startApp({ seed: true });
  try {
    // PRD-029 has no Dependencies section; its "Dependencies named" was recorded.
    const asked = await t.post(`${API}/specs/PRD-029/drafts`, { as: 'lerato-m', body: { kind: 'dependencies' } });
    assert.equal(asked.status, 202);
    await t.hosted.idle();
    const spec = (await t.get(`${API}/specs/PRD-029`, { as: 'lerato-m' })).json;
    assert.ok(spec.sections.some((s) => s.heading === 'Dependencies'));
    assert.equal(spec.readiness.checks.find((c) => c.key === 'dependencies-named').passed, true);
  } finally {
    await t.close();
  }
});

test('step 3: over the budget, a draft is refused with a reason and budget.reached is emitted', async () => {
  const t = await startApp({ seed: true });
  try {
    await fs.writeFile(path.join(t.dataDir, 'budget.yaml'), 'monthlyUsd: 5\n');
    const res = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'budget_reached');
    assert.match(res.json.error.message, /has spent \$\d+\.\d{2} of its \$5\.00 budget this month, so agent work is paused/);
    const reached = t.eventLog.find((e) => e.type === 'budget.reached').payload;
    assert.equal(reached.budgetUsd, 5);
    assert.equal((await t.get(`${API}/drafts?itemId=PRD-031`, { as: 'lerato-m' })).json.drafts.length, 5); // only the seeded ones
  } finally {
    await t.close();
  }
});

test('a draft never lands on top of a newer human edit', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const teammates = { runTask: async () => { await gate; return { output: { rolloutPlan: 'From the agent.' }, costUsd: 0.3, modelRoute: 'spec-drafting' }; } };
  const t = await startApp({ seed: true, services: { teammates } });
  try {
    const asked = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    // While Ada works on v4, Lerato saves v5 herself.
    const mine = await t.put(`${API}/specs/PRD-031`, { as: 'lerato-m', headers: { 'if-match': '"PRD-031@4"' }, body: { rolloutPlan: 'Lerato wrote this.' } });
    release();
    assert.equal(mine.status, 200);
    await t.hosted.idle();

    const job = (await t.get(`${API}/drafts/${asked.json.draftId}`, { as: 'lerato-m' })).json;
    assert.equal(job.status, 'failed');
    assert.match(job.text, /changed while the agent was drafting, so the draft was not saved\. Nothing you wrote was lost/);
    const spec = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
    assert.equal(spec.version, 5);
    assert.equal(spec.rolloutPlan, 'Lerato wrote this.');
    assert.ok(types(t).includes('draft.failed'));
    assert.ok(!types(t).includes('agent.action'));
  } finally {
    release();
    await t.close();
  }
});

test('with Teammates running, the draft is the teammate\'s task, with its real cost and route', async () => {
  const calls = [];
  const teammates = { runTask: async (input) => { calls.push(input); return { output: { rolloutPlan: 'Pilot in 2 stores.' }, costUsd: 0.62, modelRoute: 'spec-drafting:opus' }; } };
  const knowledge = { contextFor: async () => ({ passages: ['Slot capacity model'] }) };
  const t = await startApp({ seed: true, services: { teammates, knowledge } });
  try {
    await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    await t.hosted.idle();
    assert.deepEqual([calls[0].slug, calls[0].workType, calls[0].itemId, calls[0].system], ['ada-quill', 'spec-drafting', 'PRD-031', 'product']);
    // The task is words; the context is the shape to answer in and what Knowledge has. Lerato asked.
    assert.match(calls[0].input.task, /^Draft the rollout plan for PRD-031/);
    assert.match(calls[0].input.context, /"rolloutPlan"/);
    assert.match(calls[0].input.context, /Slot capacity model/);
    assert.deepEqual(calls[0].caller, { type: 'user', id: 'lerato-m', name: 'Lerato M.' });
    // With no model configured the teammate plays this stage's scripted draft.
    assert.match((await calls[0].scripted()).output.rolloutPlan, /Pilot in \[PLACEHOLDER: number\] stores/);
    const action = t.eventLog.find((e) => e.type === 'agent.action').payload;
    assert.deepEqual([action.modelRoute, action.costUsd], ['spec-drafting:opus', 0.62]);
  } finally {
    await t.close();
  }
});

test('a draft keeps the documents Knowledge gave it as its sources, and they go on the spec as Linked knowledge', async () => {
  const asked = [];
  const docs = [
    { id: 'acme-space.runbooks.slot-capacity-model', title: 'Slot capacity model', kind: 'runbook', detail: 'Acme Space', space: 'Acme Space', path: 'Runbooks/Slot capacity model.md', href: '/wiki/#/Acme%20Space/Runbooks/Slot%20capacity%20model.md', passage: 'Capacity per slot is pickers on shift…' },
    { id: 'acme-space.policies.evening-headroom', title: 'Store ops policy · evening headroom', kind: 'policy', href: 'https://elsewhere.example/x' },
    { id: 'not a valid id', title: 'Dropped' },
    { id: 'acme-space.runbooks.slot-capacity-model', title: 'Listed twice' },
  ];
  const knowledge = { contextFor: async (input) => (asked.push(input), docs) };
  const t = await startApp({ seed: true, services: { knowledge } });
  try {
    const before = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
    const had = before.knowledge.map((k) => k.id);
    const queued = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    assert.equal(queued.status, 202, queued.text);
    await t.hosted.idle();
    assert.equal(asked[0].itemId, 'PRD-031');
    const draft = (await t.get(`${API}/drafts/${queued.json.draft?.id ?? queued.json.id}`, { as: 'lerato-m' })).json;
    const d = draft.draft ?? draft;
    assert.equal(d.status, 'done');
    // Two well-formed documents: an unknown kind becomes "doc", an outside link is not kept, the rest are dropped.
    assert.deepEqual(d.sources, [
      { id: 'acme-space.runbooks.slot-capacity-model', title: 'Slot capacity model', kind: 'runbook', detail: 'Acme Space', href: '/wiki/#/Acme%20Space/Runbooks/Slot%20capacity%20model.md' },
      { id: 'acme-space.policies.evening-headroom', title: 'Store ops policy · evening headroom', kind: 'doc' },
    ]);
    assert.match(d.text, / · from 2 Knowledge sources$/);
    const after = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
    assert.deepEqual(after.knowledge.map((k) => k.id), [...had, 'acme-space.runbooks.slot-capacity-model', 'acme-space.policies.evening-headroom']);
    assert.equal(d.sourcesLinked, 2);
    // A second draft links nothing twice.
    await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    await t.hosted.idle();
    assert.equal((await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json.knowledge.length, had.length + 2);
  } finally {
    await t.close();
  }
});

test('drafts are refused for approved specs, unknown kinds and Viewers', async () => {
  const t = await startApp({ seed: true });
  try {
    const approved = await t.post(`${API}/specs/PRD-027/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    assert.equal(approved.status, 409);
    assert.equal(approved.json.error.code, 'approved');
    const unknown = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'poem' } });
    assert.equal(unknown.status, 422);
    const viewer = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'naledi-k', body: { kind: 'rollout-plan' } });
    assert.equal(viewer.status, 403);
    const nothingYet = await t.post(`${API}/specs/PRD-030/drafts`, { as: 'lerato-m', body: { kind: 'goals' } });
    assert.equal(nothingYet.status, 409);
    assert.equal(nothingYet.json.error.code, 'not_started');
  } finally {
    await t.close();
  }
});
