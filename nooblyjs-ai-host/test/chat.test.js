// Phase 4 in the real app: team chat next to the work (roadmap Phase 4 test script), with the Product Factory and
// the lifecycle engine hosted. Agent replies are scripted and instant here (CHAT_MOCK_REPLY_MS=0). The steps run in
// order on one data folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually, clockDay } from './helpers.js';

let env;
let lerato;
let stevie;
let priya;
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });
const threadOf = async (c, kind = 'spec', id = 'PRD-031') => (await c.json(`/api/v1/chat/thread?kind=${kind}&id=${id}`)).body;
const settled = () => env.noobly.chat.settled();

before(async () => {
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0' },
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
    ],
  });
  [lerato, stevie, priya] = [env.client(), env.client(), env.client()];
  await lerato.signIn('lerato-m');
  await stevie.signIn('stevie');
  await priya.signIn('priya-s');
});
after(async () => { await env?.stop(); });

test('a thread belongs to what is on screen: the Spec, Architecture and item pages share one; other pages have none', async () => {
  const spec = await threadOf(lerato, 'spec');
  assert.equal(spec.thread.id, 'thr_PRD-031');
  assert.equal(spec.thread.title, 'PRD-031 · Same-day delivery slots');
  assert.deepEqual(spec.messages, []);
  assert.deepEqual(spec.chips.map((c) => c.label), ['Summarise thread', 'Find related ADRs']);
  assert.equal(spec.canPost, true);
  assert.equal(spec.mentionable.find((p) => p.id === 'ada-quill').handle, 'Ada');
  assert.equal((await threadOf(lerato, 'architecture')).thread.id, 'thr_PRD-031');
  assert.equal((await threadOf(lerato, 'item')).thread.id, 'thr_PRD-031');
  const repo = await threadOf(lerato, 'repository', 'acme__slots-api');
  assert.equal(repo.thread.id, 'thr_repo-acme__slots-api');
  assert.deepEqual(repo.chips.map((c) => c.label), ['Summarise thread', 'Why did a gate fail?']);
  assert.equal((await lerato.json('/api/v1/chat/thread?kind=page&id=Styleguide')).status, 404);
  assert.equal((await lerato.json('/api/v1/chat/thread?kind=spec&id=../../etc')).status, 404);
  assert.equal((await env.client().get('/api/v1/chat/thread?kind=spec&id=PRD-031')).status, 401);
  assert.equal((await lerato.json('/api/v1/shell')).body.features.chat, true);
});

test('step 1: Lerato asks @Ada for a rollout plan; Ada is working, then replies with a plan card, citations and a cost', async () => {
  const res = await post(lerato, '/api/v1/chat/threads/thr_PRD-031/messages', { text: '@Ada draft a rollout plan' });
  assert.equal(res.status, 201);
  const { message } = await res.json();
  assert.deepEqual(message.author, { id: 'lerato-m', name: 'Lerato M.', kind: 'person' });
  assert.deepEqual(message.mentions, [{ id: 'ada-quill', name: 'Ada Quill', kind: 'agent' }]);
  await settled();
  const { messages } = await threadOf(lerato);
  assert.equal(messages.length, 2);
  const reply = messages[1];
  assert.deepEqual(reply.author, { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' });
  assert.match(reply.text, /^Here's a rollout plan for PRD-031/);
  assert.equal(reply.replyTo, message.id);
  assert.equal(reply.costUsd, 0.42);
  assert.equal(reply.modelRoute, 'mock/claude-sonnet-5-5');
  assert.equal(reply.cards[0].type, 'plan');
  assert.equal(reply.cards[0].steps.length, 4);
  assert.equal(reply.cards[0].status, 'open');
  assert.deepEqual(reply.citations.map((c) => c.n), [1, 2, 3]);
  assert.equal(reply.citations[0].title, 'Slot capacity model');
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'chat.agent_working' && e.payload.agentName === 'Ada Quill'));
  const posted = events.filter((e) => e.type === 'chat.message_posted');
  assert.deepEqual(posted.map((e) => e.actor), ['lerato-m', 'ada-quill']);
  // Every agent action records actor, item, system, model route and cost.
  await eventually(async () => {
    const agent = (await today(env.store, 'audit')).find((r) => r.action === 'agent.chat_reply');
    assert.deepEqual({ actor: agent.actor, itemId: agent.itemId, system: agent.system, modelRoute: agent.modelRoute, costUsd: agent.costUsd }, { actor: 'ada-quill', itemId: 'PRD-031', system: 'product', modelRoute: 'mock/claude-sonnet-5-5', costUsd: 0.42 });
  });
});

test('step 2: the message and the reply reach the event stream, and Activity counts the agent\'s cost', async () => {
  const controller = new AbortController();
  const cookie = [...stevie.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const res = await fetch(`${env.base}/api/v1/events/stream`, { headers: { cookie }, signal: controller.signal });
  const seen = [];
  const reading = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        for (const block of buffer.split('\n\n').slice(0, -1)) {
          const data = block.split('\n').find((l) => l.startsWith('data: '));
          if (data) seen.push(JSON.parse(data.slice(6)));
        }
        buffer = buffer.slice(buffer.lastIndexOf('\n\n') + 2);
      }
    } catch { /* aborted */ }
  })();
  await post(lerato, '/api/v1/chat/threads/thr_PRD-031/messages', { text: '@Ada what is still blocking this?' });
  await settled();
  await eventually(() => {
    const types = seen.filter((e) => e.threadId === 'thr_PRD-031').map((e) => e.type);
    assert.deepEqual(types, ['chat.message_posted', 'chat.agent_working', 'chat.message_posted']);
  });
  assert.equal(seen.find((e) => e.type === 'chat.agent_working').agentName, 'Ada Quill');
  controller.abort();
  await reading;
  const facts = (await threadOf(lerato)).messages.at(-1).cards[0];
  assert.equal(facts.type, 'facts');
  assert.deepEqual(facts.rows.slice(0, 2), [{ label: 'Stage', value: 'Specify' }, { label: 'Waiting on', value: 'Stevie, Thabo N.' }]);
  const activity = (await stevie.json('/api/v1/activity?filter=agents')).body.rows;
  assert.ok(activity.some((r) => r.type === 'chat.message_posted' && r.actor.name === 'Ada Quill' && r.costUsd === 0.42));
  assert.ok(!activity.some((r) => r.type === 'chat.agent_working'));
});

test('step 3: Apply to spec is a person\'s action: the spec becomes v5 with a rollout plan, readiness reads 7 of 7, and a system line says so', async () => {
  const card = (await threadOf(lerato)).messages[1].cards[0];
  const viewer = env.client();
  await viewer.signIn('naledi-k');
  assert.equal((await post(viewer, `/api/v1/chat/cards/${card.id}/apply`)).status, 403, 'a Viewer may not');
  const res = await post(lerato, `/api/v1/chat/cards/${card.id}/apply`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).version, 5);
  const spec = (await lerato.json('/product/api/v1/specs/PRD-031')).body;
  assert.equal(spec.version, 5);
  assert.match(JSON.stringify(spec), /Pilot in \[PLACEHOLDER: number\] stores behind a feature flag/);
  const readiness = (await stevie.json('/workflows/api/v1/approvals/apr_prd031spec')).body.approval.readiness;
  assert.equal(`${readiness.passed} of ${readiness.total}`, '7 of 7');
  const { messages } = await threadOf(lerato);
  const line = messages.at(-1);
  assert.equal(line.author.kind, 'system');
  assert.equal(line.text, 'Lerato M. applied the rollout plan to the spec · spec v5');
  assert.equal(messages[1].cards[0].status, 'applied');
  assert.equal((await post(lerato, `/api/v1/chat/cards/${card.id}/apply`)).status, 409, 'once');
});

test('steps 4 and 5: Rhea answers with a comparison card and asks for read access; Priya can\'t answer the approval card, Stevie can', async () => {
  await post(lerato, '/api/v1/chat/threads/thr_PRD-031/messages', { text: '@Rhea can we hit 300 ms without Redis?' });
  await settled();
  const { messages } = await threadOf(lerato, 'architecture');
  const [answer, ask] = messages.slice(-2);
  assert.equal(answer.author.name, 'Rhea Voss');
  assert.equal(answer.cards[0].type, 'comparison');
  assert.deepEqual(answer.cards[0].columns, ['Redis with a 30-second TTL', 'Postgres read replica']);
  assert.equal(answer.cards[0].rows.length, 4);
  const card = ask.cards[0];
  assert.deepEqual({ type: card.type, requires: card.requires, status: card.status }, { type: 'approval', requires: 'change-repo-access', status: 'open' });

  const refused = await post(priya, `/api/v1/chat/cards/${card.id}/decision`, { decision: 'approve' });
  assert.equal(refused.status, 403);
  assert.match((await refused.json()).error.message, /needs the "change-repo-access" permission, and your access role is Contributor/);
  assert.equal((await post(lerato, `/api/v1/chat/cards/${card.id}/decision`, { decision: 'approve' })).status, 403, 'an Approver is not an Owner');
  assert.equal((await post(stevie, `/api/v1/chat/cards/${card.id}/decision`, { decision: 'maybe' })).status, 400);
  const ok = await post(stevie, `/api/v1/chat/cards/${card.id}/decision`, { decision: 'approve' });
  assert.equal(ok.status, 200);
  assert.equal((await post(stevie, `/api/v1/chat/cards/${card.id}/decision`, { decision: 'decline' })).status, 409);

  const after = await threadOf(lerato);
  assert.equal(after.messages.find((m) => m.id === ask.id).cards[0].status, 'approved');
  assert.match(after.messages.at(-1).text, /^Stevie approved Rhea Voss's request: read access to delivery-planner\./);
  const activity = (await stevie.json('/api/v1/activity?limit=10')).body.rows;
  assert.ok(activity.some((r) => r.type === 'chat.card_decided' && r.actor.name === 'Stevie' && /approved Rhea Voss's request/.test(r.action)));
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    const decided = audit.find((r) => r.action === 'chat.card_decided' && r.status === 200);
    assert.deepEqual({ actor: decided.actor, decision: decided.decision, requires: decided.requires, resource: decided.resource, requestedBy: decided.requestedBy }, { actor: 'stevie', decision: 'approve', requires: 'change-repo-access', resource: 'delivery-planner', requestedBy: 'rhea-voss' });
    assert.ok(audit.some((r) => r.actor === 'priya-s' && r.action === 'access.refused' && r.attempted === 'chat.card_decided' && r.permission === 'change-repo-access'));
  });
});

test('governance: no agent action in chat can decide a card, apply a draft, or change the item', async () => {
  const before = (await stevie.json('/workflows/api/v1/items/PRD-031')).body.item;
  // A new approval card and a new plan card, both open.
  await post(lerato, '/api/v1/chat/threads/thr_PRD-031/messages', { text: '@Rhea what about the cache? @Ada draft the rollout again' });
  await settled();
  const { messages } = await threadOf(lerato);
  const cards = messages.flatMap((m) => m.cards ?? []).filter((c) => c.status === 'open');
  const approval = cards.find((c) => c.type === 'approval');
  const plan = cards.find((c) => c.type === 'plan');
  const { chat } = env.noobly;
  for (const agent of [{ id: 'rhea-voss', name: 'Rhea Voss', kind: 'agent' }, { id: 'ada-quill', name: 'Ada Quill', kind: 'agent', accessRole: 'Owner' }]) {
    const decide = await chat.decideCard(approval.id, { decision: 'approve' }, agent).catch((err) => err);
    assert.equal(decide.code, 'people_only', `${agent.id} can't answer an approval card`);
    const apply = await chat.applyCard(plan.id, agent).catch((err) => err);
    assert.equal(apply.code, 'people_only', `${agent.id} can't apply a draft`);
  }
  const product = await import('nooblyjs-ai-product').catch(() => null);
  assert.ok(product, 'the Product Factory is installed');
  await eventually(async () => {
    const refusals = (await today(env.store, 'audit')).filter((r) => r.action === 'access.refused' && /agents propose, people decide/.test(r.reason ?? ''));
    assert.equal(refusals.length, 4);
  });
  // The replies themselves changed nothing: same stage, same approvals, same spec version, cards still open.
  const item = (await stevie.json('/workflows/api/v1/items/PRD-031')).body.item;
  assert.deepEqual({ stage: item.stage, status: item.status }, { stage: before.stage, status: before.status });
  assert.equal((await lerato.json('/product/api/v1/specs/PRD-031')).body.version, 5);
  const still = (await threadOf(lerato)).messages.flatMap((m) => m.cards ?? []);
  assert.equal(still.find((c) => c.id === approval.id).status, 'open');
  assert.equal(still.find((c) => c.id === plan.id).status, 'open');
  // A person who isn't signed in as a person can't either, and a Viewer can't post.
  assert.equal((await env.client().request(`/api/v1/chat/cards/${approval.id}/decision`, { method: 'POST', json: { decision: 'approve' } })).status, 403, 'no session: the CSRF check refuses it');
  const viewer = env.client();
  await viewer.signIn('naledi-k');
  assert.equal((await post(viewer, '/api/v1/chat/threads/thr_PRD-031/messages', { text: 'hello' })).status, 403);
});

test('step 6: Summarise thread posts what was said and what changed; the other chips answer honestly', async () => {
  const res = await post(lerato, '/api/v1/chat/threads/thr_PRD-031/actions', { action: 'summarise' });
  assert.equal(res.status, 201);
  const { message } = await res.json();
  assert.equal(message.author.kind, 'system');
  assert.match(message.text, /^Summary, asked for by Lerato M\.: \d+ messages from Lerato M\., Ada Quill, Rhea Voss\./);
  assert.match(message.text, /What changed: Lerato M\. applied the rollout plan to the spec · spec v5/);
  assert.match(message.text, /Stevie approved Rhea Voss's request/);
  assert.match(message.text, /Agent cost in this thread: \$\d+\.\d\d\./);
  const adrs = await (await post(lerato, '/api/v1/chat/threads/thr_PRD-031/actions', { action: 'related-adrs' })).json();
  assert.equal(adrs.message.cards[0].rows[0].label, 'ADR-014');
  assert.equal((await post(lerato, '/api/v1/chat/threads/thr_PRD-031/actions', { action: 'gate-failed' })).status, 400, 'not a chip on an item thread');
  const gate = await (await post(lerato, '/api/v1/chat/threads/thr_repo-acme__slots-api/actions', { action: 'gate-failed' })).json();
  assert.match(gate.message.text, /Software Factory, which joins NooblyJS in Phase 7/);
});

test('step 7: every message is in data/chat/messages/thr_PRD-031/<today>.yaml with author, mentions and cost, and never edited', async () => {
  const day = await clockDay(env.store);
  const records = await env.store.readYamlStream(['chat', 'messages', 'thr_PRD-031', `${day}.yaml`]);
  const shown = (await threadOf(lerato)).messages;
  assert.deepEqual(records.map((m) => m.id), shown.map((m) => m.id));
  assert.ok(records.every((m) => m.author?.id && m.author.kind && m.at && typeof m.text === 'string'));
  assert.deepEqual(records[0].mentions, [{ id: 'ada-quill', name: 'Ada Quill', kind: 'agent' }]);
  assert.equal(records[1].costUsd, 0.42);
  assert.equal(records[1].cards[0].status, 'open', 'the stream keeps the card as it was posted; its state lives in the card file');
  const thread = await env.store.readDoc(['chat', 'threads', 'thr_PRD-031.md']);
  assert.deepEqual(thread.data.scope, { kind: 'item', id: 'PRD-031' });
  assert.ok(['lerato-m', 'ada-quill', 'rhea-voss', 'system'].every((p) => thread.data.participants.includes(p)));
  assert.equal(thread.data.teamsChannel, '[PLACEHOLDER]');
  assert.ok((await fs.readdir(path.join(env.dataDir, 'chat', 'cards'))).length >= 4);
});

test('mentions: first names when unique, ids always; an unknown name is just text; an unscripted question gets the honest fallback', async () => {
  const res = await post(stevie, '/api/v1/chat/threads/thr_channel-platform/messages', { text: 'Thanks @Lerato and @thabo-n. cc @nobody, mail me at s@noobly.local. @Otis can you reindex?' });
  const { message } = await res.json();
  assert.deepEqual(message.mentions.map((m) => m.id), ['lerato-m', 'thabo-n', 'otis-fern']);
  await settled();
  const { messages, thread } = await threadOf(stevie, 'channel', 'platform');
  assert.equal(thread.title, '#platform');
  assert.match(messages.at(-1).text, /I don't have a scripted answer for that yet/);
  assert.equal(messages.at(-1).costUsd, 0);
  assert.equal((await post(stevie, '/api/v1/chat/threads/thr_channel-platform/messages', { text: '   ' })).status, 400);
  assert.equal((await post(stevie, '/api/v1/chat/threads/nonsense/messages', { text: 'x' })).status, 404);
});

// ------------------------------------------------------------------ Phase 6: a reply is a teammate's task

const teammatesApp = () => env.noobly.hosted.apps.find((a) => a.name === 'teammates').internals;
const entriesOf = async (id) => (await teammatesApp().repos.timesheets.listRange(id, '2000-01-01', '2999-12-31')).filter((e) => e.callerType === 'user' && e.workId);

test("every reply above went on the teammate's timesheet, billed to the item's team, for the person who asked", async () => {
  const ada = await entriesOf('ada-quill');
  assert.ok(ada.length >= 2);
  for (const entry of ada) assert.deepEqual([entry.costCentre, entry.hours > 0, entry.amount > 0], ['Delivery squad', true, true]);
  const first = ada.find((e) => e.apiCost === 0.42);
  assert.equal(first.caller, 'Lerato M.');
  const work = await teammatesApp().repos.work.get('ada-quill', first.workId);
  assert.deepEqual([work.itemId, work.system, work.workType, work.teamId, work.scripted], ['PRD-031', 'product', 'chat.reply', 'delivery-squad', true]);
  // The audit record of the message names the work item, so the two can be matched.
  assert.ok((await today(env.store, 'audit')).some((r) => r.action === 'agent.chat_reply' && r.workId === first.workId));
  // Otis answered in #platform, which has no item: his first NooblyJS team pays.
  assert.equal((await entriesOf('otis-fern')).at(-1).costCentre, 'Platform team');
});

test('a task shows in Activity once, as the message it was for: its cost is not counted twice', async () => {
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'teammate.task_finished' && e.payload.teammateId === 'ada-quill' && e.payload.modelRoute === 'mock/claude-sonnet-5-5'));
  const { rows, today: summary } = (await lerato.json('/api/v1/activity?limit=100')).body;
  assert.ok(!rows.some((r) => /^teammate\.task_/.test(r.type)));
  // Today's spend is every costed event except the tasks themselves (the seed story has a few of its own).
  const costOf = (list) => Math.round(list.reduce((sum, e) => sum + (e.payload.costUsd ?? 0), 0) * 100) / 100;
  const tasks = events.filter((e) => /^teammate\.task_/.test(e.type));
  assert.ok(costOf(tasks) > 0);
  assert.equal(costOf(tasks), costOf(events.filter((e) => e.type === 'chat.message_posted')));
  assert.equal(summary.spentUsd, costOf(events.filter((e) => !/^teammate\.task_/.test(e.type))));
});

test('a paused teammate does not answer: NooblyJS says why, nothing is billed, and no agent message is posted', async () => {
  const before = (await entriesOf('sable-reyes')).length;
  const res = await post(lerato, '/api/v1/chat/threads/thr_PRD-031/messages', { text: '@Sable can you write the headline for the slot picker?' });
  const { message } = await res.json();
  assert.deepEqual(message.mentions, [{ id: 'sable-reyes', name: 'Sable Reyes', kind: 'agent' }]);
  await settled();
  const { messages, working } = await threadOf(lerato);
  const line = messages.at(-1);
  assert.deepEqual(line.author, { id: 'system', name: 'NooblyJS', kind: 'system' });
  assert.equal(line.text, "Sable Reyes didn't pick this up. Sable Reyes is paused. Resume them to assign work. Nothing was billed.");
  assert.equal(line.replyTo, message.id);
  assert.equal(line.costUsd, undefined);
  assert.deepEqual(working, []);
  assert.ok(!messages.some((m) => m.author.id === 'sable-reyes'));
  assert.equal((await entriesOf('sable-reyes')).length, before);
  const events = await today(env.store, 'events');
  assert.ok(!events.some((e) => e.type === 'chat.agent_working' && e.payload.agentId === 'sable-reyes'));
  await eventually(async () => {
    const refused = (await today(env.store, 'audit')).find((r) => r.action === 'agent.chat_reply_refused');
    assert.deepEqual([refused.actor, refused.reason, refused.costUsd], ['sable-reyes', 'teammate_paused', 0]);
  });
});

test("with a model configured the reply is the model's answer: its text, one checked card, and what it cost", async () => {
  const { agents } = env.noobly;
  const real = { provider: agents.provider, runTask: agents.runTask };
  const asked = [];
  agents.provider = () => 'anthropic';
  agents.runTask = async (request) => {
    asked.push(request);
    return {
      output: [
        'ADR-014 is the one blocker. It is with Thabo.',
        '```noobly-card',
        'type: facts',
        'title: PRD-031 · status',
        'status: approved',
        'rows:',
        '  - { label: Waiting on, value: Thabo N. }',
        '  - { label: "<script>", value: "<img onerror=x>" }',
        'apply: { label: Apply to spec, section: status }',
        '```',
        '```noobly-card',
        'type: approval',
        'title: Give me merge rights',
        'requires: merge',
        '```',
      ].join('\n'),
      costUsd: 0.06, modelRoute: 'anthropic/claude-opus-5-5', scripted: false, workId: 'wk_live', hours: 0.1, amount: 4.8,
    };
  };
  try {
    const res = await post(lerato, '/api/v1/chat/threads/thr_PRD-031/messages', { text: "@Ada what's still blocking the slot pilot?" });
    const { message } = await res.json();
    await settled();
    const reply = (await threadOf(lerato)).messages.at(-1);
    assert.deepEqual(reply.author, { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' });
    assert.equal(reply.text, 'ADR-014 is the one blocker. It is with Thabo.');
    assert.deepEqual([reply.costUsd, reply.modelRoute, reply.replyTo], [0.06, 'anthropic/claude-opus-5-5', message.id]);
    // One card, rebuilt from known fields: no status, no apply, and never an approval card.
    assert.equal(reply.cards.length, 1);
    const { id, ...card } = reply.cards[0];
    assert.match(id, /^card_/);
    assert.deepEqual(card, { type: 'facts', rows: [{ label: 'Waiting on', value: 'Thabo N.' }, { label: '<script>', value: '<img onerror=x>' }], title: 'PRD-031 · status' });

    // What the teammate was given: the mention, who asked, the item's team, the rules, the facts and the thread so far.
    const [request] = asked;
    assert.deepEqual([request.slug, request.workType, request.itemId, request.system], ['ada-quill', 'chat.reply', 'PRD-031', 'product']);
    assert.deepEqual(request.caller, { type: 'user', id: 'lerato-m', name: 'Lerato M.' });
    assert.deepEqual(request.billTo, { teamId: 'delivery-squad', teamName: 'Delivery squad' });
    assert.equal(request.input.task, "@Ada what's still blocking the slot pilot?");
    assert.match(request.input.context, /You cannot approve, change a status, merge or grant access/);
    assert.match(request.input.context, /- Item: PRD-031 · Same-day delivery slots/);
    assert.ok(request.input.history.length > 0 && request.input.history.length <= 20);
    assert.ok(request.input.history.some((m) => m.author === 'Ada Quill (agent)'));
    assert.ok(!request.input.history.some((m) => m.text === request.input.task));
  } finally {
    Object.assign(agents, real);
  }
});

test("when the model provider fails, NooblyJS says so in the thread and posts nothing on the agent's behalf", async () => {
  const { agents } = env.noobly;
  const real = agents.runTask;
  agents.runTask = async () => { throw Object.assign(new Error('The model provider returned an error: overloaded'), { status: 502, code: 'provider_error' }); };
  try {
    await post(lerato, '/api/v1/chat/threads/thr_PRD-031/messages', { text: '@Ada and the rollout?' });
    await settled();
    const { messages, working } = await threadOf(lerato);
    assert.deepEqual(messages.at(-1).author.kind, 'system');
    assert.match(messages.at(-1).text, /^Ada Quill couldn't answer\. The model provider returned an error: overloaded/);
    assert.deepEqual(working, []);
  } finally {
    agents.runTask = real;
  }
});
