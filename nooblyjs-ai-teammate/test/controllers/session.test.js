// controllers/session.js: who is signed in, and signing out.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, coreSignIn, OWNER_EMAIL, OWNER_PASSWORD } from '../helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('the API is for signed-in people only (the host decides), and reports the session state', async () => {
  const anon = await app.get('/api/v1/teammates', { auth: false });
  assert.equal(anon.status, 401);
  assert.equal(anon.body.error.code, 'unauthenticated');
  assert.equal((await app.get('/api/v1/session', { auth: false })).status, 401);
  assert.equal((await app.get('/api/v1/health', { auth: false })).status, 200, 'health checks stay public');
  const check = (cookie) => fetch(`${app.base}/api/auth/check`, { headers: cookie ? { Cookie: cookie } : {} }).then((r) => r.json());
  assert.deepEqual(await check(), { authenticated: false }, "the host's check, for core's login page");
  const signedIn = await app.get('/api/v1/session');
  assert.equal(signedIn.body.authenticated, true);
  assert.deepEqual(signedIn.body.user, { id: OWNER_EMAIL, name: 'Stevie', username: OWNER_EMAIL, role: 'owner', accessRole: 'Owner' });
  assert.equal(signedIn.body.csrf, app.session.csrf);
  assert.equal(signedIn.body.links.signIn, '/services/authservice/views/login.html');
  assert.deepEqual(await check(app.session.cookie), { authenticated: true });
});

test('signing out ends the core session and its token', async () => {
  const second = await coreSignIn(app, OWNER_EMAIL, OWNER_PASSWORD);
  const headers = { 'Content-Type': 'application/json', Cookie: second.cookie, 'X-CSRF-Token': second.csrf };
  assert.equal((await fetch(`${app.url}/api/v1/teammates`, { headers })).status, 200);
  const out = await fetch(`${app.url}/api/v1/session`, { method: 'DELETE', headers, body: JSON.stringify({ token: second.token }) });
  assert.equal(out.status, 204);
  assert.equal((await fetch(`${app.url}/api/v1/teammates`, { headers })).status, 401);
  const validate = await fetch(`${app.base}/services/authservice/api/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: second.token }) });
  assert.notEqual((await validate.json()).success, true, 'core token no longer valid');
  // Other sessions are untouched.
  assert.equal((await app.get('/api/v1/teammates')).status, 200);
  assert.ok((await app.get('/api/v1/admin/audit')).body.entries.some((e) => e.action === 'session.logout'));
});
