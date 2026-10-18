// Phase F17: server-sent events: the event log, live, resumable by seq.
import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { openStore } from '../../src/models/store/events.js';
import { streamEvents } from '../../src/services/sse.js';
import { testEnv } from '../helpers.js';

/** A server that streams `store`; read(n) returns the first n `factory` messages from a fresh connection. */
async function serve(store, options = {}) {
  const streams = [];
  const server = http.createServer((req, res) => streams.push(streamEvents(store, req, res, { pollMs: 20, ...options, after: req.url?.includes('after=') ? Number(req.url.split('after=')[1]) : options.after })));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const url = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/`;
  const read = async (n, { path = '', headers = {} } = {}) => {
    const controller = new AbortController();
    const res = await fetch(url + path, { headers, signal: controller.signal });
    const decoder = new TextDecoder();
    let text = '';
    const messages = [];
    for await (const chunk of /** @type {any} */ (res.body)) {
      text += decoder.decode(chunk, { stream: true });
      for (const block of text.split('\n\n').slice(0, -1)) if (block.includes('event: factory')) messages.push(block);
      text = text.slice(text.lastIndexOf('\n\n') + 2);
      if (messages.length >= n) break;
    }
    controller.abort();
    return { type: res.headers.get('content-type'), messages: messages.map((b) => ({ id: Number(b.match(/^id: (\d+)/m)?.[1]), data: JSON.parse(b.match(/^data: (.*)$/m)?.[1] ?? 'null') })) };
  };
  return { read, close: () => { for (const s of streams) s.stop(); return new Promise((resolve) => server.close(resolve)); } };
}

test('each event is a message whose id is its seq; new events arrive live', async () => {
  const store = openStore({ env: testEnv() });
  store.append('run:a', 'run.queued', { runId: 'a' });
  const s = await serve(store, { after: 0 });
  try {
    const reading = s.read(2);
    setTimeout(() => store.append('run:a', 'run.started', { runId: 'a' }), 50);
    const { type, messages } = await reading;
    assert.match(type, /^text\/event-stream/);
    assert.deepEqual(messages.map((m) => [m.id, m.data.type]), [[1, 'run.queued'], [2, 'run.started']]);
  } finally {
    await s.close();
    store.close();
  }
});

test('Last-Event-ID resumes after that seq; filter and map shape what is sent', async () => {
  const store = openStore({ env: testEnv() });
  for (const t of ['run.queued', 'agent.event', 'run.started', 'run.finished']) store.append('run:b', t, { runId: 'b' });
  const s = await serve(store, { after: 0, filter: (e) => e.type !== 'agent.event', map: (e) => ({ seq: e.seq, t: e.type }) });
  try {
    const { messages } = await s.read(2, { headers: { 'last-event-id': '1' } });
    assert.deepEqual(messages.map((m) => m.data), [{ seq: 3, t: 'run.started' }, { seq: 4, t: 'run.finished' }]);
  } finally {
    await s.close();
    store.close();
  }
});
