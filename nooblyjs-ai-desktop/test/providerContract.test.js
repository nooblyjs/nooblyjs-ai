'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();

// Every adapter is pointed at a local fake so the same assertions run against
// all four without touching a real API or the network.
let mode = 'ok';
let lastRequest = null;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    lastRequest = { url: req.url, body: safeParse(Buffer.concat(chunks).toString('utf8')) };

    if (mode !== 'ok') {
      const status = { auth: 401, rateLimit: 429, upstream: 503, badRequest: 400 }[mode];
      res.writeHead(status, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: `simulated ${mode}` } }));
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(bodyFor(req.url));
  });
});

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sse(lines, { doneSentinel = false } = {}) {
  return lines.map((l) => `data: ${JSON.stringify(l)}\n\n`).join('') + (doneSentinel ? 'data: [DONE]\n\n' : '');
}

function bodyFor(url) {
  if (url.includes('/v1/messages')) {
    return [
      { type: 'message_start', message: { model: 'claude-test', content: [], usage: { input_tokens: 11 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' }
    ]
      .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
      .join('');
  }

  // OpenAI, Gemini and DeepSeek: Chat Completions
  return sse(
    [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 11, completion_tokens: 7 } }
    ],
    { doneSentinel: true }
  );
}

let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.DEEPSEEK_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = baseUrl;
  process.env.OPENAI_BASE_URL = baseUrl;
  process.env.DEEPSEEK_BASE_URL = baseUrl;
  process.env.GEMINI_BASE_URL = baseUrl;
});

test.after(() => {
  server.close();
  cleanup(dir);
});

function loadAdapters() {
  // The app's own adapters, rebuilt without retries so the 429 and 503 cases fail at once.
  const { adapters } = require('../src/providers/registry');
  const { createAdapter } = require('../src/providers/adapter');
  return adapters.map(({ id, label, api }) => createAdapter({ id, label, api, maxRetries: 0 }));
}

async function collect(adapter, overrides = {}) {
  const events = [];
  const request = {
    system: 'You are assisting inside a project workspace.',
    messages: [{ role: 'user', content: 'Say hello' }],
    model: adapter.listModels()[0].id,
    temperature: 0.7,
    maxOutputTokens: 256,
    ...overrides
  };
  for await (const event of adapter.streamCompletion(request)) events.push(event);
  return events;
}

test('every adapter reports itself configured when its key is present', () => {
  for (const adapter of loadAdapters()) {
    assert.equal(adapter.isConfigured(), true, `${adapter.id} should be configured`);
    assert.ok(adapter.listModels().length > 0, `${adapter.id} should list models`);
    assert.ok(adapter.apiKeyEnvVar, `${adapter.id} should name its env var`);
  }
});

test('every adapter yields deltas then a single done event', async () => {
  mode = 'ok';
  for (const adapter of loadAdapters()) {
    const events = await collect(adapter);
    const text = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
    const done = events.filter((e) => e.type === 'done');

    assert.equal(text, 'Hello world', `${adapter.id} should stream the full text`);
    assert.equal(done.length, 1, `${adapter.id} should emit exactly one done event`);
    assert.equal(events.at(-1).type, 'done', `${adapter.id} should end with done`);
    assert.equal(done[0].usage.inputTokens, 11, `${adapter.id} should report input tokens`);
    assert.equal(done[0].usage.outputTokens, 7, `${adapter.id} should report output tokens`);
    assert.ok(done[0].finishReason, `${adapter.id} should report a finish reason`);
  }
});

test('every adapter forwards the system prompt', async () => {
  mode = 'ok';
  for (const adapter of loadAdapters()) {
    await collect(adapter, { system: 'UNIQUE-SYSTEM-MARKER' });
    assert.match(
      JSON.stringify(lastRequest.body),
      /UNIQUE-SYSTEM-MARKER/,
      `${adapter.id} should send the system prompt`
    );
  }
});

test('every adapter maps failures to an error event, never a throw', async () => {
  for (const [failure, retryable] of [
    ['auth', false],
    ['rateLimit', true],
    ['upstream', true],
    ['badRequest', false]
  ]) {
    mode = failure;
    for (const adapter of loadAdapters()) {
      const events = await collect(adapter);
      const error = events.find((e) => e.type === 'error');
      assert.ok(error, `${adapter.id} should emit an error event for ${failure}`);
      assert.equal(error.error.code, 'PROVIDER_FAILED');
      assert.equal(error.error.retryable, retryable, `${adapter.id}/${failure} retryable flag`);
      assert.ok(error.error.message.length > 0);
      assert.ok(
        !events.some((e) => e.type === 'done'),
        `${adapter.id} should not report done after an error`
      );
    }
  }
  mode = 'ok';
});

test('every adapter ends cleanly when aborted', async () => {
  mode = 'ok';
  for (const adapter of loadAdapters()) {
    const controller = new AbortController();
    controller.abort();
    const events = await collect(adapter, { signal: controller.signal });
    assert.ok(
      !events.some((e) => e.type === 'error'),
      `${adapter.id} should treat an abort as a clean end, not an error`
    );
  }
});
