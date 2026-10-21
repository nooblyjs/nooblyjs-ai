// Phase 24 in the real app (mocking audit A6, security audit S-08): the wiki's own AI agents are teammate tasks. An
// agent configured in the wiki's Agents screen points at a provider of its own; hosted, nothing reaches it. Its prompts
// run as Ada Quill's tasks through Teammates (checked by Platform, recorded, audited for the person asking), and with
// no model configured in Teammates the AI panel answers from the sources, as without an agent.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApp, today, eventually } from './helpers.js';

let env;
let stevie;
let lerato;
let provider;
let hits = 0;
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });

before(async () => {
  // The agent's own provider: it counts what reaches it, and nothing should.
  provider = http.createServer((req, res) => { hits += 1; res.writeHead(500).end(); });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  env = await startApp({
    hostedApps: [
      { package: 'nooblyjs-ai-product', mountPath: '/product', enabled: true },
      { package: 'nooblyjs-ai-design', mountPath: '/design', enabled: true },
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: true },
      { package: 'nooblyjs-ai-teammate', mountPath: '/teammates', enabled: true },
      { package: 'nooblyjs-ai-knowledge', mountPath: '/wiki', enabled: true },
    ],
  });
  [stevie, lerato] = [env.client(), env.client()];
  await stevie.signIn('stevie');
  await lerato.signIn('lerato-m');
});
after(async () => {
  await env?.stop();
  await new Promise((resolve) => provider.close(resolve));
});

test('a wiki agent with a provider of its own: its prompt runs as a teammate task for the person asking, never at the provider', async () => {
  const baseUrl = `http://127.0.0.1:${provider.address().port}`;
  const made = await post(stevie, '/wiki/api/v1/ds/agents', { name: 'Chat Processing', provider: 'ollama', usage: ['Chat Processing'], options: { baseUrl, model: 'tinyllama:1.1b' } });
  assert.equal(made.status, 201);

  // The Prompts screen's test: the prompt goes to Teammates. No model is configured there, so it has no answer.
  const res = await post(lerato, '/wiki/api/v1/ds/prompts/test', { content: 'You answer from the sources.', input: 'How is slot capacity calculated?' });
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /No model is configured for the wiki's agents in NooblyJS \(ada-quill answers offline\)/);

  await eventually(async () => {
    const finished = (await today(env.store, 'events')).filter((e) => e.type === 'teammate.task_finished' && e.payload?.system === 'knowledge');
    assert.equal(finished.length, 1);
    assert.deepEqual([finished[0].payload.teammateId, finished[0].payload.workType, finished[0].payload.scripted], ['ada-quill', 'knowledge.chat-processing', true]);
    const audit = (await today(env.store, 'audit')).filter((a) => a.action === 'agent.knowledge.chat-processing');
    assert.equal(audit.length, 1);
    assert.deepEqual([audit[0].actor, audit[0].requestedBy, audit[0].system], ['ada-quill', 'lerato-m', 'knowledge']);
  });
  assert.equal(hits, 0, 'nothing reached the agent\'s own provider');
});

test('the AI panel, with that agent and no model in Teammates, answers from the sources and says no model wrote it', async () => {
  const res = await post(lerato, '/wiki/api/v1/ai/chat/search', { message: 'How is slot capacity calculated?' });
  assert.equal(res.status, 200);
  const answer = await res.json();
  assert.match(answer.response, /^No model is configured here/);
  assert.equal(answer.sources.length, 3);
  assert.equal(hits, 0);
});
