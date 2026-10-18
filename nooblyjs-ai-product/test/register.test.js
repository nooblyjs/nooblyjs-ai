// The hosted-app contract (noobly structure.md §2a; the hosted-app checklist in noobly roadmap.md; NooblyJS hosted-app checklist steps 1, 2, 5–9 and 12, as far as they can
// be checked without NooblyJS itself).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as engine from '../index.js';
import { startApp, filesUnder, FALLBACK } from './helpers.js';
import { fakeServices } from './fixtures/host.js';

test('index.js exports register() (and its NAV), and importing it starts nothing', () => {
  assert.deepEqual(Object.keys(engine).sort(), ['NAV', 'register']);
  assert.equal(typeof engine.register, 'function');
});

test('register() describes the app at its mount path', async () => {
  const t = await startApp();
  try {
    const { hosted } = t;
    assert.equal(hosted.name, 'product');
    assert.equal(hosted.mountPath, '/product');
    assert.equal(typeof hosted.label, 'string');
    assert.equal(typeof hosted.ui?.entry, 'string');
    assert.ok(Array.isArray(hosted.nav));
    assert.equal(typeof hosted.status, 'function');
    assert.equal(typeof hosted.services, 'object');
    assert.equal(typeof hosted.seed, 'function');
    assert.equal(typeof hosted.close, 'function');
  } finally {
    await t.close();
  }
});

test('the API answers under the mount path given, and only there', async () => {
  const t = await startApp({ mountPath: '/pf' });
  try {
    assert.equal(t.hosted.mountPath, '/pf');
    const ok = await t.get('/pf/api/v1/about', { as: 'naledi-k' });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.mountPath, '/pf');
    assert.equal((await t.get('/product/api/v1/about', { as: 'naledi-k' })).text, FALLBACK);
  } finally {
    await t.close();
  }
});

test('signed out, every API route answers 401 in the error shape', async () => {
  const t = await startApp();
  try {
    for (const [method, url] of [['get', '/product/api/v1/about'], ['get', '/product/api/v1/board'], ['post', '/product/api/v1/seed']]) {
      const res = await t[method](url);
      assert.equal(res.status, 401, `${method} ${url}`);
      assert.deepEqual(res.json, { error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
    }
  } finally {
    await t.close();
  }
});

test('an unknown API route is a 404 in the error shape; other API versions are left to the host', async () => {
  const t = await startApp();
  try {
    const missing = await t.get('/product/api/v1/nope', { as: 'stevie' });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'not_found');
    // Page URLs get the frame (test/public/module.test.js); an API this app doesn't have falls through.
    assert.equal((await t.get('/product/api/v2/about', { as: 'stevie' })).text, FALLBACK);
  } finally {
    await t.close();
  }
});

test('a role without the permission is refused with 403, and the refusal is audited', async () => {
  const t = await startApp();
  try {
    const res = await t.post('/product/api/v1/seed', { as: 'priya-s', body: { reset: true } });
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, 'forbidden');
    const refusal = t.auditLog.find((r) => r.action === 'access.refused');
    assert.equal(refusal.actor, 'priya-s');
    assert.equal(refusal.permission, 'change-guardrails');
    assert.equal(refusal.target, 'POST /product/api/v1/seed');
  } finally {
    await t.close();
  }
});

test('every write is audited; reads are not', async () => {
  const t = await startApp();
  try {
    await t.get('/product/api/v1/about', { as: 'stevie' });
    const res = await t.post('/product/api/v1/seed', { as: 'stevie', body: { reset: true } });
    assert.equal(res.status, 201);
    await new Promise((r) => setImmediate(r)); // the audit record is written once the answer is sent
    const writes = t.auditLog.filter((r) => r.action !== 'access.refused');
    assert.deepEqual(writes.map((r) => [r.actor, r.action, r.status]), [['stevie', 'POST /product/api/v1/seed', 201]]);
    assert.equal(t.eventLog.at(-1).type, 'product.seeded');
    assert.equal(t.eventLog.at(-1).actor, 'stevie');
  } finally {
    await t.close();
  }
});

test('it writes only under its own dataDir', async () => {
  const t = await startApp();
  try {
    await t.hosted.seed({ reset: false });
    await t.post('/product/api/v1/seed', { as: 'stevie', body: { reset: true } });
    const files = await filesUnder(t.rootDir);
    assert.ok(files.length > 0);
    assert.ok(files.every((f) => f.startsWith('product/')), files.join(', '));
  } finally {
    await t.close();
  }
});

test('seed() writes the story once; reset removes what is there and writes it again', async () => {
  const t = await startApp();
  try {
    await t.hosted.seed();
    const first = await fs.readFile(path.join(t.dataDir, 'seed.yaml'), 'utf8');
    assert.match(first, /story: PRD-031/);
    await fs.writeFile(path.join(t.dataDir, 'stray.md'), 'left by a person');

    const again = await t.post('/product/api/v1/seed', { as: 'stevie', body: {} });
    assert.equal(again.status, 200);
    assert.equal(again.json.seeded, false);
    const kept = await filesUnder(t.dataDir);
    assert.ok(kept.includes('stray.md') && kept.includes('specs/PRD-031.md'));

    const reset = await t.post('/product/api/v1/seed', { as: 'stevie', body: { reset: true } });
    assert.equal(reset.status, 201);
    const rewritten = await filesUnder(t.dataDir);
    assert.ok(!rewritten.includes('stray.md'));
    assert.equal(rewritten.length, reset.json.files + 1); // the story's files, plus seed.yaml
  } finally {
    await t.close();
  }
});

test('resetting the seed is refused in production', async () => {
  const t = await startApp();
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const res = await t.post('/product/api/v1/seed', { as: 'stevie', body: { reset: true } });
    assert.equal(res.status, 403);
    assert.match(res.json.error.message, /production/);
  } finally {
    process.env.NODE_ENV = was;
    await t.close();
  }
});

test("it uses the host's serverManager and never initialises it", async () => {
  const t = await startApp();
  try {
    assert.ok(t.serverManager.calls.some((c) => c.service === 'logging' && c.instanceName === 'product'));
    // The test serverManager's initialize() throws; register() succeeded, so it was never called.
    assert.equal(t.registerError, null);
  } finally {
    await t.close();
  }
});

test('/about says which partner apps are connected, resolved per request', async () => {
  const { services } = fakeServices();
  const t = await startApp({ services: { workflows: services.workflows } });
  try {
    const res = await t.get('/product/api/v1/about', { as: 'naledi-k' });
    assert.deepEqual(res.json.connected, { workflows: true, teammates: false, knowledge: false });
    assert.equal(res.json.name, 'product');
  } finally {
    await t.close();
  }
});

test('a register() that fails leaves nothing mounted', async () => {
  const cases = [
    ['no host', (h) => ({ ...h, auth: undefined }), /host\.auth/],
    ['no store', (h) => ({ ...h, store: undefined }), /host\.store/],
  ];
  for (const [name, changeHost, message] of cases) {
    const t = await startApp({ changeHost });
    try {
      assert.match(t.registerError?.message ?? '', message, name);
      assert.equal((await t.get('/product/api/v1/about', { as: 'stevie' })).text, FALLBACK, name);
    } finally {
      await t.close();
    }
  }
});

test('register() refuses a serverManager the host has not initialised, and a bad mount path', async () => {
  const notReady = await startApp({ serverManager: { initialized: false } });
  const badMount = await startApp({ mountPath: '/Product Factory' });
  try {
    assert.match(notReady.registerError.message, /initialised serverManager/);
    assert.match(badMount.registerError.message, /mountPath/);
  } finally {
    await notReady.close();
    await badMount.close();
  }
});

test('close() resolves and can be called twice', async () => {
  const t = await startApp();
  try {
    await t.hosted.close();
    await t.hosted.close();
  } finally {
    await t.close();
  }
});
