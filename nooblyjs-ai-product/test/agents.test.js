// Real drafting agents, engine side (docs/roadmap-history.md P8): the contract with nooblyjs-ai-teammate, no mock drafts in
// production, and personal data redacted before a draft is written to disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redact } from '../src/util/redact.js';
import { readDraft } from '../src/services/drafting.js';
import { startApp } from './helpers.js';

const API = '/product/api/v1';

test('redact() replaces e-mail addresses, phone numbers and ID numbers', () => {
  assert.equal(
    redact('Call Thandi on 082 555 1234 or +27 21 555 0000, mail thandi@example.co.za, ID 8001015009087.'),
    'Call Thandi on [phone] or [phone], mail [email], ID [id number].',
  );
  assert.equal(redact('Slots sell out before 10:00 at 412 stores.'), 'Slots sell out before 10:00 at 412 stores.');
  assert.equal(redact(null), null);
});

test('the brief on disk is redacted; the teammate gets it as written', async () => {
  const calls = [];
  const teammates = { runTask: async (input) => { calls.push(input); return { output: { rolloutPlan: 'Pilot first.' }, costUsd: 0.4, modelRoute: 'spec-drafting' }; } };
  const t = await startApp({ seed: true, services: { teammates } });
  try {
    const asked = await t.post(`${API}/specs/PRD-030/drafts`, { as: 'lerato-m', body: { kind: 'spec', brief: 'Ask Thandi (thandi@example.co.za, 082 555 1234) about points at checkout.' } });
    assert.equal(asked.status, 202);
    await t.hosted.idle();
    assert.ok(calls[0].input.task.includes('Ask Thandi (thandi@example.co.za, 082 555 1234) about points at checkout.'));
    const file = await fs.readFile(path.join(t.dataDir, 'drafts', `${asked.json.draftId}.md`), 'utf8');
    assert.doesNotMatch(file, /thandi@example|082 555/);
    assert.match(file, /\[email\], \[phone\]/);
  } finally {
    await t.close();
  }
});

test('the runTask contract: slug, work type, item, system, who asked, the task and its script; the teammate returns output, cost and route', async () => {
  const calls = [];
  const teammates = { runTask: async (input) => { calls.push(input); return { output: { code: 'C4Container\nContainer(api, "Lockers API", "Node 22", "x", $tags="new")' }, costUsd: 2.1, modelRoute: 'architecture-drafting:opus' }; } };
  const t = await startApp({ seed: true, services: { teammates } });
  try {
    await t.post(`${API}/architecture/PRD-025/drafts`, { as: 'thabo-n', body: { kind: 'container-view' } });
    await t.hosted.idle();
    assert.deepEqual(Object.keys(calls[0]).sort(), ['billTo', 'caller', 'input', 'itemId', 'scripted', 'slug', 'system', 'workType']);
    assert.deepEqual([calls[0].slug, calls[0].workType, calls[0].system], ['rhea-voss', 'architecture-drafting', 'product']);
    assert.deepEqual(Object.keys(calls[0].input).sort(), ['context', 'task']);
    assert.match(calls[0].input.task, /^Draft .+ for PRD-025/);
    assert.equal(calls[0].caller.id, 'thabo-n');
    assert.equal(typeof calls[0].scripted, 'function');
    const action = t.eventLog.find((e) => e.type === 'agent.action').payload;
    assert.deepEqual([action.modelRoute, action.costUsd], ['architecture-drafting:opus', 2.1]);
    // No model id anywhere in what the engine sends: the teammate routes by work type.
    assert.doesNotMatch(JSON.stringify(calls[0]), /claude|opus|sonnet|gpt/i);
  } finally {
    await t.close();
  }
});

test('NooblyJS Phase 25b: the context of a draft carries the product strategy people wrote, and nothing when none is written', async () => {
  const calls = [];
  const teammates = { runTask: async (input) => { calls.push(input); return { output: { rolloutPlan: 'Pilot first.' }, costUsd: 0.1, modelRoute: 'spec-drafting' }; } };
  const t = await startApp({ seed: true, services: { teammates } });
  try {
    await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    await t.hosted.idle();
    assert.doesNotMatch(calls[0].input.context, /The product strategy/);
    const doc = await t.post(`${API}/strategy-docs`, { as: 'lerato-m', body: { kind: 'vision', name: 'Acme groceries' } });
    await t.put(`${API}/strategy-docs/${doc.json.id}`, { as: 'lerato-m', body: { sections: [{ heading: 'Vision', text: 'Groceries home the same day, every day.' }] }, headers: { 'if-match': doc.etag } });
    await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    await t.hosted.idle();
    assert.match(calls.at(-1).input.context, /The product strategy:\n### Vision: Acme groceries\nVision: Groceries home the same day, every day\./);
  } finally {
    await t.close();
  }
});

test('in production there are no mock drafts: without Teammates, drafting is refused and nothing is queued', async () => {
  const t = await startApp({ seed: true });
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    assert.equal(res.status, 503);
    assert.equal(res.json.error.code, 'teammates_unavailable');
    assert.equal((await t.get(`${API}/drafts?itemId=PRD-031&status=queued`, { as: 'lerato-m' })).json.drafts.length, 0);
  } finally {
    process.env.NODE_ENV = was;
    await t.close();
  }
});

test('a teammate that returns nothing fails the draft, says why, and charges nothing', async () => {
  const teammates = { runTask: async () => ({ output: null, costUsd: 0.3 }) };
  const t = await startApp({ seed: true, services: { teammates } });
  try {
    const asked = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    await t.hosted.idle();
    const job = (await t.get(`${API}/drafts/${asked.json.draftId}`, { as: 'lerato-m' })).json;
    assert.equal(job.status, 'failed');
    assert.equal(job.text, "The teammate's draft could not be read, so nothing was saved. Ask again.");
    assert.equal(job.costUsd, 0);
    assert.ok(!t.eventLog.some((e) => e.type === 'agent.action'));
  } finally {
    await t.close();
  }
});

test('a model\'s draft is read as one JSON object with the keys that kind of draft has; anything else is refused', () => {
  const shape = { rolloutPlan: '1. Pilot in [PLACEHOLDER: number] stores.' };
  assert.deepEqual(readDraft('Here it is.\n```json\n{ "rolloutPlan": "1. Pilot in 3 stores." }\n```', shape), { rolloutPlan: '1. Pilot in 3 stores.' });
  assert.deepEqual(readDraft('{"rolloutPlan":"x"}', shape), { rolloutPlan: 'x' });
  // A key the stage didn't ask for (a status, an approval) never reaches the stage.
  for (const bad of ['{"rolloutPlan":"x","status":"approved"}', 'I would pilot first.', '[]', '{}', '', null]) {
    assert.throws(() => readDraft(bad, shape), (err) => err.status === 502 && err.code === 'unreadable_draft', String(bad));
  }
});

test('with a model, the teammate\'s text is read into the draft; with none, its script is the draft', async () => {
  const model = { get: async () => ({ id: 'ada-quill' }), runTask: async () => ({ output: 'Done.\n```json\n{ "rolloutPlan": "1. Pilot in 3 stores." }\n```', costUsd: 0.07, modelRoute: 'anthropic/claude-opus-5-5', scripted: false }) };
  const t = await startApp({ seed: true, services: { teammates: model } });
  try {
    await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    await t.hosted.idle();
    const spec = (await t.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json;
    assert.match(JSON.stringify(spec), /1\. Pilot in 3 stores\./);
    assert.equal(t.eventLog.find((e) => e.type === 'agent.action').payload.modelRoute, 'anthropic/claude-opus-5-5');
  } finally {
    await t.close();
  }

  const scripted = { get: async () => ({ id: 'ada-quill' }), runTask: async (request) => ({ output: (await request.scripted()).output, costUsd: 0.45, modelRoute: 'mock/scripted', scripted: true }) };
  const s = await startApp({ seed: true, services: { teammates: scripted } });
  try {
    await s.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    await s.hosted.idle();
    assert.match(JSON.stringify((await s.get(`${API}/specs/PRD-031`, { as: 'lerato-m' })).json), /Pilot in \[PLACEHOLDER: number\] stores/);
    assert.equal(s.eventLog.find((e) => e.type === 'agent.action').payload.modelRoute, 'mock/scripted');
  } finally {
    await s.close();
  }
});

test('an agent nobody has hired drafts from the script alone, and a paused teammate\'s refusal is the reason shown', async () => {
  const calls = [];
  const paused = Object.assign(new Error('Ada Quill is paused. Resume them to assign work.'), { status: 409, code: 'teammate_paused' });
  const teammates = { get: async (slug) => (slug === 'ada-quill' ? { id: slug } : null), runTask: async (request) => { calls.push(request.slug); throw paused; } };
  const t = await startApp({ seed: true, services: { teammates } });
  try {
    // Rhea isn't on this team, so the container view is the scripted one and Teammates is never asked.
    await t.post(`${API}/architecture/PRD-025/drafts`, { as: 'thabo-n', body: { kind: 'container-view' } });
    await t.hosted.idle();
    assert.deepEqual(calls, []);
    assert.equal(t.eventLog.find((e) => e.type === 'agent.action').payload.modelRoute, 'mock');

    const asked = await t.post(`${API}/specs/PRD-031/drafts`, { as: 'lerato-m', body: { kind: 'rollout-plan' } });
    await t.hosted.idle();
    const job = (await t.get(`${API}/drafts/${asked.json.draftId}`, { as: 'lerato-m' })).json;
    assert.deepEqual([job.status, job.text, job.costUsd], ['failed', 'Ada Quill is paused. Resume them to assign work.', 0]);
  } finally {
    await t.close();
  }
});
