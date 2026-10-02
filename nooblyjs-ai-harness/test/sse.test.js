import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEvent, parseSSE } from '../src/providers/sse.js';
import { chunked, collect, readFixture } from './helpers.js';

test('parseEvent reads the event name and JSON data', () => {
  assert.deepEqual(parseEvent('event: ping\ndata: {"type":"ping"}'), { event: 'ping', data: { type: 'ping' } });
});

test('parseEvent ignores comments and returns null without data', () => {
  assert.equal(parseEvent(': keep-alive'), null);
});

test('parseSSE gives the same events however the bytes are chunked', async () => {
  const bytes = readFixture('text-reply.sse');
  const whole = await collect(parseSSE([bytes]));
  assert.equal(whole.length, 11);

  // Many different random chunkings, including chunks that split "é", "ö" and "✻" mid-character.
  for (let seed = 1; seed <= 25; seed++) {
    assert.deepEqual(await collect(parseSSE(chunked(bytes, { seed }))), whole);
  }
});

test('parseSSE handles one byte at a time', async () => {
  const bytes = readFixture('text-reply.sse');
  const events = await collect(parseSSE(chunked(bytes, { maxChunk: 1 })));
  assert.equal(events.length, 11);
});

test('parseSSE accepts \\r\\n line endings and a missing final blank line', async () => {
  const text = 'event: ping\r\ndata: {"type":"ping"}\r\n\r\nevent: ping\ndata: {"n":2}';
  const events = await collect(parseSSE([new TextEncoder().encode(text)]));
  assert.deepEqual(events.map((e) => e.data), [{ type: 'ping' }, { n: 2 }]);
});
