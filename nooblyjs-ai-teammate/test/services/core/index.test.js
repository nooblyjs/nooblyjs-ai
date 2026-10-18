// services/core/index.js and the host's nooblyjs-core: the /services dashboards, sign-in, CSP, console logging.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startApp, closeHost } from '../../helpers.js';
import { createCore } from '../../../src/services/core/index.js';
import { serverManager as registry } from '../../fixtures/host.js';

process.env.DEFAULT_ADMIN_PASSWORD = 'core-admin-Passw0rd!';

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await closeHost(); // worker threads and timers, so the test process can exit
});

// Site paths: the host's /services/…, or the app's own under its mount path (app.mountPath).
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
  const { key } = (await app.send('POST', '/api/v1/admin/keys', { name: 'CI', teammates: '*' })).body;
  assert.equal((await raw('/services/caching/api/get/x', { cookie: false, headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })).status, 401);
  // The test owner has core's `owner` role: an owner in the app, but not a core admin, so no dashboards.
  assert.equal((await app.get('/api/v1/session')).body.user.role, 'owner');
  assert.notEqual((await raw('/services/caching/api/get/x', { headers: { Accept: 'application/json' } })).status, 200);

  // admin@localhost: one session cookie for the whole site, an owner in the app and an admin on the dashboards.
  assert.equal((await raw('/services/authservice/api/login', { method: 'POST', cookie: false, body: { email: 'admin@localhost', password: 'Wrong-Password-1' } })).status, 401);
  const admin = await coreLogin();
  assert.match(admin.setCookie, /^NooblyJS\.sid=.*Path=\/;.*HttpOnly.*SameSite=Lax/i);
  const me = await (await raw(`${app.mountPath}/api/v1/session`, { cookie: false, headers: { Cookie: admin.cookie } })).json();
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
  const page = await raw(`${app.mountPath}/team`, { cookie: false });
  // The app's pages carry the host's policy (here the stand-in host sets none), never the dashboards' looser one.
  assert.doesNotMatch(page.headers.get('content-security-policy') ?? '', /script-src [^;]*unsafe-inline/);
});

test('without DEFAULT_ADMIN_PASSWORD, the admin password is generated into a file only the owner can read', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-core-auth-'));
  const authDir = path.join(dataDir, 'core', 'auth');
  const file = path.join(authDir, 'INITIAL_ADMIN_PASSWORD.txt');
  const saved = process.env.DEFAULT_ADMIN_PASSWORD;
  delete process.env.DEFAULT_ADMIN_PASSWORD;
  try {
    // The host already has an authservice, so a second one is created directly, as a fresh start would.
    const auth = registry.authservice('file', { instanceName: 'generated-admin', dataDir: authDir });
    const text = await waitFor(() => fs.readFile(file, 'utf8').catch(() => null));
    const [, password] = /password: (.+)/.exec(text);
    assert.match(text, /^email: admin@localhost$/m);
    assert.ok(password.length >= 20);
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.ok(await auth.authenticateUser('admin@localhost', password));
    // The log says where the password is (core's services log to the host's log folder), never the password.
    const readLogs = async () => {
      const dir = app.host.logDir;
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

test('LOG_CONSOLE=all mirrors every log file line on the console, once', async () => {
  const printed = [];
  const original = console.log;
  console.log = (line) => printed.push(line);
  try {
    const core = createCore({ serverManager: registry, dataDir: app.dataDir, consoleMode: 'all', instanceName: 'console-all' });
    core.log.info('[test] hello from the app', { tokens: 3 });
    registry.cache('memory', { instanceName: 'console-all-cache' }); // core's own services log through 'default'
  } finally {
    console.log = original;
  }
  const mine = printed.filter((l) => l.includes('[test] hello from the app'));
  assert.equal(mine.length, 1, 'not echoed twice');
  assert.match(mine[0], / - INFO - .* - \[test\] hello from the app {"tokens":3}/, "core's line format");
});
