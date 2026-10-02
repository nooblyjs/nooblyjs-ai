import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, OWNER_PASSWORD } from './helpers.js';

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
  assert.deepEqual([state.body.authenticated, state.body.setupRequired], [false, false]);
  const signedIn = await app.get('/api/session');
  assert.equal(signedIn.body.authenticated, true);
  assert.equal(signedIn.body.csrf, app.session.csrf);
});

test('changes need the CSRF header, reads do not', async () => {
  const noCsrf = await raw('PATCH', '/api/teammates/ada-quill', { headers: { Cookie: app.session.cookie }, body: { rate: 50 } });
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).error.code, 'csrf_failed');
  assert.equal((await raw('GET', '/api/teammates/ada-quill', { headers: { Cookie: app.session.cookie } })).status, 200);
});

test('wrong passwords are refused and throttled', async () => {
  const other = await startApp({ login: false });
  try {
    assert.equal((await other.signIn('nope nope nope')).status, 401);
    for (let i = 0; i < 9; i++) await other.signIn('nope nope nope');
    assert.equal((await other.signIn(OWNER_PASSWORD)).status, 429);
  } finally {
    other.close();
  }
});

test('first run asks for the setup code printed in the log', async () => {
  const fresh = await startApp({ login: false, ownerPassword: undefined });
  try {
    assert.equal((await fresh.get('/api/session')).body.setupRequired, true);
    const bad = await fetch(`${fresh.base}/api/session/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'AAAA-BBBB', password: 'a long password' }) });
    assert.equal(bad.status, 401);
    const short = await fetch(`${fresh.base}/api/session/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: fresh.auth.setupCode, password: 'short' }) });
    assert.equal(short.status, 422);
    const ok = await fetch(`${fresh.base}/api/session/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: fresh.auth.setupCode.toLowerCase(), password: 'a long password' }) });
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).csrf);
    assert.equal((await fresh.signIn('a long password')).status, 200);
    assert.equal((await fresh.get('/api/session')).body.setupRequired, false);
  } finally {
    fresh.close();
  }
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

test('changing the password signs out other sessions', async () => {
  const second = await startApp({ login: true });
  try {
    const old = { ...second.session };
    const changed = await second.send('POST', '/api/admin/password', { current: OWNER_PASSWORD, next: 'an even longer password' });
    assert.equal(changed.status, 200);
    const stale = await fetch(`${second.base}/api/teammates`, { headers: { Cookie: old.cookie } });
    assert.equal(stale.status, 401);
    assert.equal((await second.signIn('an even longer password')).status, 200);
  } finally {
    second.close();
  }
});
