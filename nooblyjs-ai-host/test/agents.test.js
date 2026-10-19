// Agent teammates come from Digital Teammates (services/agents.js). This file is NooblyJS with Teammates switched off:
// it still starts, agents are the ids on the teams, and nobody can answer. It also covers what a model may put in
// a chat reply (services/chat-reply.js). The hosted case is in chat.test.js and teammates.test.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { readReply } from '../src/services/chat-reply.js';

let env;
let lerato;
before(async () => {
  // Checklist step 8: listed but switched off. Step 9: an app whose register() throws is next to it.
  env = await startApp({
    env: { CHAT_MOCK_REPLY_MS: '0' },
    hostedApps: [
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: false },
      // Part of the Software Factory since 2026-10-19: an older hosted-apps.yaml may still list it. It is skipped.
      { package: 'nooblyjs-ai-infrastructure', mountPath: '/infrastructure', enabled: false },
      { path: 'test/fixtures/broken-app', mountPath: '/broken', enabled: true },
    ],
  });
  lerato = env.client();
  await lerato.signIn('lerato-m');
});
after(async () => { await env?.stop(); });

test('hosted-app checklist steps 8 and 9: with Teammates switched off NooblyJS starts, its rail item says so, and a failing app does not stop it', async () => {
  const { body } = await lerato.json('/api/v1/shell');
  const teammates = body.apps.find((a) => a.mountPath === '/teammates');
  assert.deepEqual([teammates.name, teammates.label, teammates.state], ['teammates', 'Teammates', 'not-installed']);
  assert.equal(body.apps.find((a) => a.mountPath === '/broken').state, 'unavailable');
  // Infrastructure is a section of the Software Factory since 2026-10-19: its old entry is not an app, on or off.
  assert.equal(body.apps.find((a) => a.mountPath === '/infrastructure' || a.name === 'infrastructure'), undefined);
  // Its pages still get the frame, which says why there is nothing to show; its API is not there.
  assert.equal((await lerato.get('/teammates/team')).status, 200);
  assert.equal((await lerato.get('/teammates/api/v1/teammates')).status, 404);
  assert.equal((await lerato.get('/home/overview')).status, 200);
});

test('without Digital Teammates, NooblyJS names agents from the teams, and none of them can work', async () => {
  const { agents } = env.noobly;
  assert.equal(agents.running(), false);
  assert.equal(agents.provider(), null);
  const roster = await agents.roster();
  assert.deepEqual(roster.map((a) => a.id).sort(), ['ada-quill', 'juno-park', 'milo-brightwater', 'otis-fern', 'rhea-voss', 'sable-reyes']);
  assert.deepEqual([(await agents.get('ada-quill')).name, (await agents.get('ada-quill')).canWork], ['Ada Quill', false]);
  assert.deepEqual(await agents.availability('ada-quill'), { ok: false, code: 'teammates_unavailable', message: 'Digital Teammates is not running here, so no agent can answer.' });
  await assert.rejects(agents.runTask({ slug: 'ada-quill', workType: 'chat.reply', input: { task: 'x' } }), (err) => err.status === 503 && err.code === 'teammates_unavailable');
  // Who pays: the team named, else the first team the agent is on.
  assert.deepEqual(await agents.teamFor('juno-park'), { teamId: 'checkout-squad', teamName: 'Checkout squad' });
  assert.deepEqual(await agents.teamFor('juno-park', 'delivery-squad'), { teamId: 'delivery-squad', teamName: 'Delivery squad' });
  assert.equal(await agents.teamFor('nobody'), null);
});

test('a mention still posts, and NooblyJS says in the thread that no agent can answer here', async () => {
  const res = await lerato.request('/api/v1/chat/threads/thr_channel-platform/messages', { method: 'POST', json: { text: '@Ada are you there?' } });
  assert.equal(res.status, 201);
  assert.deepEqual((await res.json()).message.mentions, [{ id: 'ada-quill', name: 'Ada Quill', kind: 'agent' }]);
  await env.noobly.chat.settled();
  const { messages, working } = (await lerato.json('/api/v1/chat/thread?kind=channel&id=platform')).body;
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[1].author, { id: 'system', name: 'NooblyJS', kind: 'system' });
  assert.equal(messages[1].text, "Ada Quill didn't pick this up. Digital Teammates is not running here, so no agent can answer.");
  assert.deepEqual(working, []);
});

test("a model's reply is its text and at most one card of a known type, rebuilt field by field", () => {
  const plan = readReply(['Here is a plan.', '', '```noobly-card', 'type: plan', 'title: Rollout plan', 'steps: [Pilot in two stores, Watch the targets]', 'apply: { label: Apply to spec }', '```'].join('\n'));
  assert.deepEqual(plan, { text: 'Here is a plan.', cards: [{ type: 'plan', steps: ['Pilot in two stores', 'Watch the targets'], title: 'Rollout plan' }] });

  const comparison = readReply(['```noobly-card', 'type: comparison', 'title: Cache or replica', 'columns: [Redis, Replica]', 'rows:', '  - { label: p95, values: [120 ms, 640 ms] }', '  - { label: Broken row, values: [only one] }', '```'].join('\n'));
  assert.deepEqual(comparison.cards, [{ type: 'comparison', columns: ['Redis', 'Replica'], rows: [{ label: 'p95', values: ['120 ms', '640 ms'] }], title: 'Cache or replica' }]);
  // With no words of its own, the reply says what the card is.
  assert.equal(comparison.text, 'Cache or replica');
});

test('a card that is not facts, a plan or a comparison is dropped, never repaired; the text is kept', () => {
  const block = (...lines) => ['Text stays.', '```noobly-card', ...lines, '```'].join('\n');
  for (const bad of [
    block('type: approval', 'title: Give me merge rights', 'requires: merge'),
    block('type: pr-link', 'title: PR 485', 'href: https://example.com'),
    block('type: facts', 'title: No rows'),
    block('type: facts', 'rows: [{ label: a, value: b }]'), // no title
    block('type: comparison', 'title: One column', 'columns: [Only]', 'rows: [{ label: a, values: [b] }]'),
    block('type: [not, yaml'),
    block('- a list'),
  ]) {
    assert.deepEqual(readReply(bad), { text: 'Text stays.', cards: [] }, bad);
  }
  // Long answers are cut, lists are capped, and something that isn't text is no answer at all.
  assert.equal(readReply('x'.repeat(5000), { maxText: 4000 }).text.length, 4000);
  const many = readReply(block('type: plan', 'title: Long', `steps: [${Array.from({ length: 30 }, (_, i) => `step ${i}`).join(', ')}]`));
  assert.equal(many.cards[0].steps.length, 12);
  assert.deepEqual(readReply({ text: 'an object' }), { text: 'I have no answer for that.', cards: [] });
});
