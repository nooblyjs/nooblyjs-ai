// A whole task through the real Anthropic adapter (nooblyjs-ai-common underneath), against a
// local fake of the Messages API: the task, the memory reflection after it, and the cost.
// The other tests use the offline mock provider instead.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { AnthropicProvider } from '../src/providers/anthropic.js';
import { startApp } from './helpers.js';

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
