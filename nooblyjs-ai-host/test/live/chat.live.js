// LIVE: this calls a real model and costs a few cents. It is not part of `npm test` (the name doesn't end in
// .test.js); run it with `npm run test:live`, which loads .env. It needs ANTHROPIC_API_KEY, and is skipped without one.
//
// Roadmap Phase 6, step 2, with a provider configured: Lerato asks Ada a new question in the PRD-031 thread, the
// answer is the model's, and Ada's billed time goes up against Delivery squad.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
let env;
let lerato;

before(async () => {
  if (!hasKey) return;
  process.env.AI_PROVIDER = 'anthropic';
  process.env.NODE_ENV = 'development';
  env = await startApp({
    env: { NODE_ENV: 'development' },
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true },
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
    ],
  });
  lerato = env.client();
  await lerato.signIn('lerato-m');
});
after(async () => { await env?.stop(); });

test('live: Ada answers a new question in the PRD-031 thread with a real model, and her time is billed to Delivery squad', { skip: !hasKey && 'no ANTHROPIC_API_KEY', timeout: 180_000 }, async () => {
  assert.equal(env.noobly.agents.provider(), 'anthropic');
  const teammates = env.noobly.hosted.apps.find((a) => a.name === 'teammates').internals;
  const entries = async () => (await teammates.repos.timesheets.listRange('ada-quill', '2000-01-01', '2999-12-31')).filter((e) => e.workId && e.callerType === 'user');
  const before = await entries();

  const res = await lerato.request('/api/v1/chat/threads/thr_PRD-031/messages', { method: 'POST', json: { text: '@Ada in two sentences: what stage is this item in, and who is it waiting on?' } });
  assert.equal(res.status, 201);
  await env.noobly.chat.settled();
  await teammates.invocation.idle();

  const { messages } = (await lerato.json('/api/v1/chat/thread?kind=item&id=PRD-031')).body;
  const reply = messages.at(-1);
  console.log(`\n--- ${reply.author.name} (${reply.modelRoute}, $${reply.costUsd}) ---\n${reply.text}\n${reply.cards?.length ? JSON.stringify(reply.cards, null, 2) : '(no card)'}\n`);
  assert.deepEqual(reply.author, { id: 'ada-quill', name: 'Ada Quill', kind: 'agent' });
  assert.match(reply.modelRoute, /^anthropic\//);
  assert.ok(reply.costUsd > 0, 'a real answer has a model cost');
  assert.ok(reply.text.length > 20);
  assert.doesNotMatch(reply.text, /scripted answer|offline mock/i);

  const after = await entries();
  assert.equal(after.length, before.length + 1);
  const entry = after.at(-1);
  console.log(`timesheet: ${entry.hours}h · $${entry.amount} billed to ${entry.costCentre} · model cost $${entry.apiCost} · ${entry.tokens} tokens\n`);
  assert.deepEqual([entry.costCentre, entry.caller, entry.hours > 0], ['Delivery squad', 'Lerato M.', true]);
  // Nothing about the item changed because an agent spoke.
  const item = (await lerato.json('/workflows/api/v1/items/PRD-031')).body;
  assert.equal((item.item ?? item).stage, 'product');
});
