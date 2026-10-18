// services/providers/anthropic.js: the adapter's requests and usage, and a whole task through it against a
// local fake of the Messages API. The other tests use the offline mock provider.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startApp } from '../../helpers.js';
import { AnthropicProvider } from '../../../src/services/providers/anthropic.js';

const requests = [];
const fake = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw);
    requests.push({ url: req.url, headers: req.headers, body });
    const reflecting = JSON.stringify(body.system).includes('long-term memory');
    const text = reflecting ? '[{"kind":"fact","text":"The CRM export uses fuzzy company names."}]' : 'Normalise names, then match on domain.';
    const usage = reflecting ? { input: 100_000, output: 20_000 } : { input: 1_000_000, output: 200_000 };
    const events = [
      { type: 'message_start', message: { model: body.model, content: [], usage: { input_tokens: usage.input } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: usage.output } },
    ];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
  });
});

let app;
before(async () => {
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const anthropic = new AnthropicProvider({ apiKey: 'sk-test', baseUrl: `http://127.0.0.1:${fake.address().port}`, env: {} });
  app = await startApp({ providers: { get: () => anthropic, describe: () => 'anthropic' } });
});
after(async () => {
  await app.close();
  fake.close();
});

test('Anthropic adapter caches the persona, sets effort/fallbacks and normalizes usage', async () => {
  const { AnthropicProvider } = await import('../../../src/services/providers/anthropic.js');
  const calls = [];
  const sse = (...events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    return new Response(
      sse(
        { type: 'message_start', message: { model: body.model, content: [], usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_details: null }, usage: { output_tokens: 5 } },
      ),
      { status: 200 },
    );
  };
  const provider = new AnthropicProvider({ apiKey: 'sk-test', env: {}, fetchImpl });
  const deltas = [];
  const result = await provider.run({
    model: { modelId: 'claude-opus-5-5', maxTokens: 64000, effort: 'high', fallbacks: true },
    system: 'You are Ada', context: 'memory', messages: [{ role: 'user', content: 'hi' }], onText: (t) => deltas.push(t),
  });
  const { url, headers, body: p } = calls[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(headers['x-api-key'], 'sk-test');
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.max_tokens, 64000);
  assert.deepEqual(p.system[0], { type: 'text', text: 'You are Ada', cache_control: { type: 'ephemeral' } });
  assert.deepEqual(p.system[1], { type: 'text', text: 'memory' });
  assert.deepEqual(p.messages, [{ role: 'user', content: 'hi' }], 'only the persona is cached');
  assert.deepEqual(p.output_config, { effort: 'high' });
  assert.equal(p.fallbacks, 'default');
  assert.equal(headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(p.thinking, undefined);
  assert.equal(result.text, 'Hello');
  assert.deepEqual(deltas, ['Hello']);
  assert.equal(result.servedBy, 'claude-opus-5-5');
  assert.equal(result.stopReason, 'end_turn');
  assert.equal(result.content.length, 2, 'thinking blocks are kept for the tool loop');
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 });

  await provider.run({ model: { modelId: 'claude-haiku-4-5' }, system: 's', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(calls[1].body.output_config, undefined);
  assert.equal(calls[1].body.fallbacks, undefined);
  assert.equal(calls[1].headers['anthropic-beta'], undefined);
  assert.equal(calls[1].body.max_tokens, 16000);
});

test('Anthropic adapter signs in with ANTHROPIC_AUTH_TOKEN when there is no API key', async () => {
  const { AnthropicProvider } = await import('../../../src/services/providers/anthropic.js');
  let headers;
  const fetchImpl = async (url, init) => {
    headers = init.headers;
    return new Response('', { status: 200 });
  };
  await new AnthropicProvider({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' }, fetchImpl }).run({ model: { modelId: 'claude-haiku-4-5' }, system: 's', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(headers.authorization, 'Bearer tok');
  assert.equal(headers['x-api-key'], undefined);
});

test('a task runs on Claude through the real adapter, writes memory and records the API cost', async () => {
  const result = await app.invocation.assign('otis-fern', { task: 'How do I deduplicate a CRM export?' });

  assert.equal(result.output, 'Normalise names, then match on domain.');
  assert.equal(result.stopReason, 'end_turn');
  assert.deepEqual(result.memoriesAdded.map((m) => m.text), ['The CRM export uses fuzzy company names.']);
  // Haiku at $1 in / $5 out per million: the task ($1 + $1) plus the reflection ($0.10 + $0.10).
  assert.equal(result.apiCost, 2.2);

  const [task, reflection] = requests;
  assert.equal(task.url, '/v1/messages');
  assert.equal(task.headers['x-api-key'], 'sk-test');
  assert.equal(task.body.model, 'claude-haiku-4-5');
  assert.equal(task.body.system[0].cache_control.type, 'ephemeral', 'the persona is cached');
  assert.match(JSON.stringify(task.body.messages), /deduplicate a CRM export/);
  assert.equal(reflection.body.max_tokens, 1024);

  const work = await app.repos.work.get('otis-fern', result.workId);
  assert.equal(work.servedBy, 'claude-haiku-4-5');
});
