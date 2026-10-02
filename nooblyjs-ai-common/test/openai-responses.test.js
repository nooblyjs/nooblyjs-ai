// The OpenAI Responses API adapter: translation both ways.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProvider } from '../src/providers/index.js';
import { assembleResponse, buildResponsesRequest, toResponsesInput, toResponsesTools } from '../src/providers/openai-responses.js';
import { parseSSE } from '../src/sse.js';
import { collect } from './helpers.js';

/** A Responses API stream: each event has an `event:` line and a JSON `data:` line with the same type. */
const sse = (...events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
const created = (model = 'gpt-6-astra') => ({ type: 'response.created', response: { model, status: 'in_progress' } });
const textDelta = (delta) => ({ type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta });
const completed = (usage = { input_tokens: 50, output_tokens: 10 }, status = 'completed', extra = {}) => ({
  type: status === 'completed' ? 'response.completed' : 'response.incomplete',
  response: { model: 'gpt-6-astra', status, usage, ...extra },
});
const call = (id, callId, name, args) => [
  { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id, call_id: callId, name, arguments: '' } },
  ...args.map((delta) => ({ type: 'response.function_call_arguments.delta', item_id: id, output_index: 1, delta })),
  { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id, call_id: callId, name, arguments: args.join('') } },
];

async function assemble(body) {
  const events = [];
  const generator = assembleResponse(parseSSE(new Response(body).body));
  let step;
  while (!(step = await generator.next()).done) events.push(step.value);
  return { events, message: step.value };
}

test('our history becomes Responses input items: messages, function_call and function_call_output', () => {
  const input = toResponsesInput([
    { role: 'user', content: 'read a.txt' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'text', text: 'Reading.' }, { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'a.txt' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'hello' }, { type: 'text', text: '<system-reminder>note</system-reminder>' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call_2', name: 'Bash', input: { command: 'x' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_2', content: 'boom', is_error: true }] },
  ]);
  assert.deepEqual(input, [
    { role: 'user', content: 'read a.txt' },
    { role: 'assistant', content: 'Reading.' },
    { type: 'function_call', call_id: 'call_1', name: 'Read', arguments: '{"file_path":"a.txt"}' },
    { type: 'function_call_output', call_id: 'call_1', output: 'hello' },
    { role: 'user', content: '<system-reminder>note</system-reminder>' },
    { type: 'function_call', call_id: 'call_2', name: 'Bash', arguments: '{"command":"x"}' },
    { type: 'function_call_output', call_id: 'call_2', output: 'Error: boom' },
  ]);
});

test('the request: /responses, instructions, flat function tools, no server-side storage', () => {
  const { url, init } = buildResponsesRequest({
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-6-astra',
    system: 'You are noobly.',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object', properties: {} } }],
    maxTokens: 1000,
    effort: 'high',
  });
  assert.equal(url, 'https://api.openai.com/v1/responses');
  assert.equal(init.headers.authorization, 'Bearer sk-test');
  const body = JSON.parse(init.body);
  assert.deepEqual(body, {
    model: 'gpt-6-astra',
    input: [{ role: 'user', content: 'hi' }],
    stream: true,
    store: false,
    max_output_tokens: 1000,
    instructions: 'You are noobly.',
    tools: [{ type: 'function', name: 'Read', description: 'Read a file', parameters: { type: 'object', properties: {} } }],
    reasoning: { effort: 'high' },
  });
  // Anthropic-only effort values are not sent to OpenAI.
  assert.equal(JSON.parse(buildResponsesRequest({ baseUrl: 'x', model: 'm', messages: [], effort: 'max' }).init.body).reasoning, undefined);
  assert.deepEqual(toResponsesTools([]), []);
});

test('streamed text and function calls become our events and an Anthropic-shaped message', async () => {
  const { events, message } = await assemble(
    sse(created(), textDelta('Let me '), textDelta('look.'), ...call('fc_1', 'call_abc', 'Read', ['{"file_', 'path":"a.txt"}']), completed({ input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100 } })),
  );
  assert.deepEqual(events.map((e) => e.type), ['message_start', 'text_delta', 'text_delta']);
  assert.equal(events[0].model, 'gpt-6-astra');
  assert.deepEqual(message, {
    model: 'gpt-6-astra',
    content: [
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_use', id: 'call_abc', name: 'Read', input: { file_path: 'a.txt' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 100 },
  });
});

test('stop reasons: incomplete → max_tokens or refusal; failures throw', async () => {
  const cut = await assemble(sse(created(), textDelta('Half'), completed(undefined, 'incomplete', { incomplete_details: { reason: 'max_output_tokens' } })));
  assert.equal(cut.message.stop_reason, 'max_tokens');
  const filtered = await assemble(sse(created(), completed(undefined, 'incomplete', { incomplete_details: { reason: 'content_filter' } })));
  assert.equal(filtered.message.stop_reason, 'refusal');
  const done = await assemble(sse(created(), textDelta('Hi'), completed()));
  assert.equal(done.message.stop_reason, 'end_turn');

  await assert.rejects(assemble(sse(created(), { type: 'response.failed', response: { status: 'failed', error: { code: 'server_error', message: 'Something broke' } } })), /Something broke/);
  await assert.rejects(assemble(sse({ type: 'error', code: 'rate_limit_exceeded', message: 'Slow down' })), /Slow down/);
});

test('with a baseUrl (LM Studio, vLLM…) the openai provider keeps using Chat Completions', async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return new Response('data: [DONE]\n\n', { status: 200 });
  };
  const local = createProvider('openai', { apiKey: 'k', baseUrl: 'http://localhost:1234/v1', fetchImpl });
  await collect(local.stream({ model: 'm', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 10 }, {}));
  assert.deepEqual(urls, ['http://localhost:1234/v1/chat/completions']);
});

test('API errors keep their status and message', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }), { status: 401 });
  const provider = createProvider('openai', { apiKey: 'bad', fetchImpl });
  await assert.rejects(collect(provider.stream({ model: 'm', system: '', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 10 }, {})), (error) => {
    assert.equal(error.status, 401);
    assert.match(error.message, /Incorrect API key/);
    return true;
  });
});
