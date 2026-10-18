// services/system.js: metrics, log files and the Admin → System summary.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';
import { startApp, closeHost } from '../helpers.js';

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

test('tasks, webhooks and requests are measured, logged to a file, and summarised for Admin → System', async () => {
  // Something to measure: two tasks, and a webhook delivery that fails once and is retried.
  await app.send('POST', '/api/v1/webhooks', { name: 'Measured', url: 'https://hooks.example.com/measured', events: ['task.completed'] });
  failNext = 1;
  failStatus = 503;
  await app.send('POST', '/api/v1/teammates/ada-quill/tasks', { task: 'Draft a launch email' });
  await app.send('POST', '/api/v1/teammates/ada-quill/tasks', { task: 'And a follow-up email' });
  await waitFor(async () => {
    const queue = (await app.get('/api/v1/admin/system')).body.webhookQueue;
    return hooks.filter((x) => x.url.endsWith('/measured')).length >= 3 && queue.inFlight + queue.waiting + queue.retrying === 0;
  });

  const sys = (await app.get('/api/v1/admin/system')).body;
  assert.ok(sys.metrics['task.completed'].count >= 2);
  assert.ok(sys.metrics['task.tokens'].sum > 0);
  assert.ok(sys.metrics['webhook.delivered'].count >= 1);
  assert.ok(sys.metrics['webhook.retry_scheduled'].count >= 1);
  assert.ok(sys.metrics['http.request_ms'].count > 0);
  assert.ok(sys.cache.hits > 0);
  assert.deepEqual(sys.webhookQueue, { queue: 'webhooks', waiting: 0, inFlight: 0, retrying: 0 });
  assert.deepEqual(sys.scheduleCheck, { mode: 'off' });
  assert.equal(sys.logs.dir, path.join(app.dataDir, 'logs'));
  // Only the owner sees it.
  assert.equal((await app.get('/api/v1/admin/system', { auth: false })).status, 401);

  const logged = await waitFor(async () => {
    const files = await fs.readdir(path.join(app.dataDir, 'logs')).catch(() => []);
    const text = (await Promise.all(files.map((f) => fs.readFile(path.join(app.dataDir, 'logs', f), 'utf8')))).join('');
    return /\[task\] ada-quill finished wk_/.test(text) && text;
  });
  assert.match(logged, /"tokens":\d+/);
  assert.doesNotMatch(logged, /correct horse battery/);
});
