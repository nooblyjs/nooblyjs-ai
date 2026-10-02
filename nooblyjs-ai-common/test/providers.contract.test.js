// The provider contract: every catalogue provider, whichever API it speaks, must
// behave the same way to the app. Each one is pointed at one local fake server
// that speaks all three API styles, so no test touches a real API.
// Grown from nooblyjs-ai-desktop's providerContract test.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { ApiError, explainError } from '../src/errors.js';
import { PROVIDERS } from '../src/models.js';
import { EVENT, complete, createMockProvider, createProvider } from '../src/providers/index.js';
import { isRetryable } from '../src/retry.js';
import { collect } from './helpers.js';

// ── The fake server ──────────────────────────────────────────────────────

/** What the next requests get: { text?, tool?, usage? } replies, or { status, retryAfter? } failures, or { hang: true }. */
let queue = [];
/** Every request received: { url, headers, body }. */
let requests = [];
let baseUrl;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') });
    const reply = queue.shift() ?? { text: 'Hello world' };
    if (reply.status) {
      res.writeHead(reply.status, { 'content-type': 'application/json', ...(reply.retryAfter && { 'retry-after': String(reply.retryAfter) }) });
      return res.end(JSON.stringify({ error: { type: 'test_error', message: `simulated ${reply.status}` } }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const events = streamFor(req.url, reply);
    if (!reply.hang) return res.end(events.join(''));
    res.write(events.slice(0, 3).join('')); // the start of a reply, then nothing: the client must abort
    req.on('close', () => res.end());
  });
});

/** A reply in the wire format of whichever API was called. */
function streamFor(url, { text = '', tool, usage = { input: 11, output: 7 } }) {
  const pieces = text ? [text.slice(0, 5), text.slice(5)].filter(Boolean) : [];
  const args = tool ? JSON.stringify(tool.input) : '';
  const argPieces = [args.slice(0, 4), args.slice(4)];
  const sse = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

  if (url.endsWith('/v1/messages')) {
    const events = [{ type: 'message_start', message: { id: 'msg_1', model: 'served-model', content: [], usage: { input_tokens: usage.input } } }];
    let index = 0;
    if (text) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
      for (const piece of pieces) events.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
      events.push({ type: 'content_block_stop', index: index++ });
    }
    if (tool) {
      events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: tool.id, name: tool.name, input: {} } });
      for (const piece of argPieces) events.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: piece } });
      events.push({ type: 'content_block_stop', index });
    }
    events.push({ type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: usage.output } });
    events.push({ type: 'message_stop' });
    return events.map(sse);
  }

  if (url.endsWith('/responses')) {
    const events = [{ type: 'response.created', response: { model: 'served-model', status: 'in_progress' } }];
    for (const delta of pieces) events.push({ type: 'response.output_text.delta', item_id: 'msg_1', delta });
    if (tool) {
      events.push({ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: tool.id, name: tool.name, arguments: '' } });
      for (const delta of argPieces) events.push({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta });
      events.push({ type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: tool.id, name: tool.name, arguments: args } });
    }
    events.push({ type: 'response.completed', response: { model: 'served-model', status: 'completed', usage: { input_tokens: usage.input, output_tokens: usage.output } } });
    return events.map(sse);
  }

  // Chat Completions (OpenAI-compatible)
  const chunk = (delta, extra = {}) => `data: ${JSON.stringify({ model: 'served-model', choices: [{ index: 0, delta, ...extra }] })}\n\n`;
  const events = pieces.map((content) => chunk({ content }));
  if (tool) for (const [i, piece] of argPieces.entries()) events.push(chunk({ tool_calls: [{ index: 0, ...(i === 0 && { id: tool.id, function: { name: tool.name } }), function: { ...(i === 0 && { name: tool.name }), arguments: piece } }] }));
  events.push(chunk({}, { finish_reason: tool ? 'tool_calls' : 'stop' }));
  events.push(`data: ${JSON.stringify({ model: 'served-model', choices: [], usage: { prompt_tokens: usage.input, completion_tokens: usage.output } })}\n\n`);
  events.push('data: [DONE]\n\n');
  return events;
}

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// ── The providers under test ─────────────────────────────────────────────

/** Every catalogue provider with a shared adapter, pointed at the fake server. */
const CASES = Object.entries(PROVIDERS)
  .filter(([, info]) => info.api)
  .map(([id, info]) => ({
    id,
    api: info.api,
    // Each one at the fake server's address. OpenAI keeps its own API style there (by default a baseUrl means Chat Completions).
    make: () => createProvider(id, { apiKey: 'test-key', baseUrl: id === 'anthropic' ? baseUrl : `${baseUrl}/v1`, api: info.api, env: {} }),
  }));

const ask = (overrides = {}) => ({
  model: 'some-model',
  system: 'SYSTEM-MARKER',
  messages: [{ role: 'user', content: 'Say hello' }],
  maxTokens: 256,
  ...overrides,
});

const fresh = (...replies) => {
  queue = replies;
  requests = [];
};

test('every catalogue provider with an API style is covered', () => {
  assert.deepEqual(CASES.map((c) => c.id).sort(), ['anthropic', 'deepseek', 'gemini', 'grok', 'ollama', 'openai']);
});

for (const { id, api, make } of CASES) {
  test(`${id}: streams text, then exactly one complete message`, async () => {
    fresh({ text: 'Hello world', usage: { input: 11, output: 7 } });
    const events = await collect(make().stream(ask()));
    assert.equal(events[0].type, EVENT.MESSAGE_START);
    assert.equal(events.filter((e) => e.type === EVENT.TEXT_DELTA).map((e) => e.text).join(''), 'Hello world');
    assert.equal(events.filter((e) => e.type === EVENT.MESSAGE).length, 1);
    assert.equal(events.at(-1).type, EVENT.MESSAGE);
  });

  test(`${id}: complete() gives text, usage, stop reason and the model that answered`, async () => {
    fresh({ text: 'Hello world', usage: { input: 11, output: 7 } });
    const streamed = [];
    const reply = await complete(make(), ask(), { onText: (text) => streamed.push(text) });
    assert.equal(reply.text, 'Hello world');
    assert.equal(streamed.join(''), 'Hello world');
    assert.equal(reply.stopReason, 'end_turn');
    assert.equal(reply.usage.input_tokens, 11);
    assert.equal(reply.usage.output_tokens, 7);
    assert.equal(reply.model, 'served-model');
    assert.deepEqual(reply.toolCalls, []);
  });

  test(`${id}: sends the key, the system prompt, the context and the max-output field`, async () => {
    fresh({ text: 'ok' });
    await complete(make(), ask({ context: 'CONTEXT-MARKER' }));
    const [{ headers, body }] = requests;
    assert.ok(headers['x-api-key'] === 'test-key' || headers.authorization === 'Bearer test-key', 'the API key');
    const sent = JSON.stringify(body);
    assert.match(sent, /SYSTEM-MARKER/);
    assert.match(sent, /CONTEXT-MARKER/);
    assert.match(sent, /Say hello/);
    const field = { anthropic: 'max_tokens', 'openai-responses': 'max_output_tokens' }[api] ?? PROVIDERS[id].tokenParam ?? 'max_completion_tokens';
    assert.equal(body[field], 256, `${field}`);
  });

  test(`${id}: sends a temperature only to models that accept one`, async () => {
    const rejects = id === 'anthropic' ? 'claude-opus-5' : 'gpt-5'; // supportsTemperature: false in the catalogue
    fresh({ text: 'ok' }, { text: 'ok' });
    await complete(make(), ask({ model: 'unlisted-model', temperature: 0.3 }));
    await complete(make(), ask({ model: rejects, temperature: 0.3 }));
    assert.equal(requests[0].body.temperature, 0.3);
    assert.equal('temperature' in requests[1].body, false);
  });

  test(`${id}: a tool call comes back as toolCalls, and its result goes back in the API's own shape`, async () => {
    fresh({ text: 'Let me check.', tool: { id: 'call_1', name: 'Echo', input: { say: 'hi' } } }, { text: 'It said hi.' });
    const tools = [{ name: 'Echo', description: 'Repeat something', input_schema: { type: 'object', properties: { say: { type: 'string' } } } }];
    const provider = make();
    const first = await complete(provider, ask({ tools }));
    assert.equal(first.stopReason, 'tool_use');
    assert.deepEqual(first.toolCalls, [{ id: 'call_1', name: 'Echo', input: { say: 'hi' } }]);

    const messages = [
      ...ask().messages,
      { role: 'assistant', content: first.message.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'echo: hi' }] },
    ];
    const second = await complete(provider, ask({ tools, messages }));
    assert.equal(second.text, 'It said hi.');
    const sent = JSON.stringify(requests[1].body);
    assert.match(sent, /"Echo"/, 'the tool definition');
    assert.match(sent, /call_1/, 'the call id');
    assert.match(sent, /echo: hi/, 'the tool result');
  });

  test(`${id}: failures are ApiErrors that say whether to retry`, async () => {
    for (const [status, retryable] of [[401, false], [400, false], [429, true], [503, true]]) {
      fresh({ status, retryAfter: status === 429 ? 2 : undefined });
      await assert.rejects(collect(make().stream(ask())), (error) => {
        assert.ok(error instanceof ApiError, `${status} is an ApiError`);
        assert.equal(error.status, status);
        assert.equal(isRetryable(error), retryable, `${status} retryable`);
        assert.equal(explainError(error, id)?.retryable, retryable);
        if (status === 429) assert.equal(error.retryAfterMs, 2000);
        return true;
      });
    }
  });

  test(`${id}: aborting mid-reply stops the stream, and explainError calls it a clean stop`, async () => {
    fresh({ text: 'Hello world', hang: true });
    const controller = new AbortController();
    const events = [];
    await assert.rejects(
      (async () => {
        for await (const event of make().stream(ask(), { signal: controller.signal })) {
          events.push(event);
          if (event.type === EVENT.TEXT_DELTA) controller.abort();
        }
      })(),
      (error) => {
        assert.equal(explainError(error, id, controller.signal), null);
        return true;
      },
    );
    assert.equal(events.some((e) => e.type === EVENT.MESSAGE), false);
  });
}

test('complete() retries a temporary failure before anything has streamed', async () => {
  fresh({ status: 503 }, { text: 'Hello world' });
  const retries = [];
  const reply = await complete(CASES[0].make(), ask(), { onEvent: (e) => e.type === EVENT.RETRY && retries.push(e) });
  assert.equal(reply.text, 'Hello world');
  assert.equal(retries.length, 1);
  assert.equal(requests.length, 2);
});

test('complete() gives up on a permanent failure without retrying', async () => {
  fresh({ status: 401 });
  await assert.rejects(complete(CASES[0].make(), ask()), { status: 401 });
  assert.equal(requests.length, 1);
});

test('the mock provider keeps the same contract', async () => {
  const provider = createMockProvider([
    { text: 'Hello world', usage: { input_tokens: 11, output_tokens: 7 } },
    { text: 'Let me check.', tools: [{ id: 'call_1', name: 'Echo', input: { say: 'hi' } }] },
  ]);
  const reply = await complete(provider, ask());
  assert.equal(reply.text, 'Hello world');
  assert.equal(reply.usage.input_tokens, 11);
  assert.equal(reply.stopReason, 'end_turn');
  const second = await complete(provider, ask());
  assert.equal(second.stopReason, 'tool_use');
  assert.deepEqual(second.toolCalls, [{ id: 'call_1', name: 'Echo', input: { say: 'hi' } }]);
  assert.equal(provider.requests.length, 2);
});
