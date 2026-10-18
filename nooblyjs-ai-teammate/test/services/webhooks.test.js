// services/webhooks.js: queued deliveries with retries, and moving the Phase 5 alert webhook into the list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { startApp, testHost, closeHost } from '../helpers.js';
import { register } from '../../index.js';
import { createProviders } from '../../src/services/providers/index.js';
import { MockProvider } from '../../src/services/providers/mock.js';

const hooks = [];
let failNext = 0; // the next N webhook deliveries get this status
let failStatus = 503;
const fakeFetch = async (url, init = {}) => {
  hooks.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
  if (failNext > 0) {
    failNext -= 1;
    return new Response('', { status: failStatus });
  }
  return new Response('', { status: 200 });
};

let app;
before(async () => {
  app = await startApp({ fetch: fakeFetch, webhookRetryDelaysMs: [20, 20] });
});
after(async () => {
  await app.close();
  await closeHost(); // worker threads and timers, so the test process can exit
});

const waitFor = async (check, { timeoutMs = 5000, stepMs = 25 } = {}) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, stepMs));
  }
};

test('webhooks are queued, retried after a server error with the same delivery id, and not retried after a 4xx', async () => {
  const created = await app.send('POST', '/api/v1/webhooks', { name: 'Flaky', url: 'https://hooks.example.com/flaky', events: ['task.completed'] });
  assert.equal(created.status, 201);
  hooks.length = 0;
  failNext = 1;
  failStatus = 503;
  const task = await app.send('POST', '/api/v1/teammates/ada-quill/tasks', { task: 'Draft a launch email' });
  assert.equal(task.status, 200);
  const attempts = await waitFor(() => {
    const mine = hooks.filter((h) => h.url.endsWith('/flaky'));
    return mine.length >= 2 && mine;
  });
  assert.equal(attempts[0].headers['X-Teammates-Delivery'], attempts[1].headers['X-Teammates-Delivery']);
  assert.deepEqual(attempts[1].body, attempts[0].body, 'same body, so the signature matches too');
  assert.equal(attempts[1].headers['X-Teammates-Attempt'], '2');
  const endpoint = await waitFor(async () => {
    const e = (await app.get('/api/v1/webhooks')).body.endpoints.find((x) => x.id === created.body.endpoint.id);
    return e.lastDelivery?.ok && e;
  });
  assert.equal(endpoint.lastDelivery.attempt, 2);

  // A 4xx means the receiver rejected it: no retry.
  hooks.length = 0;
  failNext = 1;
  failStatus = 410;
  await app.send('POST', '/api/v1/teammates/ada-quill/tasks', { task: 'And a follow-up email' });
  await app.invocation.idle();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(hooks.filter((h) => h.url.endsWith('/flaky')).length, 1);
  const rejected = (await app.get('/api/v1/webhooks')).body.endpoints.find((x) => x.id === created.body.endpoint.id);
  assert.deepEqual([rejected.lastDelivery.ok, rejected.lastDelivery.status, rejected.lastDelivery.nextRetryAt], [false, 410, undefined]);
  await app.send('DELETE', `/api/v1/webhooks/${created.body.endpoint.id}`);
});

test('a Phase 5 alert webhook in settings moves into the webhook list', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-mig-'));
  const h = await testHost();
  // Two starts on the same workspace, each on a throwaway app (never served) with its own core instances.
  const options = (n) => ({
    host: h.hostFor({ dataDir }), core: { instanceName: `migration-${n}` },
    dataDir, now: () => '2026-10-01', providers: createProviders({ mode: 'mock', mock: new MockProvider({ delayMs: 0 }) }), log: { info() {}, warn() {}, error() {} }, sessionSecret: 's', scheduleIntervalMs: 0,
  });
  const first = (await register(express(), h.serverManager, options(1))).internals;
  await first.store.remove(['config', 'webhooks.md']);
  await first.repos.config.updateSettings({ alerts: { warnAtPct: 75, webhookUrl: 'https://old.example.com/hook', webhookSecret: 'x'.repeat(20) } });
  first.close();

  const second = (await register(express(), h.serverManager, options(2))).internals;
  const [endpoint] = await second.webhooks.endpoints();
  assert.deepEqual([endpoint.url, endpoint.secret, endpoint.events.length], ['https://old.example.com/hook', 'x'.repeat(20), 4]);
  assert.deepEqual((await second.repos.config.getSettings()).alerts, { warnAtPct: 75 });
  second.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});
