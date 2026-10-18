// The hosted-app contract (structure.md §2a): mount, frame fallback, /api/v1/shell, auth, roles, services, seed,
// and failure isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, today, eventually } from './helpers.js';

let env;
before(async () => {
  env = await startApp({
    hostedApps: [
      { path: 'test/fixtures/hello-app', mountPath: '/hello', enabled: true },
      { path: 'test/fixtures/broken-app', mountPath: '/broken', enabled: true },
      { package: 'nooblyjs-ai-factory', mountPath: '/factory', enabled: false },
    ],
  });
});
after(async () => { await env?.stop(); });

test('/api/v1/shell lists hello-app ready, broken-app unavailable and factory not installed', async () => {
  const c = env.client();
  await c.signIn('lerato-m');
  const { status, body } = await c.json('/api/v1/shell');
  assert.equal(status, 200);
  assert.equal(body.person.id, 'lerato-m');
  const by = Object.fromEntries(body.apps.map((a) => [a.mountPath, a]));
  assert.equal(by['/hello'].state, 'ready');
  assert.equal(by['/hello'].name, 'hello-app');
  assert.deepEqual(by['/hello'].ui, { entry: 'js/module.js', styles: ['css/hello.css'] });
  assert.equal(by['/broken'].state, 'unavailable');
  assert.equal(by['/factory'].state, 'not-installed');
});

test('nav rows a person lacks the permission for are left out', async () => {
  const owner = env.client();
  await owner.signIn('stevie');
  const lerato = env.client();
  await lerato.signIn('lerato-m');
  const navOf = async (c) => (await c.json('/api/v1/shell')).body.apps.find((a) => a.mountPath === '/hello').nav.map((n) => n.key);
  assert.deepEqual(await navOf(owner), ['home', 'owners']);
  assert.deepEqual(await navOf(lerato), ['home']);
});

test('the API answers only when signed in', async () => {
  const c = env.client();
  assert.equal((await c.json('/hello/api/v1/ping')).status, 401);
  await c.signIn('priya-s');
  const { status, body } = await c.json('/hello/api/v1/ping');
  assert.equal(status, 200);
  assert.equal(body.person, 'priya-s');
  assert.equal(body.dataDir, path.join(env.dataDir, 'hello'));
});

test('deep links get the frame (signed in) or go to /login, and public files are served', async () => {
  const anon = env.client();
  const redirect = await anon.get('/hello/anything/here');
  assert.equal(redirect.status, 302);
  assert.match(redirect.headers.get('location'), /^\/login\?next=%2Fhello%2Fanything%2Fhere/);
  const c = env.client();
  await c.signIn('thabo-n');
  for (const p of ['/hello', '/hello/', '/hello/anything/here']) {
    const res = await c.get(p);
    assert.equal(res.status, 200, p);
    assert.match(await res.text(), /src="\/ui\/js\/frame\.js"/, `${p} gets the frame`);
  }
  const mod = await c.get('/hello/js/module.js');
  assert.equal(mod.status, 200);
  assert.match(mod.headers.get('content-type'), /javascript/);
  assert.match(await mod.text(), /export const routes/);
});

test('a role refusal is a 403 in the audit log; an allowed write writes under data/hello and emits', async () => {
  const viewer = env.client();
  await viewer.signIn('naledi-k');
  const refused = await viewer.json('/hello/api/v1/notes', { method: 'POST', json: { text: 'hi' } });
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error.code, 'forbidden');

  const author = env.client();
  await author.signIn('priya-s');
  const created = await author.json('/hello/api/v1/notes', { method: 'POST', json: { text: 'hi' } });
  assert.equal(created.status, 201);
  const notes = await fs.readdir(path.join(env.dataDir, 'hello', 'notes'));
  assert.ok(notes.includes(`${created.body.id}.md`));

  await eventually(async () => {
    const audit = await today(env.store, 'audit');
    assert.ok(audit.some((r) => r.action === 'access.refused' && r.actor === 'naledi-k' && r.permission === 'draft' && r.status === 403));
    assert.ok(audit.some((r) => r.action === 'POST /hello/api/v1/notes' && r.actor === 'priya-s' && r.status === 201));
  });
  const events = await today(env.store, 'events');
  assert.ok(events.some((e) => e.type === 'hello.note_added' && e.actor === 'priya-s'));
});

test('the app seeded its own folder on first start and its services are reachable', async () => {
  const welcome = await fs.readFile(path.join(env.dataDir, 'hello', 'notes', 'welcome.md'), 'utf8');
  assert.match(welcome, /seeded: true/);
  const c = env.client();
  await c.signIn('stevie');
  assert.equal((await c.json('/hello/api/v1/greeting')).body.text, 'Hello, Stevie');
});

test('/api/v1/shell/status returns each ready app\'s status', async () => {
  const c = env.client();
  await c.signIn('stevie');
  const { body } = await c.json('/api/v1/shell/status');
  assert.deepEqual(body['hello-app'].badges, { home: 1 });
  assert.equal(body.broken, undefined);
});

test('NooblyJS started even though broken-app failed, and nothing was written for it', async () => {
  assert.equal((await env.client().json('/healthz')).status, 200);
  await assert.rejects(fs.access(path.join(env.dataDir, 'broken', 'notes')));
});
