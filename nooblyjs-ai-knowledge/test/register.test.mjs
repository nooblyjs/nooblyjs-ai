// The hosted-app contract (noobly structure.md §2a; the hosted-app checklist in noobly roadmap.md): register() mounts once under the mount path without
// listening, the API is signed-in only, pages answer with the host's frame, nothing is written outside dataDir, and
// a refused start leaves nothing mounted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express5';
import { register, DEFAULT_MOUNT_PATH } from '../index.mjs';
import { createHost, createTestServerManager } from './fixtures/host.mjs';
import { startApp, filesUnder, FALLBACK } from './helpers.mjs';

test('register() mounts at /wiki by default and describes the app', async () => {
  const t = await startApp();
  try {
    assert.equal(t.registerError, null);
    assert.equal(DEFAULT_MOUNT_PATH, '/wiki');
    assert.equal(t.hosted.name, 'wiki');
    assert.equal(t.hosted.mountPath, '/wiki');
    assert.equal(typeof t.hosted.close, 'function');
    assert.equal(typeof t.hosted.seed, 'function');
    // The host's serverManager is used as given, never initialised here (its initialize() throws).
    assert.deepEqual(t.serverManager.calls.map((c) => `${c.service}:${c.instanceName}`), ['logging:wiki']);
    assert.ok(t.serverManager.lines.some((l) => /mounted wiki at \/wiki/.test(l.message)));
  } finally {
    await t.close();
  }
});

test('the API is under /api/v1: 401 when signed out, an answer when signed in', async () => {
  const t = await startApp();
  try {
    const out = await t.get('/wiki/api/v1/about');
    assert.equal(out.status, 401);
    assert.equal(out.json.error.code, 'unauthenticated');

    const about = await t.get('/wiki/api/v1/about', { as: 'naledi-k' });
    assert.equal(about.status, 200);
    assert.equal(about.json.name, 'wiki');
    assert.equal(about.json.mountPath, '/wiki');
    assert.deepEqual(about.json.hosted, { platform: false });

    const missing = await t.get('/wiki/api/v1/nope', { as: 'naledi-k' });
    assert.equal(missing.status, 404);
    assert.deepEqual(Object.keys(missing.json.error), ['code', 'message', 'details']);
  } finally {
    await t.close();
  }
});

test('it works under another mount path and adds nothing outside it', async () => {
  const t = await startApp({ mountPath: '/knowledge' });
  try {
    assert.equal((await t.get('/knowledge/api/v1/about', { as: 'stevie' })).json.mountPath, '/knowledge');
    for (const url of ['/wiki/api/v1/about', '/api/v1/about', '/js/module.js', '/']) {
      const res = await t.get(url, { as: 'stevie' });
      assert.equal(res.text, FALLBACK, url);
    }
  } finally {
    await t.close();
  }
});

test('nothing is written under dataDir or beside it', async () => {
  const t = await startApp();
  try {
    await t.get('/wiki/api/v1/about', { as: 'stevie' });
    await t.hosted.seed({ reset: false });
    await t.hosted.status();
    assert.deepEqual(await filesUnder(t.rootDir), []);
  } finally {
    await t.close();
  }
});

test('register() refuses a bad start before mounting anything', async () => {
  const ok = () => {
    const stand = createHost();
    return { app: express(), serverManager: createTestServerManager(), options: { dataDir: 'x', host: stand.hostFor(process.cwd()) } };
  };
  const cases = [
    ['no app', (c) => { c.app = null; }, /Express app/],
    ['serverManager not initialised', (c) => { c.serverManager.initialized = false; }, /initialised serverManager/],
    ['a bad mount path', (c) => { c.options.mountPath = 'wiki'; }, /mountPath/],
    ['no dataDir', (c) => { delete c.options.dataDir; }, /dataDir/],
    ['no host.frame', (c) => { delete c.options.host.frame; }, /host\.frame/],
    ['no host.auth', (c) => { delete c.options.host.auth; }, /host\.auth/],
  ];
  for (const [name, breakIt, message] of cases) {
    const c = ok();
    breakIt(c);
    const before = c.app?.router?.stack.length ?? 0;
    await assert.rejects(register(c.app, c.serverManager, c.options), message, name);
    assert.equal(c.app?.router?.stack.length ?? 0, before, `${name}: something was mounted`);
  }
});
