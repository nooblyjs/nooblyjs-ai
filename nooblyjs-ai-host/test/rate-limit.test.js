// The API rate limit (app.js STEP 3): a signed-in person gets the full allowance and is counted on their own, so
// people behind one office address don't use up each other's; someone not signed in gets a fifth, by address.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

const LIMIT = 20;
let env;
before(async () => { env = await startApp({ env: { API_RATE_LIMIT: String(LIMIT) } }); });
after(async () => { await env?.stop(); });

const statuses = async (c, n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push((await c.get('/api/v1/me')).status);
  return out;
};

test('a signed-in person gets the full allowance, then 429 in the standard error shape', async () => {
  const lerato = env.client();
  await lerato.signIn('lerato-m');
  const first = await lerato.get('/api/v1/me');
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('ratelimit-limit'), String(LIMIT), 'the signed-in allowance, not the anonymous fifth');
  const rest = await statuses(lerato, LIMIT);
  assert.deepEqual(rest.slice(0, LIMIT - 1), Array(LIMIT - 1).fill(200));
  assert.equal(rest.at(-1), 429);
  const refused = await lerato.json('/api/v1/me');
  assert.equal(refused.body.error.code, 'rate_limited');
});

test('another person from the same address still has their own allowance', async () => {
  const thabo = env.client();
  await thabo.signIn('thabo-n');
  assert.deepEqual(await statuses(thabo, 5), Array(5).fill(200));
});

test('someone not signed in gets a fifth of it, by address', async () => {
  const anon = env.client();
  const got = await statuses(anon, LIMIT / 5 + 1);
  assert.deepEqual(got.slice(0, LIMIT / 5), Array(LIMIT / 5).fill(401), 'counted, and answered as not signed in');
  assert.equal(got.at(-1), 429);
});
