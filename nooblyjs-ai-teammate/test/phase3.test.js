import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, coreSignIn, ensureCoreUser, OWNER_EMAIL, OWNER_PASSWORD } from './helpers.js';

let app;

before(async () => {
  app = await startApp();
});
after(() => app.close());

const raw = (method, url, { headers = {}, body } = {}) =>
  fetch(app.base + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('the API rejects anonymous callers and reports the session state', async () => {
  const anon = await app.get('/api/teammates', { auth: false });
  assert.equal(anon.status, 401);
  assert.equal(anon.body.error.code, 'unauthenticated');
  const state = await app.get('/api/session', { auth: false });
  assert.equal(state.body.authenticated, false);
  assert.equal(state.body.links.signIn, '/services/authservice/views/login.html');
  assert.deepEqual((await app.get('/api/auth/check', { auth: false })).body, { authenticated: false });
  const signedIn = await app.get('/api/session');
  assert.equal(signedIn.body.authenticated, true);
  assert.deepEqual(signedIn.body.user, { id: OWNER_EMAIL, name: 'Stevie', username: OWNER_EMAIL, role: 'owner' });
  assert.equal(signedIn.body.csrf, app.session.csrf);
  assert.deepEqual((await app.get('/api/auth/check')).body, { authenticated: true });
});

test('/login hands over to the nooblyjs-core sign-in page, which comes back to the app', async () => {
  const go = (url) => fetch(app.base + url, { redirect: 'manual' });
  const login = await go('/login?next=%2Fbilling%3Fperiod%3Dmonth');
  assert.equal(login.status, 302);
  assert.equal(login.headers.get('location'), '/services/authservice/views/login.html?returnUrl=%2Fbilling%3Fperiod%3Dmonth');
  // Only paths on this site are sent back to.
  for (const next of ['https://evil.example/', '//evil.example', '/login']) {
    assert.equal((await go(`/login?next=${encodeURIComponent(next)}`)).headers.get('location'), '/services/authservice/views/login.html?returnUrl=%2Fteam');
  }
  assert.equal((await go('/services/authservice/views/login.html')).status, 200);
  // Core's login API sends the browser back to the app page it came from.
  const res = await fetch(`${app.base}/services/authservice/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: OWNER_EMAIL, password: OWNER_PASSWORD, returnUrl: '/billing' }) });
  assert.equal((await res.json()).redirectUrl, '/billing');
});

test('changes need the CSRF header, reads do not', async () => {
  const noCsrf = await raw('PATCH', '/api/teammates/ada-quill', { headers: { Cookie: app.session.cookie }, body: { rate: 50 } });
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).error.code, 'csrf_failed');
  assert.equal((await raw('GET', '/api/teammates/ada-quill', { headers: { Cookie: app.session.cookie } })).status, 200);
});

test('wrong passwords are refused, and repeated failures lock the account for a while', async () => {
  await ensureCoreUser(app.core.auth, { email: 'locky@example.com', fullName: 'Locky', password: 'Locky-Pass-1234', role: 'viewer' });
  assert.equal((await coreSignIn(app.base, 'locky@example.com', 'nope nope nope')).status, 401);
  const statuses = [];
  for (let i = 0; i < 9; i++) statuses.push((await coreSignIn(app.base, 'locky@example.com', 'nope nope nope')).status);
  assert.ok(statuses.includes(429), 'locked out');
  assert.equal((await coreSignIn(app.base, 'locky@example.com', 'Locky-Pass-1234')).status, 429, 'even with the right password');
});

test('API keys are shown once, scoped, rate limited and revocable; calls are attributed', async () => {
  const created = await app.send('POST', '/api/admin/keys', { name: 'CI pipeline', teammates: ['wren-sato'], rateLimit: 2 });
  assert.equal(created.status, 201);
  const { key, record } = created.body;
  assert.match(key, /^dtk_/);
  assert.equal(record.hash, undefined);
  const listed = await app.get('/api/admin/keys');
  assert.ok(listed.body.keys.some((k) => k.id === record.id && !k.hash && !k.key));

  const bearer = { Authorization: `Bearer ${key}` };
  const call = await raw('POST', '/api/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'Brief on Globex' } });
  assert.equal(call.status, 200);
  const result = await call.json();
  assert.equal(result.entry.caller, 'CI pipeline');
  assert.equal(result.entry.callerType, 'key');
  const work = await app.get(`/api/teammates/wren-sato/work/${result.workId}`);
  assert.deepEqual(work.body.caller, { type: 'key', id: record.id, name: 'CI pipeline' });

  assert.equal((await raw('POST', '/api/teammates/ada-quill/tasks', { headers: bearer, body: { task: 'x' } })).status, 403);
  assert.equal((await raw('GET', '/api/teammates', { headers: bearer })).status, 403);
  assert.equal((await raw('GET', '/api/admin/keys', { headers: bearer })).status, 403);
  assert.equal((await raw('POST', '/api/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'second' } })).status, 200);
  const limited = await raw('POST', '/api/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'third' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);

  const owner = await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'Owner task' });
  assert.equal(owner.body.entry.callerType, 'user');

  assert.equal((await app.send('DELETE', `/api/admin/keys/${record.id}`)).body.revokedAt != null, true);
  assert.equal((await raw('POST', '/api/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'x' } })).status, 401);
  assert.equal((await raw('POST', '/api/teammates/wren-sato/tasks', { headers: { Authorization: 'Bearer dtk_fake_key' }, body: { task: 'x' } })).status, 401);

  const audit = await app.get('/api/admin/audit');
  const actions = audit.body.entries.map((e) => e.action);
  for (const a of ['api_key.create', 'api_key.revoke', 'session.login']) assert.ok(actions.includes(a), a);
});

test('signing out ends the core session and its token', async () => {
  const second = await coreSignIn(app.base, OWNER_EMAIL, OWNER_PASSWORD);
  const headers = { 'Content-Type': 'application/json', Cookie: second.cookie, 'X-CSRF-Token': second.csrf };
  assert.equal((await fetch(`${app.base}/api/teammates`, { headers })).status, 200);
  const out = await fetch(`${app.base}/api/session`, { method: 'DELETE', headers, body: JSON.stringify({ token: second.token }) });
  assert.equal(out.status, 204);
  assert.equal((await fetch(`${app.base}/api/teammates`, { headers })).status, 401);
  const validate = await fetch(`${app.base}/services/authservice/api/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: second.token }) });
  assert.notEqual((await validate.json()).success, true, 'core token no longer valid');
  // Other sessions are untouched.
  assert.equal((await app.get('/api/teammates')).status, 200);
  assert.ok((await app.get('/api/admin/audit')).body.entries.some((e) => e.action === 'session.logout'));
});
