'use strict';

// A whole turn through the app's real adapters: the route → the registry → the
// adapter → nooblyjs-ai-common → HTTP, against a local fake of each provider's
// API. (streaming.test.js covers the route with mock adapters instead.)

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const request = require('supertest');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();

const received = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    received.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (req.url === '/v1/messages') {
      const events = [
        { type: 'message_start', message: { model: 'claude-opus-5', content: [], usage: { input_tokens: 20, cache_read_input_tokens: 5 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
        { type: 'message_stop' }
      ];
      return res.end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
    }
    const chunk = (data) => `data: ${JSON.stringify(data)}\n\n`;
    res.end(
      chunk({ model: 'gemini-2.5-pro', choices: [{ index: 0, delta: { content: 'Hello' } }] }) +
        chunk({ model: 'gemini-2.5-pro', choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }] }) +
        chunk({ model: 'gemini-2.5-pro', choices: [], usage: { prompt_tokens: 25, completion_tokens: 7 } }) +
        'data: [DONE]\n\n'
    );
  });
});

let app;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-key';
  process.env.ANTHROPIC_BASE_URL = base;
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  process.env.GEMINI_BASE_URL = base;

  const { bootstrap } = require('../src/storage/bootstrap');
  const { createApp } = require('../src/app');
  await bootstrap();
  app = createApp();
});

test.after(() => {
  server.close();
  cleanup(dir);
});

function parseEvents(text) {
  return text
    .split('\n\n')
    .filter((f) => f.trim() && !f.startsWith(':'))
    .map((frame) => ({ name: /event: (.+)/.exec(frame)?.[1], data: JSON.parse(/data: (.+)/s.exec(frame)?.[1] ?? 'null') }));
}

async function turn(provider) {
  const project = (await request(app).post('/api/projects').send({ name: 'E2E', description: 'PROJECT-CONTEXT-MARKER' })).body.project;
  const chat = (await request(app).post(`/api/projects/${project.id}/chats`).send({})).body.chat;
  received.length = 0;
  const res = await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'hello there', provider })
    .expect(200);
  return { events: parseEvents(res.text), sent: received[0] };
}

test('a Claude turn streams through the real Anthropic adapter', async () => {
  const { events, sent } = await turn('anthropic');
  const text = events.filter((e) => e.name === 'delta').map((e) => e.data.text).join('');
  const done = events.find((e) => e.name === 'done');

  assert.equal(text, 'Hello world');
  assert.equal(events.some((e) => e.name === 'error'), false);
  assert.equal(done.data.usage.inputTokens, 25, 'cached prompt tokens count as input too');
  assert.equal(done.data.usage.outputTokens, 7);
  assert.equal(done.data.finishReason, 'end_turn');

  assert.equal(sent.url, '/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'anthropic-test-key');
  assert.equal(sent.headers['anthropic-beta'], undefined, 'no server-side fallbacks');
  assert.equal(sent.body.model, 'claude-opus-5');
  assert.equal('temperature' in sent.body, false, 'Opus 5 rejects a temperature');
  assert.equal(sent.body.max_tokens, 4096);
  assert.match(JSON.stringify(sent.body.system), /PROJECT-CONTEXT-MARKER/);
});

test('a Gemini turn streams through its OpenAI-compatible endpoint', async () => {
  const { events, sent } = await turn('gemini');
  const text = events.filter((e) => e.name === 'delta').map((e) => e.data.text).join('');
  const done = events.find((e) => e.name === 'done');

  assert.equal(text, 'Hello world');
  assert.equal(done.data.usage.inputTokens, 25);
  assert.equal(done.data.usage.outputTokens, 7);

  assert.equal(sent.url, '/chat/completions');
  assert.equal(sent.headers.authorization, 'Bearer gemini-test-key');
  assert.equal(sent.body.model, 'gemini-2.5-pro');
  assert.equal(sent.body.temperature, 0.7);
  assert.equal(sent.body.max_tokens, 4096);
  assert.equal(sent.body.messages[0].role, 'system');
  assert.match(sent.body.messages[0].content, /PROJECT-CONTEXT-MARKER/);
});
