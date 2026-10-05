// nooblyjs-core integration: /services dashboards behind the owner session, the document cache, queued webhooks
// with retries, live events on the notifying service, the core-scheduled schedule check, log files and metrics.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startApp } from './helpers.js';
import { shutdownCore, registry, createCore } from '../src/core/index.js';
import { JobQueue } from '../src/core/job-queue.js';
import { fileSessionStore } from '../src/core/session-store.js';
import { createRequire } from 'node:module';
import { CHECK_TASK } from '../src/services/scheduler.js';

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

process.env.DEFAULT_ADMIN_PASSWORD = 'core-admin-Passw0rd!';

let app;
before(async () => {
  app = await startApp({ fetch: fakeFetch, webhookRetryDelaysMs: [20, 20] });
});
after(async () => {
  await app.close();
  await shutdownCore(); // worker threads and timers, so the test process can exit
});

const raw = (url, { method = 'GET', headers = {}, body, cookie = true } = {}) => fetch(app.base + url, {
  method, redirect: 'manual',
  headers: { ...(cookie ? { Cookie: app.session.cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
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

// ---------- /services: core's authservice ----------

const ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD;

/** Signs in to core's /services as admin@localhost. The admin account is created in the background on first start. */
const coreLogin = () => waitFor(async () => {
  const res = await raw('/services/authservice/api/login', { method: 'POST', cookie: false, body: { email: 'admin@localhost', password: ADMIN_PASSWORD } });
  if (res.status !== 200) return null;
  const body = await res.json();
  return { cookie: res.headers.get('set-cookie').split(';')[0], setCookie: res.headers.get('set-cookie'), token: body.data.session.token };
});

test('one core sign-in covers the app and the dashboards; the dashboards need core\'s admin role', async () => {
  // Signed out: browsers get core's sign-in flow, scripts get 401. Only health checks are public.
  const page = await raw('/services/', { cookie: false, headers: { Accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /authservice\/views\/login\.html/);
  assert.equal((await raw('/services/caching/api/get/x', { cookie: false, headers: { Accept: 'application/json' } })).status, 401);
  assert.equal((await raw('/services/caching/api/status', { cookie: false })).status, 200);
  // A Teammates API key only calls teammates.
  const { key } = (await app.send('POST', '/api/admin/keys', { name: 'CI', teammates: '*' })).body;
  assert.equal((await raw('/services/caching/api/get/x', { cookie: false, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })).status, 401);
  // The test owner has core's `owner` role: an owner in the app, but not a core admin, so no dashboards.
  assert.equal((await app.get('/api/session')).body.user.role, 'owner');
  assert.notEqual((await raw('/services/caching/api/get/x', { headers: { Accept: 'application/json' } })).status, 200);

  // admin@localhost: one session cookie for the whole site, an owner in the app and an admin on the dashboards.
  assert.equal((await raw('/services/authservice/api/login', { method: 'POST', cookie: false, body: { email: 'admin@localhost', password: 'Wrong-Password-1' } })).status, 401);
  const admin = await coreLogin();
  assert.match(admin.setCookie, /^nooblyjs\.sid=.*Path=\/;.*HttpOnly.*SameSite=Lax/i);
  const me = await (await raw('/api/session', { cookie: false, headers: { Cookie: admin.cookie } })).json();
  assert.deepEqual([me.user.id, me.user.name, me.user.role], ['admin@localhost', 'Administrator', 'owner']);
  const dash = await raw('/services/', { cookie: false, headers: { Cookie: admin.cookie, Accept: 'text/html' } });
  assert.equal(dash.status, 200);
  assert.doesNotMatch(await dash.text(), /Checking authentication/);
  assert.equal((await raw('/services/queueing/api/queues', { cookie: false, headers: { Cookie: admin.cookie } })).status, 200);
});

test('a JSON body parsed by the main app reaches core routes, and the dashboards get core\'s CSP', async () => {
  const { token } = await coreLogin();
  const auth = { Authorization: `Bearer ${token}` };
  const put = await raw('/services/caching/api/put/greeting', { method: 'POST', cookie: false, headers: auth, body: { value: { hello: 'world' } } });
  assert.equal(put.status, 200);
  assert.deepEqual((await (await raw('/services/caching/api/get/greeting', { cookie: false, headers: auth })).json()).value, { hello: 'world' });

  const services = await raw('/services/', { cookie: false, headers: { ...auth, Accept: 'text/html' } });
  assert.match(services.headers.get('content-security-policy'), /script-src [^;]*'unsafe-inline'/);
  const page = await raw('/team', { cookie: false });
  assert.doesNotMatch(page.headers.get('content-security-policy'), /script-src [^;]*unsafe-inline/);
});

test('without DEFAULT_ADMIN_PASSWORD, the admin password is generated into a file only the owner can read', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-core-auth-'));
  const authDir = path.join(dataDir, 'core', 'auth');
  const file = path.join(authDir, 'INITIAL_ADMIN_PASSWORD.txt');
  const saved = process.env.DEFAULT_ADMIN_PASSWORD;
  delete process.env.DEFAULT_ADMIN_PASSWORD;
  try {
    // createCore shares the process's first authservice, so a second one is created directly, as a fresh start would.
    const auth = registry.authservice('file', { instanceName: 'generated-admin', dataDir: authDir });
    const text = await waitFor(() => fs.readFile(file, 'utf8').catch(() => null));
    const [, password] = /password: (.+)/.exec(text);
    assert.match(text, /^email: admin@localhost$/m);
    assert.ok(password.length >= 20);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.ok(await auth.authenticateUser('admin@localhost', password));
    // The log says where the password is (core's services log to the first app's log folder), never the password.
    const readLogs = async () => {
      const dir = path.join(app.dataDir, 'logs');
      return (await Promise.all((await fs.readdir(dir)).map((f) => fs.readFile(path.join(dir, f), 'utf8')))).join('');
    };
    const logs = await waitFor(async () => {
      const t = await readLogs();
      return t.includes(JSON.stringify(file).slice(1, -1)) && t;
    });
    assert.ok(!logs.includes(password));
  } finally {
    process.env.DEFAULT_ADMIN_PASSWORD = saved;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('parsed documents are cached, picked up again after outside edits, and secrets are never cached', async () => {
  const { store } = app;
  const before = store.cacheInfo();
  const first = await store.readDoc(['config', 'settings.md']);
  const second = await store.readDoc(['config', 'settings.md']);
  assert.deepEqual(second, first);
  assert.ok(store.cacheInfo().hits > before.hits, 'second read is a cache hit');

  // Callers may change what they read without touching the cache.
  second.data.timezone = 'Mars/Olympus';
  assert.notEqual((await store.readDoc(['config', 'settings.md'])).data.timezone, 'Mars/Olympus');

  // An edit made outside the app (e.g. in a text editor) is seen on the next read.
  const file = path.join(app.dataDir, 'config', 'settings.md');
  const text = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, text.replace(/^---\n/, '---\nexternalEdit: yes\n'));
  assert.equal((await store.readDoc(['config', 'settings.md'])).data.externalEdit, 'yes');

  // Writes through the store replace the cached copy.
  await app.repos.config.updateSettings({ externalEdit: 'no' });
  assert.equal((await app.repos.config.getSettings()).externalEdit, 'no');

  // Users, keys, the session secret and webhook secrets stay out of the cache (it is readable on /services).
  await store.readDoc(['system', 'users.md']);
  await store.readDoc(['config', 'webhooks.md']);
  const keys = [...store.cachedKeys];
  assert.ok(keys.some((k) => k.endsWith(`${path.sep}settings.md`)));
  assert.ok(!keys.some((k) => k.includes(`${path.sep}system${path.sep}`) || k.endsWith('webhooks.md')));
  assert.equal(await app.core.cache.get(`doc:${path.join(app.dataDir, 'system', 'users.md')}`), undefined);
});

test('webhooks are queued, retried after a server error with the same delivery id, and not retried after a 4xx', async () => {
  const created = await app.send('POST', '/api/webhooks', { name: 'Flaky', url: 'https://hooks.example.com/flaky', events: ['task.completed'] });
  assert.equal(created.status, 201);
  hooks.length = 0;
  failNext = 1;
  failStatus = 503;
  const task = await app.send('POST', '/api/teammates/ada-quill/tasks', { task: 'Draft a launch email' });
  assert.equal(task.status, 200);
  const attempts = await waitFor(() => {
    const mine = hooks.filter((h) => h.url.endsWith('/flaky'));
    return mine.length >= 2 && mine;
  });
  assert.equal(attempts[0].headers['X-Teammates-Delivery'], attempts[1].headers['X-Teammates-Delivery']);
  assert.deepEqual(attempts[1].body, attempts[0].body, 'same body, so the signature matches too');
  assert.equal(attempts[1].headers['X-Teammates-Attempt'], '2');
  const endpoint = await waitFor(async () => {
    const e = (await app.get('/api/webhooks')).body.endpoints.find((x) => x.id === created.body.endpoint.id);
    return e.lastDelivery?.ok && e;
  });
  assert.equal(endpoint.lastDelivery.attempt, 2);

  // A 4xx means the receiver rejected it: no retry.
  hooks.length = 0;
  failNext = 1;
  failStatus = 410;
  await app.send('POST', '/api/teammates/ada-quill/tasks', { task: 'And a follow-up email' });
  await app.invocation.idle();
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(hooks.filter((h) => h.url.endsWith('/flaky')).length, 1);
  const rejected = (await app.get('/api/webhooks')).body.endpoints.find((x) => x.id === created.body.endpoint.id);
  assert.deepEqual([rejected.lastDelivery.ok, rejected.lastDelivery.status, rejected.lastDelivery.nextRetryAt], [false, 410, undefined]);
  await app.send('DELETE', `/api/webhooks/${created.body.endpoint.id}`);
});

test('live events are published on the notifying service', async () => {
  const seen = [];
  const unsubscribe = await app.events.subscribe((e) => seen.push(e));
  app.events.publish('teammate', { id: 'ada-quill', status: 'available' });
  unsubscribe();
  app.events.publish('teammate', { id: 'ada-quill', status: 'paused' });
  assert.deepEqual(seen, [{ type: 'teammate', data: { id: 'ada-quill', status: 'available' } }]);
  const history = app.core.notifying.getNotifications();
  assert.ok(history.some((n) => n.topic === 'teammates.events' || n.topicName === 'teammates.events'));

  // The SSE stream relays them to the browser.
  const res = await raw('/api/events');
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  await reader.read(); // retry line
  app.events.publish('alert', { level: 'warning' });
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /event: alert\ndata: {"level":"warning"}/);
  await reader.cancel();
});

test('tasks, webhooks and requests are measured, logged to a file, and summarised for Admin → System', async () => {
  const sys = (await app.get('/api/admin/system')).body;
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
  assert.equal((await app.get('/api/admin/system', { auth: false })).status, 401);

  const logged = await waitFor(async () => {
    const files = await fs.readdir(path.join(app.dataDir, 'logs')).catch(() => []);
    const text = (await Promise.all(files.map((f) => fs.readFile(path.join(app.dataDir, 'logs', f), 'utf8')))).join('');
    return /\[task\] ada-quill finished wk_/.test(text) && text;
  });
  assert.match(logged, /"tokens":\d+/);
  assert.doesNotMatch(logged, /correct horse battery/);
});

test('the schedule check runs as a core scheduled task that can be watched and stopped', async () => {
  const sched = await startApp({ scheduleIntervalMs: 1000 });
  try {
    assert.notEqual(sched.core.instanceName, app.core.instanceName, 'each app gets its own core instances');
    const sch = await sched.send('POST', '/api/schedules', { teammateId: 'ada-quill', name: 'Daily digest', task: 'Write the daily digest', cadence: { days: [1, 2, 3, 4, 5, 6, 7], time: '09:00' } });
    assert.equal(sch.status, 201);
    // Make it due now; the next beat of the core task picks it up.
    await sched.repos.schedules.update(sch.body.id, () => ({ nextRunAt: new Date(Date.now() - 1000).toISOString() }));
    const ran = await waitFor(async () => {
      const s = await sched.repos.schedules.get(sch.body.id);
      return s.lastStatus === 'completed' && s;
    }, { timeoutMs: 15000, stepMs: 100 });
    assert.match(ran.lastWorkId, /^wk_/);

    const status = (await sched.get('/api/admin/system')).body.scheduleCheck;
    assert.deepEqual([status.mode, status.task, status.registered, status.enabled, status.intervalSeconds], ['core', CHECK_TASK, true, true, 1]);
    assert.ok(status.lastFinishedAt);
    // Core's own API lists it too (this route reads the query string, which must survive the hand-off to core).
    const { token } = await coreLogin();
    const listed = await raw('/services/scheduling/api/schedules?limit=5', { cookie: false, headers: { Authorization: `Bearer ${token}` } });
    assert.equal(listed.status, 200);
    assert.ok((await listed.json()).some((t) => t.name === CHECK_TASK));
    await sched.invocation.idle();
  } finally {
    await sched.close();
  }
  const scheduling = registry.getServiceInstance('scheduling', 'memory', sched.core.instanceName);
  assert.equal(await scheduling.isRunning(CHECK_TASK), false, 'closing the app stops the check');
});

test('LOG_CONSOLE=all mirrors every log file line on the console, once', async () => {
  const printed = [];
  const original = console.log;
  console.log = (line) => printed.push(line);
  try {
    const core = createCore({ dataDir: app.dataDir, consoleMode: 'all', instanceName: 'console-all' });
    core.log.info('[test] hello from the app', { tokens: 3 });
    registry.cache('memory', { instanceName: 'console-all-cache' }); // core's own services log through 'default'
  } finally {
    console.log = original;
  }
  const mine = printed.filter((l) => l.includes('[test] hello from the app'));
  assert.equal(mine.length, 1, 'not echoed twice');
  assert.match(mine[0], / - INFO - .* - \[test\] hello from the app {"tokens":3}/, "core's line format");
});

test('sign-in sessions are kept in a file, so a restart does not sign people out', async () => {
  const require = createRequire(import.meta.url);
  const session = require(require.resolve('express-session', { paths: [path.dirname(require.resolve('nooblyjs-core'))] }));
  const Store = fileSessionStore(session);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-sessions-'));
  const file = path.join(dir, 'sessions.json');
  const call = (store, method, ...args) => new Promise((resolve, reject) => store[method](...args, (err, value) => (err ? reject(err) : resolve(value))));
  try {
    const first = new Store({ file });
    const sess = { cookie: { originalMaxAge: 60000, expires: new Date(Date.now() + 60000).toISOString() }, passport: { user: 'admin@localhost' } };
    await call(first, 'set', 'sid-alive', sess);
    await call(first, 'set', 'sid-expired', { cookie: { expires: new Date(Date.now() - 1000).toISOString() } });
    await first.close();

    // "Restart": a new store reads the file.
    const second = new Store({ file });
    assert.deepEqual((await call(second, 'get', 'sid-alive')).passport, { user: 'admin@localhost' });
    assert.equal(await call(second, 'get', 'sid-expired'), null);
    const text = await fs.readFile(file, 'utf8');
    assert.ok(!text.includes('sid-alive'), 'session ids are stored hashed');
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    await call(second, 'destroy', 'sid-alive');
    await second.close();
    assert.equal(await call(new Store({ file }), 'get', 'sid-alive'), null);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------- JobQueue on core queueing ----------

test('the job queue runs jobs with limited concurrency, retries, and reports when idle', async () => {
  const queue = registry.queue('memory', { instanceName: 'job-queue-test' });
  let running = 0;
  let peak = 0;
  const seen = [];
  const jobs = new JobQueue({
    queue, name: 'work', concurrency: 2, retryDelaysMs: [5],
    handler: async (payload, { attempt }) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      seen.push(`${payload.n}:${attempt}`);
      return { ok: payload.n !== 3 || attempt > 1 };
    },
    shouldRetry: (result) => !result.ok,
  });
  const first = await Promise.all([1, 2, 3, 4].map((n) => jobs.push({ n })));
  assert.deepEqual(first.map((r) => r.ok), [true, true, false, true], 'push resolves with the first attempt');
  assert.equal(peak, 2);
  await waitFor(() => seen.includes('3:2'));
  await jobs.idle();
  assert.deepEqual([...seen].sort(), ['1:1', '2:1', '3:1', '3:2', '4:1']);
  assert.equal(await jobs.size(), 0);

  // A handler that throws rejects the first attempt; close() drops waiting retries.
  const failing = new JobQueue({ queue, name: 'failing', retryDelaysMs: [60000], handler: async () => { throw new Error('boom'); } });
  await assert.rejects(failing.push({}), /boom/);
  assert.equal(failing.retrying, 1);
  failing.close();
  assert.equal(failing.retrying, 0);
});
