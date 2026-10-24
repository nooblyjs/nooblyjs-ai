import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

// Start the app on a random free port with its own score file, so real scores are never touched.
async function start(sentences) {
  const dir = await mkdtemp(join(tmpdir(), 'typetest-server-'));
  const app = createApp({ dataFile: join(dir, 'scores.json'), sentences });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

const body = { wpm: 42, accuracy: 96, errors: 3, keystrokes: 80, seconds: 40, sentence: 'Hi there.' };

const post = (base, json) =>
  fetch(`${base}/api/scores`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(json),
  });

test('GET /api/sentence returns a sentence from the list', async () => {
  const srv = await start(['Only one sentence here.']);
  try {
    const res = await fetch(`${srv.base}/api/sentence`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { text: 'Only one sentence here.' });
  } finally {
    await srv.close();
  }
});

test('GET /api/sentence avoids the sentence passed in ?avoid=', async () => {
  const srv = await start(['first one.', 'second one.']);
  try {
    const res = await fetch(`${srv.base}/api/sentence?avoid=${encodeURIComponent('first one.')}`);
    assert.equal((await res.json()).text, 'second one.');
  } finally {
    await srv.close();
  }
});

test('GET /api/scores is empty to begin with', async () => {
  const srv = await start(['x']);
  try {
    const data = await (await fetch(`${srv.base}/api/scores`)).json();
    assert.deepEqual(data.scores, []);
    assert.equal(data.summary.runs, 0);
  } finally {
    await srv.close();
  }
});

test('POST /api/scores saves a run and returns the updated summary', async () => {
  const srv = await start(['x']);
  try {
    const res = await post(srv.base, body);
    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.saved.wpm, 42);
    assert.equal(data.saved.score, 40);
    assert.equal(data.summary.runs, 1);

    const list = await (await fetch(`${srv.base}/api/scores`)).json();
    assert.equal(list.scores.length, 1);
    assert.equal(list.summary.best.wpm, 42);
  } finally {
    await srv.close();
  }
});

test('POST /api/scores rejects a bad run with a 400', async () => {
  const srv = await start(['x']);
  try {
    const res = await post(srv.base, { ...body, wpm: 'fast' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not valid/);
  } finally {
    await srv.close();
  }
});
