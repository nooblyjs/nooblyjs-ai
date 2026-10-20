// The hosted-app contract (structure.md §2a): mount, frame fallback, /api/v1/shell, auth, roles, services, seed,
// and failure isolation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { startApp, today, eventually } from './helpers.js';
import { foldData, FOLDED, UNFOLDED } from '../src/hosted-apps.js';

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
  // `provides` as an object: each name is services of its own (the Software Factory's sections).
  assert.equal((await c.json('/hello/api/v1/section-greeting')).body.text, 'A wave for Stevie');
});

test('apps that are part of another now: their data moves once to where that app keeps it, and never over data that is there', async () => {
  const quiet = { info: () => {}, warn: () => {} };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-fold-'));
  try {
    await fs.mkdir(path.join(dir, 'product', 'specs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'product', 'specs', 'PRD-031.md'), '---\nid: PRD-031\n---\n');
    await fs.mkdir(path.join(dir, 'factory'), { recursive: true });
    const moved = await foldData(dir, quiet);
    assert.deepEqual(moved.map((m) => m.name), ['nooblyjs-ai-product']);
    assert.equal(await fs.readFile(path.join(dir, 'factory', 'product', 'specs', 'PRD-031.md'), 'utf8'), '---\nid: PRD-031\n---\n');
    await assert.rejects(fs.stat(path.join(dir, 'product')), 'the old folder is gone');
    // A second start finds nothing to move.
    assert.deepEqual(await foldData(dir, quiet), []);
    // Both there: nothing is moved, and the log says so.
    await fs.mkdir(path.join(dir, 'product'));
    await fs.writeFile(path.join(dir, 'product', 'stray.md'), 'x');
    const warned = [];
    assert.deepEqual(await foldData(dir, { info: () => {}, warn: (m) => warned.push(m) }), []);
    assert.match(warned.join('\n'), /both .*product and .*factory\/product exist; nothing was moved/);
    assert.ok(await fs.stat(path.join(dir, 'product', 'stray.md')));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  assert.deepEqual(Object.keys(FOLDED).sort(), ['nooblyjs-ai-product', 'nooblyjs-ai-workflows']);
});

test('an app that is its own again (Infrastructure, CHG-007): its data moves back out once, and an install that had it lists it again', async () => {
  const quiet = { info: () => {}, warn: () => {} };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-unfold-'));
  const listing = path.join(dir, 'config', 'hosted-apps.yaml');
  try {
    // An install seeded while Infrastructure was a section of the Software Factory: its data there, no entry for it.
    await fs.mkdir(path.join(dir, 'factory', 'infrastructure', 'designs'), { recursive: true });
    await fs.writeFile(path.join(dir, 'factory', 'infrastructure', 'designs', 'INF-031.md'), '---\nid: INF-031\n---\n');
    await fs.mkdir(path.join(dir, 'infrastructure')); // empty: may be replaced
    await fs.mkdir(path.join(dir, 'config'));
    await fs.writeFile(listing, '# Our apps.\napps:\n  - { package: nooblyjs-ai-factory, mountPath: /factory, enabled: true }');
    const moved = await foldData(dir, quiet);
    assert.deepEqual(moved.map((m) => m.name), ['nooblyjs-ai-infrastructure']);
    assert.equal(await fs.readFile(path.join(dir, 'infrastructure', 'designs', 'INF-031.md'), 'utf8'), '---\nid: INF-031\n---\n');
    await assert.rejects(fs.stat(path.join(dir, 'factory', 'infrastructure')), 'the section folder is gone');
    // Its entry is a line added at the end: what was there, comments too, stays as it was.
    assert.equal(await fs.readFile(listing, 'utf8'), '# Our apps.\napps:\n  - { package: nooblyjs-ai-factory, mountPath: /factory, enabled: true }\n  - { package: nooblyjs-ai-infrastructure, mountPath: /infrastructure, enabled: true }\n');
    // A second start finds nothing to move and adds nothing.
    assert.deepEqual(await foldData(dir, quiet), []);
    // Both there: nothing is moved, and the log says so.
    await fs.mkdir(path.join(dir, 'factory', 'infrastructure'));
    await fs.writeFile(path.join(dir, 'factory', 'infrastructure', 'stray.md'), 'x');
    const warned = [];
    assert.deepEqual(await foldData(dir, { info: () => {}, warn: (m) => warned.push(m) }), []);
    assert.match(warned.join('\n'), /both .*factory\/infrastructure and .*infrastructure exist; nothing was moved/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  // An install that listed it all along (switched off, too) keeps its own entry.
  const kept = await fs.mkdtemp(path.join(os.tmpdir(), 'noobly-unfold-'));
  try {
    await fs.mkdir(path.join(kept, 'factory', 'infrastructure'), { recursive: true });
    await fs.writeFile(path.join(kept, 'factory', 'infrastructure', 'seed.yaml'), 'story: INF-031\n');
    await fs.mkdir(path.join(kept, 'config'));
    const before = 'apps:\n  - { package: nooblyjs-ai-infrastructure, mountPath: /infrastructure, enabled: false }\n';
    await fs.writeFile(path.join(kept, 'config', 'hosted-apps.yaml'), before);
    assert.equal((await foldData(kept, quiet)).length, 1);
    assert.equal(await fs.readFile(path.join(kept, 'config', 'hosted-apps.yaml'), 'utf8'), before);
  } finally {
    await fs.rm(kept, { recursive: true, force: true });
  }
  assert.deepEqual(Object.keys(UNFOLDED), ['nooblyjs-ai-infrastructure']);
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
