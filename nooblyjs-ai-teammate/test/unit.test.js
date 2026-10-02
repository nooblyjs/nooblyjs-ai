import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { FsStore, parseMarkdown, serializeMarkdown, StoreError } from '../src/store/fs-store.js';
import { parseTable, renderTable } from '../src/store/md-table.js';
import { periodRange, isoWeek, startOfWeek } from '../src/util/dates.js';
import { InvocationService } from '../src/services/invocation.js';

test('markdown front matter round-trips and keeps dates as strings', () => {
  const text = serializeMarkdown({ id: 'ada', hiredAt: '2026-03-14', rate: 48, traits: ['a', 'b'] }, '# Persona\n\nHello');
  const { data, body } = parseMarkdown(text);
  assert.deepEqual(data, { id: 'ada', hiredAt: '2026-03-14', rate: 48, traits: ['a', 'b'] });
  assert.equal(body.trim(), '# Persona\n\nHello');
});

test('store rejects path traversal and odd segments', async () => {
  const store = new FsStore(await fs.mkdtemp(path.join(os.tmpdir(), 'tm-')));
  for (const bad of ['..', '../x', 'a/b', '.hidden', '']) {
    assert.throws(() => store.resolve(['teammates', bad]), StoreError);
  }
});

test('store serializes concurrent read-modify-write on the same file', async () => {
  const store = new FsStore(await fs.mkdtemp(path.join(os.tmpdir(), 'tm-')));
  await store.writeDoc(['counter.md'], { n: 0 });
  await Promise.all(Array.from({ length: 25 }, () => store.updateDoc(['counter.md'], (d) => ({ data: { n: d.data.n + 1 } }))));
  assert.equal((await store.readDoc(['counter.md'])).data.n, 25);
});

test('markdown tables escape pipes and newlines', () => {
  const rows = [{ id: '1', task: 'a | b\nc', amount: '5' }];
  const parsed = parseTable(renderTable(['id', 'task', 'amount'], rows));
  assert.deepEqual(parsed, [{ id: '1', task: 'a | b c', amount: '5' }]);
});

test('billing periods', () => {
  assert.deepEqual(periodRange('month', 0, '2026-10-01'), { period: 'month', offset: 0, start: '2026-10-01', end: '2026-10-31', label: 'October' });
  assert.equal(periodRange('month', -1, '2026-10-01').label, 'September');
  assert.deepEqual(periodRange('quarter', -1, '2026-10-01'), { period: 'quarter', offset: -1, start: '2026-07-01', end: '2026-09-30', label: 'Q3 2026' });
  assert.equal(periodRange('week', 0, '2026-10-01').start, '2026-09-28');
  assert.equal(startOfWeek('2026-10-04'), '2026-09-28');
  assert.equal(isoWeek('2026-10-01'), 40);
});

test('billable hours round up to the billing increment', () => {
  const billing = { tokensPerHour: 300000, billingIncrementHours: 0.1 };
  assert.equal(InvocationService.billableHours(500, billing), 0.1);
  assert.equal(InvocationService.billableHours(300000, billing), 1);
  assert.equal(InvocationService.billableHours(300001, billing), 1.1);
  assert.equal(InvocationService.apiCost({ inputTokens: 1e6, outputTokens: 1e6, cacheReadTokens: 0, cacheWriteTokens: 0 }, { input: 4, output: 20 }), 24);
});

test('Anthropic adapter caches the persona, sets effort/fallbacks and normalizes usage', async () => {
  const { AnthropicProvider } = await import('../src/providers/anthropic.js');
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
  const { AnthropicProvider } = await import('../src/providers/anthropic.js');
  let headers;
  const fetchImpl = async (url, init) => {
    headers = init.headers;
    return new Response('', { status: 200 });
  };
  await new AnthropicProvider({ env: { ANTHROPIC_AUTH_TOKEN: 'tok' }, fetchImpl }).run({ model: { modelId: 'claude-haiku-4-5' }, system: 's', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(headers.authorization, 'Bearer tok');
  assert.equal(headers['x-api-key'], undefined);
});
