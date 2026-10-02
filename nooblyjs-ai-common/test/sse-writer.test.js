import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { SSE_HEADERS, formatSSE, openSSE, parseSSE } from '../src/sse.js';
import { collect } from './helpers.js';

/** Just enough of a ServerResponse to watch what openSSE writes. */
function fakeResponse() {
  const res = new EventEmitter();
  Object.assign(res, {
    written: '',
    ended: false,
    writeHead(status, headers) {
      Object.assign(res, { status, headers });
    },
    write(text) {
      res.written += text;
      return true;
    },
    end() {
      res.ended = true;
    },
  });
  return res;
}

test('formatSSE writes id, event and JSON data, ending with a blank line', () => {
  assert.equal(formatSSE({ id: 7, event: 'step', data: { ok: true } }), 'id: 7\nevent: step\ndata: {"ok":true}\n\n');
});

test('formatSSE splits multi-line strings into several data lines', () => {
  assert.equal(formatSSE({ data: 'one\ntwo' }), 'data: one\ndata: two\n\n');
});

test('what formatSSE writes, parseSSE reads back', async () => {
  const text = formatSSE({ event: 'delta', data: { text: 'é' } }) + formatSSE({ data: { done: true } });
  const events = await collect(parseSSE([new TextEncoder().encode(text)]));
  assert.deepEqual(events, [
    { event: 'delta', data: { text: 'é' } },
    { event: 'message', data: { done: true } },
  ]);
});

test('openSSE sends headers, the retry delay, events and ends cleanly', () => {
  const res = fakeResponse();
  const sse = openSSE(res, { retryMs: 2000, heartbeatMs: 0, headers: { 'cache-control': 'no-store' } });
  sse.send('delta', { text: 'hi' }, { id: 1 });
  sse.comment('ping');
  sse.close();
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], SSE_HEADERS['content-type']);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.written, 'retry: 2000\n\nid: 1\nevent: delta\ndata: {"text":"hi"}\n\n: ping\n\n');
  assert.equal(res.ended, true);
});

test('openSSE sends keep-alive comments until the connection closes', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const res = fakeResponse();
  openSSE(res, { heartbeatMs: 1000 });
  t.mock.timers.tick(2000);
  assert.equal(res.written, ': keep-alive\n\n: keep-alive\n\n');
  res.emit('close');
  t.mock.timers.tick(5000);
  assert.equal(res.written, ': keep-alive\n\n: keep-alive\n\n');
});

test('stop() ends the keep-alive comments but leaves the response open', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const res = fakeResponse();
  const sse = openSSE(res, { heartbeatMs: 1000 });
  sse.stop();
  t.mock.timers.tick(5000);
  assert.equal(res.written, '');
  assert.equal(res.ended, false);
});
