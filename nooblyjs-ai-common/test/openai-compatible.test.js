import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOpenAIRequest, createOpenAICompatibleProvider, toOpenAIMessages, toOpenAITools } from '../src/providers/openai-compatible.js';
import { collect } from './helpers.js';

const sse = (...chunks) => chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join('');
const chunk = (delta, extra = {}) => ({ model: 'grok-4.7', choices: [{ index: 0, delta, finish_reason: null }], ...extra });
const finish = (reason) => ({ model: 'grok-4.7', choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const usage = (prompt, completion, cached = 0) => ({
  model: 'grok-4.7',
  choices: [],
  usage: { prompt_tokens: prompt, completion_tokens: completion, prompt_tokens_details: { cached_tokens: cached } },
});

test('our history is translated to OpenAI messages', () => {
  const history = [
    { role: 'user', content: 'read a.txt' },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '', signature: 'x' },
        { type: 'text', text: 'Reading.' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.txt' } },
        { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'b.txt' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: '1\thello' },
        { type: 'tool_result', tool_use_id: 't2', content: 'File not found', is_error: true },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
  ];

  assert.deepEqual(toOpenAIMessages('be nice', history), [
    { role: 'system', content: 'be nice' },
    { role: 'user', content: 'read a.txt' },
    {
      role: 'assistant',
      content: 'Reading.',
      tool_calls: [
        { id: 't1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"a.txt"}' } },
        { id: 't2', type: 'function', function: { name: 'Read', arguments: '{"file_path":"b.txt"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 't1', content: '1\thello' },
    { role: 'tool', tool_call_id: 't2', content: 'Error: File not found' },
    { role: 'assistant', content: 'Done.' },
  ]);
});

test('an assistant message with only tool calls has null content', () => {
  const [message] = toOpenAIMessages('', [{ role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'X', input: {} }] }]);
  assert.equal(message.content, null);
});

test('tools become OpenAI function tools', () => {
  const schema = { type: 'object', properties: {} };
  assert.deepEqual(toOpenAITools([{ name: 'Read', description: 'd', input_schema: schema }]), [
    { type: 'function', function: { name: 'Read', description: 'd', parameters: schema } },
  ]);
});

test('buildOpenAIRequest uses a Bearer token, streaming and usage reporting', () => {
  const { url, init } = buildOpenAIRequest({
    baseUrl: 'https://api.x.ai/v1',
    apiKey: 'xai-test',
    model: 'grok-4.7',
    system: 's',
    messages: [{ role: 'user', content: 'hi' }],
    tools: [],
    maxTokens: 100,
  });
  assert.equal(url, 'https://api.x.ai/v1/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer xai-test');
  const body = JSON.parse(init.body);
  assert.equal(body.stream, true);
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal(body.max_completion_tokens, 100);
  assert.equal(body.tools, undefined);
});

test('streamed chunks become our events and an Anthropic-shaped message', async () => {
  const body = sse(
    chunk({ role: 'assistant', content: '' }),
    chunk({ content: 'Let me ' }),
    chunk({ content: 'look.' }),
    chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Read', arguments: '' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '{"file_' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: 'path":"a.txt"}' } }] }),
    finish('tool_calls'),
    usage(120, 30, 20),
    '[DONE]',
  );
  const provider = createOpenAICompatibleProvider({
    name: 'grok',
    baseUrl: 'https://api.x.ai/v1',
    apiKey: 'k',
    fetchImpl: async () => new Response(body, { status: 200 }),
  });
  const events = await collect(provider.stream({ model: 'grok-4.7', system: '', messages: [{ role: 'user', content: 'hi' }] }));

  assert.deepEqual(events.map((e) => e.type), ['message_start', 'text_delta', 'text_delta', 'message']);
  assert.deepEqual(events.at(-1).message, {
    model: 'grok-4.7',
    content: [
      { type: 'text', text: 'Let me look.' },
      { type: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'a.txt' } },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 30, cache_read_input_tokens: 20 },
  });
});

test('finish reasons map to our stop reasons', async () => {
  for (const [reason, expected] of [['stop', 'end_turn'], ['length', 'max_tokens'], ['content_filter', 'refusal']]) {
    const provider = createOpenAICompatibleProvider({
      name: 'openai',
      baseUrl: 'x',
      apiKey: 'k',
      fetchImpl: async () => new Response(sse(chunk({ content: 'x' }), finish(reason), '[DONE]')),
    });
    const { message } = (await collect(provider.stream({ model: 'm', messages: [] }))).at(-1);
    assert.equal(message.stop_reason, expected);
  }
});

test('both error formats give a readable ApiError', async () => {
  const cases = [
    [{ error: { message: 'Incorrect API key provided', type: 'invalid_request_error' } }, 401, 'invalid_request_error'],
    [{ code: 'invalid-argument', error: 'Incorrect API key provided. (xAI style)' }, 400, 'invalid-argument'],
  ];
  for (const [json, status, type] of cases) {
    const provider = createOpenAICompatibleProvider({
      name: 'p',
      baseUrl: 'x',
      apiKey: 'k',
      fetchImpl: async () => new Response(JSON.stringify(json), { status }),
    });
    await assert.rejects(collect(provider.stream({ model: 'm', messages: [] })), (error) => {
      assert.equal(error.name, 'ApiError');
      assert.equal(error.status, status);
      assert.equal(error.type, type);
      assert.match(error.message, /Incorrect API key provided/);
      return true;
    });
  }
});
