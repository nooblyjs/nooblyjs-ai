// Development sign-in, the placeholder home, CSRF, and the audit and event records sign-in writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, today, eventually } from './helpers.js';

let env;
before(async () => { env = await startApp(); });
after(async () => { await env?.stop(); });

test('GET /healthz answers without signing in', async () => {
  const { status, body } = await env.client().json('/healthz');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.deepEqual(Object.keys(body).sort(), ['status', 'version'], 'open to anyone, so nothing about the machine');
  assert.ok(body.version);
});

test('signed out: pages go to /login, APIs answer 401 in the standard shape', async () => {
  const c = env.client();
  const page = await c.get('/');
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login?next=%2F');
  const api = await c.json('/api/v1/me');
  assert.equal(api.status, 401);
  assert.deepEqual(api.body, { error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
});

test('/login lists the five seeded people', async () => {
  const html = await (await env.client().get('/login')).text();
  for (const name of ['Stevie', 'Lerato M.', 'Thabo N.', 'Priya S.', 'Naledi K.']) assert.ok(html.includes(name), `missing ${name}`);
  assert.ok(html.includes('New joiner'));
});

test('picking Lerato signs her in, says who she is, and is audited and evented', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  const home = await c.get('/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<script type="module" src="\/ui\/js\/frame\.js">/, 'the frame page');
  const shell = await c.json('/api/v1/shell');
  assert.deepEqual(shell.body.person, { id: 'lerato-m', name: 'Lerato M.', accessRole: 'Approver', workRole: 'product-manager', teams: ['delivery-squad'] });
  const me = await c.json('/api/v1/me');
  assert.equal(me.body.person.accessRole, 'Approver');

  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'session.signed_in' && r.actor === 'lerato-m' && r.status === 302));
  });
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'session.signed_in' && e.actor === 'lerato-m'));
});

test('a write without the CSRF token is refused and audited', async () => {
  const c = env.client();
  await c.signIn('priya-s');
  const res = await c.request('/logout', { method: 'POST', csrf: false });
  assert.equal(res.status, 403);
  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'csrf.refused' && r.actor === 'priya-s' && r.status === 403));
  });
  assert.equal((await c.json('/api/v1/me')).status, 200, 'still signed in');
});

test('an unknown person cannot sign in, and a redirect never leaves the site', async () => {
  const c = env.client();
  await c.get('/login');
  const bad = await c.post('/login', { form: { personId: 'nobody', _csrf: c.jar.get('noobly.csrf') } });
  assert.equal(bad.status, 400);
  const ok = await c.post('/login', { form: { personId: 'thabo-n', next: '//evil.example/x', _csrf: c.jar.get('noobly.csrf') } });
  assert.equal(ok.headers.get('location'), '/');
});

test('sign out ends the session', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const out = await c.post('/logout');
  assert.equal(out.status, 302);
  assert.equal(out.headers.get('location'), '/login');
  assert.equal((await c.json('/api/v1/me')).status, 401);
});
