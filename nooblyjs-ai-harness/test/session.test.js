import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Session } from '../src/core/session.js';
import { ApiError } from '../src/providers/anthropic.js';
import { createMockProvider } from '../src/providers/mock.js';
import { collect } from './helpers.js';

const noRetry = { maxRetries: 0 };

test('each turn resends the whole history (the model is stateless)', async () => {
  const provider = createMockProvider([{ text: 'Hi Sam' }, { text: 'Your name is Sam' }]);
  const session = new Session({ provider });

  await session.send('My name is Sam');
  await session.send('What is my name?');

  assert.equal(provider.requests[0].messages.length, 1);
  assert.deepEqual(
    provider.requests[1].messages.map((m) => m.role),
    ['user', 'assistant', 'user'],
  );
  assert.equal(session.history.length, 4);
});

test('stream yields text deltas that add up to the full reply, then turn_end', async () => {
  const session = new Session({ provider: createMockProvider([{ text: 'Hello there, friend' }]) });
  const events = await collect(session.stream('hi'));
  const deltas = events.filter((e) => e.type === 'text_delta');

  assert.ok(deltas.length > 1);
  assert.equal(deltas.map((e) => e.text).join(''), 'Hello there, friend');
  assert.equal(events.at(-1).type, 'turn_end');
  assert.equal(events.at(-1).text, 'Hello there, friend');
  assert.equal(events.at(-1).interrupted, false);
});

test('usage and cost add up across turns', async () => {
  const session = new Session({ provider: createMockProvider([{ text: 'a' }, { text: 'b' }]), model: 'claude-opus-5-5' });
  await session.send('one');
  await session.send('two');
  assert.equal(session.turns, 2);
  assert.equal(session.usage.input_tokens, 20);
  assert.equal(session.usage.output_tokens, 10);
  assert.ok(session.cost > 0);
});

test('interrupting keeps the partial text in history', async () => {
  const controller = new AbortController();
  const provider = createMockProvider([
    { text: 'This reply will be cut off', onChunk: (i) => i >= 6 && controller.abort() },
  ]);
  const session = new Session({ provider });

  const end = await session.send('go', { signal: controller.signal });

  assert.equal(end.interrupted, true);
  assert.equal(end.text, 'This repl'); // 3-character chunks: 'Thi' 's r' 'epl', then abort
  assert.deepEqual(session.history, [
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'text', text: 'This repl' }] },
  ]);
});

test('interrupting before any text saves nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  const session = new Session({ provider: createMockProvider([{ text: 'never seen' }]) });
  const end = await session.send('go', { signal: controller.signal });
  assert.equal(end.interrupted, true);
  assert.equal(session.history.length, 0);
});

test('an overloaded error is retried and the turn still succeeds', async () => {
  const provider = createMockProvider([new ApiError(529, 'overloaded_error', 'Overloaded'), { text: 'ok' }]);
  const session = new Session({ provider, retry: { sleepFn: async () => {} } });
  const events = await collect(session.stream('hi'));
  assert.equal(events[0].type, 'retry');
  assert.equal(events.at(-1).text, 'ok');
  assert.equal(session.history.length, 2);
});

test('a failed request leaves history unchanged', async () => {
  const provider = createMockProvider([{ text: 'ok' }, new ApiError(400, 'invalid_request_error', 'bad request')]);
  const session = new Session({ provider, retry: noRetry });
  await session.send('first');
  await assert.rejects(session.send('second'), /bad request/);
  assert.equal(session.history.length, 2);
});

test('a refusal is not saved to history', async () => {
  const session = new Session({ provider: createMockProvider([{ text: 'Partial', stopReason: 'refusal' }]) });
  const end = await session.send('hello');
  assert.equal(end.stopReason, 'refusal');
  assert.equal(session.history.length, 0);
});

test('after a fallback, only text blocks from before the switch are saved', async () => {
  const content = [
    { type: 'thinking', thinking: '', signature: 'x' },
    { type: 'text', text: 'Start… ' },
    { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
    { type: 'text', text: 'finished by the fallback model' },
  ];
  const session = new Session({ provider: createMockProvider([{ text: 'Start… finished', content }]) });
  await session.send('hi');
  assert.deepEqual(session.history[1].content, [
    { type: 'text', text: 'Start… ' },
    { type: 'text', text: 'finished by the fallback model' },
  ]);
});

test('clear forgets history and resets counters', async () => {
  const session = new Session({ provider: createMockProvider([{ text: 'x' }]) });
  await session.send('hi');
  session.clear();
  assert.equal(session.history.length, 0);
  assert.equal(session.turns, 0);
  assert.equal(session.cost, 0);
});
