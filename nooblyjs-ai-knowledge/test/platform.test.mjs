// The Wiki Platform's API modules behind the hosted router (src/hosted/platform.cjs, legacyApp.cjs): they run on a
// real nooblyjs-core registry, the way NooblyJS hands it over, under Express 5. One registry per process, so this file starts
// the app once and every test reads from it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import express from 'express5';
import { register } from '../index.mjs';
import { createHost, PERSON_HEADER } from './fixtures/host.mjs';
import { filesUnder, FALLBACK } from './helpers.mjs';

const require = createRequire(import.meta.url);
const registry = require('nooblyjs-core');
const { mapPath, toExpress5 } = require('../src/hosted/legacyApp.cjs');

let t;

before(async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nooblyjs-ai-knowledge-platform-'));
  const dataDir = path.join(rootDir, 'wiki');
  await fs.mkdir(dataDir, { recursive: true });
  const app = express();
  app.set('query parser', 'extended');
  app.use(express.json({ limit: '10mb' }));
  // What NooblyJS's Passport leaves on the request: the nooblyjs-core user. The stand-in host's sign-in sets req.person
  // from the same header.
  app.use((req, res, next) => {
    const id = req.get(PERSON_HEADER);
    req.isAuthenticated = () => Boolean(id);
    if (id) req.user = { id, username: id, email: `${id}@noobly.local`, roles: id === 'stevie' ? ['admin'] : ['user'], isAdmin: id === 'stevie', isActive: true };
    next();
  });
  registry.setDefaultProvider('logging', 'console', { logDir: path.join(rootDir, 'logs'), log: { level: 'error' } });
  registry.initialize(app, new EventEmitter(), {
    logDir: path.join(rootDir, 'logs'),
    dataDir: path.join(rootDir, 'core'),
    security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } },
  });
  registry.authservice('file', { dataDir: path.join(rootDir, 'core', 'auth') });
  const stand = createHost({ rootDir });
  const hosted = await register(app, registry, { dataDir, host: stand.hostFor(dataDir) });
  app.use((req, res) => res.status(404).type('text').send(FALLBACK));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, url, { as = 'stevie', body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(as ? { [PERSON_HEADER]: as } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  t = { rootDir, dataDir, hosted, stand, server, call };
});

after(async () => {
  await t?.hosted.close();
  await new Promise((resolve) => t.server.close(resolve));
});

test('the standalone URLs map under the mount path, and nothing else is mounted', () => {
  assert.equal(mapPath('/applications/wiki/api/spaces/:id'), '/api/v1/spaces/:id');
  assert.equal(mapPath('/applications/wiki/api'), '/api/v1');
  assert.equal(mapPath('/api/workflows/:id'), '/api/v1/ds/workflows/:id');
  assert.equal(mapPath('/applications/wiki/avatars'), '/avatars');
  for (const standaloneOnly of ['/login', '/wizard', '/applications/wiki/js', '/applications/datasources', '/apiary']) assert.equal(mapPath(standaloneOnly), null, standaloneOnly);
});

test('Express 4 wildcards become Express 5 ones', () => {
  assert.deepEqual(toExpress5('/api/v1/documents/:path(*)'), { path: '/api/v1/documents/{*path}', wildcards: ['path'] });
  assert.deepEqual(toExpress5('/api/v1/content/json/:path(*)/download'), { path: '/api/v1/content/json/{*path}/download', wildcards: ['path'] });
  assert.deepEqual(toExpress5('/api/v1/ds/spaces/:id/files/browse/*'), { path: '/api/v1/ds/spaces/:id/files/browse/{*splat}', wildcards: ['0'] });
  assert.deepEqual(toExpress5('/api/v1/spaces/:id'), { path: '/api/v1/spaces/:id', wildcards: [] });
});

test('the wiki and datasources APIs answer under /api/v1, signed-in only', async () => {
  assert.equal((await t.call('GET', '/wiki/api/v1/about')).json.hosted.platform, true);
  const spaces = await t.call('GET', '/wiki/api/v1/spaces');
  assert.equal(spaces.status, 200);
  assert.equal(spaces.json.length, 1); // the platform creates a default space on first start
  assert.equal((await t.call('GET', '/wiki/api/v1/ds/spaces')).json.count, 1);
  assert.equal((await t.call('GET', '/wiki/api/v1/config')).status, 200);
  // Hosted, the datasources API asks for a sign-in and no role: a Viewer reads what an Owner reads.
  for (const url of ['/wiki/api/v1/ds/workflows/dashboard', '/wiki/api/v1/ds/spaces', '/wiki/api/v1/ds/prompts', '/wiki/api/v1/ds/agents']) {
    assert.equal((await t.call('GET', url, { as: 'naledi-k' })).status, 200, url);
  }

  for (const url of ['/wiki/api/v1/spaces', '/wiki/api/v1/ds/spaces', '/wiki/api/v1/config', '/wiki/api/v1/health']) {
    const out = await t.call('GET', url, { as: null });
    assert.equal(out.status, 401, url);
    assert.equal(out.json.error.code, 'unauthenticated', url);
  }
  const missing = await t.call('GET', '/wiki/api/v1/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, 'not_found');
});

test('a wildcard route takes a nested path, an empty one, and a write', async () => {
  const spaceId = (await t.call('GET', '/wiki/api/v1/spaces')).json[0].id;
  const written = await t.call('POST', `/wiki/api/v1/spaces/${spaceId}/file-content/Guides/Deep/Note.md`, { body: { content: '# Note\n\nnested' } });
  assert.equal(written.status, 200, written.text);
  assert.equal(written.json.path, 'Guides/Deep/Note.md');
  const back = await t.call('GET', `/wiki/api/v1/spaces/${spaceId}/file-content/Guides/Deep/Note.md`);
  assert.match(back.json.content, /nested/);
  const root = await t.call('GET', `/wiki/api/v1/spaces/${spaceId}/file-list/`);
  assert.equal(root.status, 200);
  assert.ok(root.json.files.some((f) => f.name === 'Guides'));
});

test('a file change reaches the host\'s event stream and the wiki\'s own change feed', async () => {
  const spaceId = (await t.call('GET', '/wiki/api/v1/spaces')).json[0].id;
  const since = new Date(Date.now() - 1000).toISOString();
  await t.call('POST', `/wiki/api/v1/spaces/${spaceId}/file-content/Watched.md`, { body: { content: '# Watched' } });
  // The file watcher debounces, then the event bus broadcasts.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !t.stand.eventLog.some((e) => e.type === 'wiki.file_changed')) await new Promise((r) => setTimeout(r, 200));
  assert.ok(t.stand.eventLog.some((e) => e.type === 'wiki.file_changed'), 'no wiki.file_changed event was emitted');
  const feed = await t.call('GET', `/wiki/api/v1/changes?since=${encodeURIComponent(since)}`);
  assert.equal(feed.status, 200);
  assert.ok(feed.json.events.length > 0);
});

test('everything is written under dataDir', async () => {
  const outside = (await filesUnder(t.rootDir)).map((f) => f.split(path.sep)[0]).filter((top) => !['wiki', 'core', 'logs'].includes(top));
  assert.deepEqual(outside, []); // core/ and logs/ are the test's own nooblyjs-core folders
  assert.ok((await filesUnder(t.dataDir)).length > 0);
});
