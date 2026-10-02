import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, buildRequest, createAnthropicProvider } from '../src/providers/anthropic.js';
import { collect, readFixture } from './helpers.js';

const params = {
  apiKey: 'sk-test',
  model: 'claude-opus-5-5',
  system: 'be nice',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 100,
};

test('buildRequest sets the required headers and a streaming body', () => {
  const { url, init } = buildRequest({ ...params, fallbacks: false });
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['x-api-key'], 'sk-test');
  assert.equal(init.headers['anthropic-version'], '2023-06-01');
  assert.equal(init.headers['anthropic-beta'], undefined);
  assert.deepEqual(JSON.parse(init.body), {
    model: 'claude-opus-5-5',
    max_tokens: 100,
    system: 'be nice',
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
  });
});

test('buildRequest includes tools only when there are some', () => {
  const tools = [{ name: 'Read', description: 'd', input_schema: { type: 'object' } }];
  assert.deepEqual(JSON.parse(buildRequest({ ...params, tools }).init.body).tools, tools);
  assert.equal(JSON.parse(buildRequest({ ...params, tools: [] }).init.body).tools, undefined);
});

test('stream assembles a tool_use block from streamed JSON pieces', async () => {
  const sse = [
    '{"type":"message_start","message":{"model":"m","content":[],"usage":{"input_tokens":5}}}',
    '{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"Read","input":{}}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"file_pa"}}',
    '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"th\\": \\"a.txt\\"}"}}',
    '{"type":"content_block_stop","index":0}',
    '{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}',
  ]
    .map((data) => `data: ${data}\n\n`)
    .join('');
  const fetchImpl = async () => new Response(sse, { status: 200 });
  const provider = createAnthropicProvider({ apiKey: 'sk-test', fetchImpl });
  const { message } = (await collect(provider.stream(params))).at(-1);

  assert.equal(message.stop_reason, 'tool_use');
  assert.deepEqual(message.content, [{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.txt' } }]);
});

test('buildRequest adds the fallback beta header and field when enabled', () => {
  const { init } = buildRequest({ ...params, fallbacks: true });
  assert.equal(init.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(JSON.parse(init.body).fallbacks, 'default');
});

test('stream yields text as it arrives and ends with the assembled message', async () => {
  const fetchImpl = async () => new Response(readFixture('text-reply.sse'), { status: 200 });
  const provider = createAnthropicProvider({ apiKey: 'sk-test', fetchImpl });
  const events = await collect(provider.stream(params));

  assert.deepEqual(
    events.map((e) => e.type),
    ['message_start', 'text_delta', 'text_delta', 'message'],
  );
  const { message } = events.at(-1);
  assert.equal(message.stop_reason, 'end_turn');
  assert.deepEqual(message.usage, { input_tokens: 25, output_tokens: 12 });
  // Every block is kept, including the thinking block with its signature.
  assert.deepEqual(message.content, [
    { type: 'thinking', thinking: '', signature: 'sig123' },
    { type: 'text', text: 'Héllo, wörld ✻' },
  ]);
});

test('stream throws ApiError with the API error type, message and retry-after', async () => {
  const body = { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } };
  const fetchImpl = async () => new Response(JSON.stringify(body), { status: 429, headers: { 'retry-after': '7' } });
  const provider = createAnthropicProvider({ apiKey: 'sk-test', fetchImpl });
  await assert.rejects(collect(provider.stream(params)), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 429);
    assert.equal(error.type, 'rate_limit_error');
    assert.equal(error.message, 'slow down');
    assert.equal(error.retryAfterMs, 7000);
    return true;
  });
});

test('an error event in the middle of the stream becomes an ApiError', async () => {
  const sse =
    'event: message_start\ndata: {"type":"message_start","message":{"model":"m","content":[],"usage":{}}}\n\n' +
    'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
  const fetchImpl = async () => new Response(sse, { status: 200 });
  const provider = createAnthropicProvider({ apiKey: 'sk-test', fetchImpl });
  await assert.rejects(collect(provider.stream(params)), { name: 'ApiError', type: 'overloaded_error' });
});
