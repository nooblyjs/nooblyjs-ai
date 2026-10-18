// middleware/auth.js: CSRF on changes, sign-in failures, and roles from the host's access roles.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, coreSignIn, ensureCoreUser } from '../helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const raw = (method, url, { headers = {}, body } = {}) =>
  fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
/** Signs in on core's login page as `email` and returns a caller that sends that session's cookie and CSRF token. */
const login = async (email, password) => {
  const res = await coreSignIn(app, email, password);
  if (!res.cookie) return { status: res.status };
  const call = async (method, url, body) => {
    const r = await fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json', Cookie: res.cookie, 'X-CSRF-Token': res.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  };
  return { status: res.status, call };
};

test('changes need the CSRF header, reads do not', async () => {
  const noCsrf = await raw('PATCH', '/api/v1/teammates/ada-quill', { headers: { Cookie: app.session.cookie }, body: { rate: 50 } });
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).error.code, 'csrf_failed');
  assert.equal((await raw('GET', '/api/v1/teammates/ada-quill', { headers: { Cookie: app.session.cookie } })).status, 200);
});

test('wrong passwords are refused, and repeated failures lock the account for a while', async () => {
  await ensureCoreUser(app.coreAuth, { email: 'locky@example.com', fullName: 'Locky', password: 'Locky-Pass-1234', role: 'viewer' });
  assert.equal((await coreSignIn(app, 'locky@example.com', 'nope nope nope')).status, 401);
  const statuses = [];
  for (let i = 0; i < 9; i++) statuses.push((await coreSignIn(app, 'locky@example.com', 'nope nope nope')).status);
  assert.ok(statuses.includes(429), 'locked out');
  assert.equal((await coreSignIn(app, 'locky@example.com', 'Locky-Pass-1234')).status, 429, 'even with the right password');
});

test("roles come from the host's access roles: viewers read, managers run work, owners administer", async () => {
  const core = app.coreAuth; // the stand-in host's people are nooblyjs-core users
  await ensureCoreUser(core, { email: 'vic@example.com', fullName: 'Vic Viewer', password: 'Vic-Viewer-123', role: 'viewer' });
  await ensureCoreUser(core, { email: 'mo@example.com', fullName: 'Mo Manager', password: 'Mo-Manager-123', role: 'manager' });
  await ensureCoreUser(core, { email: 'una@example.com', fullName: 'Una User', password: 'Una-User-1234', role: 'user' });

  // Admin → People lists everyone who can sign in, with their access role and the Teammates role it gives them.
  const people = (await app.get('/api/v1/admin/users')).body.users;
  const roleOf = (email) => people.find((u) => u.email === email)?.role;
  assert.deepEqual(['admin@localhost', 'vic@example.com', 'mo@example.com', 'una@example.com'].map(roleOf), ['owner', 'viewer', 'manager', 'viewer']);
  assert.deepEqual(['admin@localhost', 'vic@example.com', 'mo@example.com', 'una@example.com'].map((e) => people.find((u) => u.email === e)?.accessRole), ['Owner', 'Viewer', 'Approver', 'Viewer']);
  assert.ok(people.every((u) => u.password === undefined));

  assert.equal((await login('vic@example.com', 'Wrong-Password-1')).status, 401);
  const v = await login('vic@example.com', 'Vic-Viewer-123');
  assert.equal(v.status, 200);
  assert.deepEqual((await v.call('GET', '/api/v1/session')).body.user, { id: 'vic@example.com', name: 'Vic Viewer', username: 'vic@example.com', role: 'viewer', accessRole: 'Viewer' });
  assert.equal((await v.call('GET', '/api/v1/teammates')).status, 200);
  assert.equal((await v.call('GET', '/api/v1/billing')).status, 200);
  assert.equal((await v.call('PATCH', '/api/v1/teammates/ada-quill', { rate: 1 })).status, 403);
  assert.equal((await v.call('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'x' })).status, 403);
  assert.equal((await v.call('GET', '/api/v1/settings')).status, 403);
  assert.equal((await v.call('GET', '/api/v1/admin/users')).status, 403);
  // The host refused those, through its permissions, and audited each refusal.
  assert.ok(app.host.auditLog.some((e) => e.action === 'access.refused' && e.actor === 'vic@example.com' && e.permission === 'set-budgets'));
  assert.ok(app.host.auditLog.some((e) => e.action === 'access.refused' && e.actor === 'vic@example.com' && e.permission === 'approve'));
  // Anyone with only core's default role is a Viewer too.
  assert.equal((await (await login('una@example.com', 'Una-User-1234')).call('GET', '/api/v1/session')).body.user.role, 'viewer');

  const m = await login('mo@example.com', 'Mo-Manager-123');
  assert.equal((await m.call('PATCH', '/api/v1/teammates/pip-okafor', { currentTask: 'Sorting the rota' })).status, 200);
  assert.equal((await m.call('POST', '/api/v1/teammates/pip-okafor/tasks', { task: 'Draft the rota' })).body.entry.caller, 'Mo Manager');
  assert.equal((await m.call('PATCH', '/api/v1/settings', { budgets: { month: 1 } })).status, 403);
  assert.equal((await m.call('POST', '/api/v1/invoices', { month: '2026-09' })).status, 403);
  assert.equal((await m.call('GET', '/api/v1/admin/audit')).status, 403);

  // A role given on core's Authentication dashboard (the stand-in host's people) applies straight away.
  await core.addUserToRole('vic@example.com', 'manager');
  assert.equal((await v.call('GET', '/api/v1/session')).body.user.role, 'manager');
  assert.equal((await v.call('PATCH', '/api/v1/teammates/pip-okafor', { currentTask: 'Checking the rota' })).status, 200);

  // A core admin is an Owner here.
  await ensureCoreUser(core, { email: 'ada.admin@example.com', fullName: 'Ada Admin', password: 'Ada-Admin-1234', role: 'admin' });
  const admin = await login('ada.admin@example.com', 'Ada-Admin-1234');
  assert.equal((await admin.call('GET', '/api/v1/session')).body.user.role, 'owner');
  assert.equal((await admin.call('GET', '/api/v1/admin/keys')).status, 200);

  // Sign-ins are the host's to record.
  assert.ok(app.host.auditLog.some((e) => e.action === 'session.login' && e.actor === 'mo@example.com'));
});
