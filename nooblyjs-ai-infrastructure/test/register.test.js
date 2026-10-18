// The hosted-app contract (noobly structure.md §2a; the hosted-app checklist in noobly roadmap.md): the app mounts once under its path, never listens, signs people in
// with the host, refuses with an audit record, writes only inside its own folder, and a bad start mounts nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, filesUnder, FALLBACK } from './helpers.js';

const API = '/infrastructure/api/v1';

test('register() mounts the API under the mount path and describes itself', async () => {
  const t = await startApp();
  try {
    assert.equal(t.registerError, null);
    const about = await t.get(`${API}/about`, { as: 'naledi-k' });
    assert.equal(about.status, 200);
    assert.deepEqual({ name: about.json.name, mountPath: about.json.mountPath, provisioner: about.json.provisioner }, { name: 'infrastructure', mountPath: '/infrastructure', provisioner: 'mock' });
    // Other apps are resolved per request, and none is here.
    assert.deepEqual(about.json.connected, { workflows: false, product: false, factory: false, teammates: false });
    for (const key of ['name', 'label', 'icon', 'mountPath', 'ui', 'nav', 'status', 'services', 'seed', 'close']) assert.ok(t.hosted[key], key);
  } finally {
    await t.close();
  }
});

test('the app works under another mount path, and leaves everything else to the host', async () => {
  const t = await startApp({ mountPath: '/infra' });
  try {
    assert.equal((await t.get('/infra/api/v1/about', { as: 'stevie' })).json.mountPath, '/infra');
    const outside = await t.get('/somewhere-else', { as: 'stevie' });
    assert.equal(outside.text, FALLBACK);
  } finally {
    await t.close();
  }
});

test('the API is signed-in only, and unknown routes use the one error shape', async () => {
  const t = await startApp({ seed: true });
  try {
    const signedOut = await t.get(`${API}/environments`);
    assert.equal(signedOut.status, 401);
    assert.equal(signedOut.json.error.code, 'unauthenticated');
    const missing = await t.get(`${API}/nope`, { as: 'stevie' });
    assert.equal(missing.status, 404);
    assert.deepEqual(Object.keys(missing.json.error).sort(), ['code', 'message']);
    assert.equal((await t.get(`${API}/designs/INF-999`, { as: 'stevie' })).status, 404);
    assert.equal((await t.get(`${API}/designs/INF-031?kind=moon`, { as: 'stevie' })).status, 400);
  } finally {
    await t.close();
  }
});

test('a role without the permission gets 403 and the refusal is audited; every write is audited', async () => {
  const t = await startApp({ seed: true });
  try {
    const refused = await t.post(`${API}/seed`, { as: 'priya-s', body: { reset: true } });
    assert.equal(refused.status, 403);
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'priya-s' && a.permission === 'change-guardrails'));
    const before = t.auditLog.length;
    assert.equal((await t.put(`${API}/policies/default-tier`, { as: 'stevie', body: { enabled: false } })).status, 200);
    assert.ok(t.auditLog.slice(before).some((a) => a.actor === 'stevie' && a.action === `PUT ${API}/policies/default-tier` && a.status === 200));
  } finally {
    await t.close();
  }
});

test('everything is written inside the app\'s own folder', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.post(`${API}/designs/INF-031/decision`, { as: 'stevie', body: { decision: 'approve', kind: 'test' } });
    await t.hosted.idle();
    const all = await filesUnder(t.rootDir);
    assert.ok(all.length > 10);
    assert.deepEqual(all.filter((f) => !f.startsWith('infrastructure/')), []);
  } finally {
    await t.close();
  }
});

test('a bad start throws before anything is mounted', async () => {
  for (const [why, options] of [
    ['a host without events', { changeHost: (h) => ({ ...h, events: undefined }) }],
    ['a serverManager nobody initialised', { serverManager: { initialized: false } }],
    ['a mount path that is not a path', { mountPath: 'infrastructure' }],
  ]) {
    const t = await startApp(options).catch((err) => ({ registerError: err, close: async () => {} }));
    try {
      assert.ok(t.registerError, why);
      if (t.get) assert.equal((await t.get(`${API}/about`, { as: 'stevie' })).text, FALLBACK, why);
    } finally {
      await t.close();
    }
  }
});

test('the app never initialises the serverManager, and uses the host\'s logging and queueing', async () => {
  const t = await startApp();
  try {
    assert.deepEqual(t.serverManager.calls.map((c) => `${c.service}:${c.instanceName}`).sort(), ['logging:infrastructure', 'queueing:infrastructure']);
  } finally {
    await t.close();
  }
});

test('seeding is idempotent, and a reset rewrites the story with times around now', async () => {
  const t = await startApp({ seed: true });
  try {
    const design = path.join(t.dataDir, 'designs', 'INF-031.md');
    const first = await fs.readFile(design, 'utf8');
    assert.doesNotMatch(first, /\{\{/, 'every relative time was placed');
    await fs.appendFile(design, '\nedited by hand\n');
    await t.hosted.seed({ reset: false });
    assert.match(await fs.readFile(design, 'utf8'), /edited by hand/);
    await t.hosted.seed({ reset: true });
    assert.doesNotMatch(await fs.readFile(design, 'utf8'), /edited by hand/);
  } finally {
    await t.close();
  }
});

test('close() stops a run in progress, and the next start picks it up', async () => {
  // The seed leaves pr-486 at 70%. A second start in the same folder resumes it.
  const first = await startApp({ seed: true });
  const dataDir = first.dataDir;
  const snapshot = await fs.mkdtemp(path.join(path.dirname(first.rootDir), 'nooblyjs-ai-infrastructure-copy-'));
  await fs.cp(dataDir, snapshot, { recursive: true });
  await first.close();

  const second = await startApp({ before: (dir) => fs.cp(snapshot, dir, { recursive: true }) });
  try {
    await second.hosted.idle();
    const run = await second.get(`${API}/runs/run_seedpr486`, { as: 'stevie' });
    assert.equal(run.json.status, 'done');
    const env = await second.get(`${API}/environments/pr-486`, { as: 'stevie' });
    assert.equal(env.json.status, 'live');
  } finally {
    await second.close();
    await fs.rm(snapshot, { recursive: true, force: true });
  }
});
