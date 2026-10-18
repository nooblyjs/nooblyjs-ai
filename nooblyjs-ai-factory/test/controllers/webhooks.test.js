// Phase F15: one GitHub delivery: signature first, then JSON, then the event.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import { createWebhookController } from '../../src/controllers/webhooks.js';
import { openStore } from '../../src/models/store/events.js';
import { testEnv } from '../helpers.js';

const SECRET = 'hook-secret';
const settings = { label: 'factory', allowedUsers: ['sam'] };
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
const delivery = (event, body, signature) => {
  const raw = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  return { raw, headers: { 'x-github-event': event, 'x-github-delivery': 'd-1', 'x-hub-signature-256': signature ?? sign(raw) } };
};

async function withController(fn, extra = {}) {
  const store = openStore({ env: testEnv() });
  try {
    return await fn(createWebhookController({ store, secret: SECRET, settings, ...extra }), store);
  } finally {
    store.close();
  }
}

test('no secret, no webhooks: unsigned deliveries are never accepted', () => {
  assert.throws(() => createWebhookController({ store: /** @type {any} */ ({}), secret: '', settings }), /webhook secret is needed/);
});

test('a missing or wrong signature is a 401, and nothing is written', () => withController(async (handle, store) => {
  assert.deepEqual(await handle(delivery('issues', { action: 'labeled' }, 'sha256=00')), { status: 401, body: { error: 'bad signature' } });
  const raw = '{"action":"labeled"}';
  assert.equal((await handle(delivery('issues', raw, sign(raw, 'other-secret')))).status, 401);
  assert.equal((await handle({ raw: Buffer.from(raw), headers: { 'x-github-event': 'issues' } })).status, 401);
  assert.deepEqual(store.read(), []);
}));

test('signed but not JSON is a 400', () => withController(async (handle) => {
  assert.deepEqual(await handle(delivery('issues', 'not json')), { status: 400, body: { error: 'not JSON' } });
}));

test('an event the factory does not act on is accepted (202) and reported', async () => {
  const seen = [];
  await withController(async (handle) => {
    const out = await handle(delivery('ping', { zen: 'hi' }));
    assert.deepEqual(out, { status: 202, body: { handled: false, reason: 'not an event the factory acts on' } });
    assert.deepEqual(seen, [{ event: 'ping', handled: false, reason: 'not an event the factory acts on' }]);
    assert.equal((await handle(delivery('pull_request', { action: 'closed', pull_request: { head: { ref: 'feature/x' } } }))).body.handled, false);
  }, { onHandled: (r) => seen.push(r) });
});
