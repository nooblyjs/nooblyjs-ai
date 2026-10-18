// Phase F15: the webhook endpoint over HTTP: one path, POST only, signed bodies.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { createWebhookServer } from '../../src/routes/webhooks.js';
import { openStore } from '../../src/models/store/events.js';
import { testEnv } from '../helpers.js';

const SECRET = 's3';

async function serve() {
  const store = openStore({ env: testEnv() });
  const server = createWebhookServer({ store, secret: SECRET, settings: { label: 'factory', allowedUsers: [] } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  const post = async (p, body, headers = {}) => {
    const res = await fetch(base + p, { method: 'POST', headers, body });
    return { status: res.status, body: await res.json() };
  };
  return { base, post, close: () => new Promise((resolve) => server.close(() => (store.close(), resolve(undefined)))) };
}

test('only POST /webhooks/github exists', async () => {
  const s = await serve();
  try {
    assert.equal((await fetch(`${s.base}/webhooks/github`)).status, 404);
    assert.equal((await s.post('/webhooks/gitlab', '{}')).status, 404);
  } finally {
    await s.close();
  }
});

test('a signed delivery is handled (202); an unsigned one is a 401', async () => {
  const s = await serve();
  try {
    const raw = JSON.stringify({ zen: 'hello' });
    const signature = `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;
    assert.deepEqual(await s.post('/webhooks/github', raw, { 'x-github-event': 'ping', 'x-hub-signature-256': signature }), { status: 202, body: { handled: false, reason: 'not an event the factory acts on' } });
    assert.deepEqual(await s.post('/webhooks/github', raw, { 'x-github-event': 'ping' }), { status: 401, body: { error: 'bad signature' } });
  } finally {
    await s.close();
  }
});
