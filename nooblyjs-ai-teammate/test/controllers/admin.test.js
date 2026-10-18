// controllers/admin.js: API keys for calling teammates.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, OWNER_EMAIL } from '../helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const raw = (method, url, { headers = {}, body } = {}) =>
  fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('API keys are shown once, scoped, rate limited and revocable; calls are attributed', async () => {
  const created = await app.send('POST', '/api/v1/admin/keys', { name: 'CI pipeline', teammates: ['wren-sato'], rateLimit: 2 });
  assert.equal(created.status, 201);
  const { key, record } = created.body;
  assert.match(key, /^dtk_/);
  assert.equal(record.hash, undefined);
  const listed = await app.get('/api/v1/admin/keys');
  assert.ok(listed.body.keys.some((k) => k.id === record.id && !k.hash && !k.key));

  const bearer = { Authorization: `Bearer ${key}` };
  const call = await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'Brief on Globex' } });
  assert.equal(call.status, 200);
  const result = await call.json();
  assert.equal(result.entry.caller, 'CI pipeline');
  assert.equal(result.entry.callerType, 'key');
  const work = await app.get(`/api/v1/teammates/wren-sato/work/${result.workId}`);
  assert.deepEqual(work.body.caller, { type: 'key', id: record.id, name: 'CI pipeline' });

  assert.equal((await raw('POST', '/api/v1/teammates/ada-quill/tasks', { headers: bearer, body: { task: 'x' } })).status, 403);
  assert.equal((await raw('GET', '/api/v1/teammates', { headers: bearer })).status, 403);
  assert.equal((await raw('GET', '/api/v1/admin/keys', { headers: bearer })).status, 403);
  assert.equal((await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'second' } })).status, 200);
  const limited = await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'third' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);

  const owner = await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Owner task' });
  assert.equal(owner.body.entry.callerType, 'user');

  assert.equal((await app.send('DELETE', `/api/v1/admin/keys/${record.id}`)).body.revokedAt != null, true);
  assert.equal((await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'x' } })).status, 401);
  assert.equal((await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: { Authorization: 'Bearer dtk_fake_key' }, body: { task: 'x' } })).status, 401);

  const audit = await app.get('/api/v1/admin/audit');
  const actions = audit.body.entries.map((e) => e.action);
  for (const a of ['api_key.create', 'api_key.revoke']) assert.ok(actions.includes(a), a);
  // Sign-ins are the host's, so they are in its audit log; writes are there too.
  assert.ok(app.host.auditLog.some((e) => e.action === 'session.login' && e.actor === OWNER_EMAIL));
  assert.ok(app.host.auditLog.some((e) => e.action === `POST ${app.mountPath}/api/v1/admin/keys` && e.actor === OWNER_EMAIL && e.status === 201));
});
