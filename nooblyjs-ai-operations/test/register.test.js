// The hosted-app contract (noobly structure.md §2a; the hosted-app checklist in the root roadmap): the app mounts once
// under its path, never listens, signs people in with the host, refuses with an audit record, writes only inside its own
// folder, and a bad start mounts nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, filesUnder, FALLBACK } from './helpers.js';

const API = '/operations/api/v1';

test('register() mounts the API under the mount path and describes itself', async () => {
  const t = await startApp();
  try {
    assert.equal(t.registerError, null);
    const about = await t.get(`${API}/about`, { as: 'naledi-k' });
    assert.equal(about.status, 200);
    assert.deepEqual([about.json.name, about.json.mountPath, about.json.deployer, about.json.realDeployer], ['operations', '/operations', 'mock', false]);
    assert.deepEqual(about.json.connected, { workflows: false, infrastructure: false, security: false, quality: false, teammates: false, devtools: false });
    for (const key of ['name', 'label', 'icon', 'mountPath', 'ui', 'nav', 'status', 'services', 'seed', 'close']) assert.ok(t.hosted[key], key);
  } finally {
    await t.close();
  }
});

test('the app works under another mount path, and leaves everything else to the host', async () => {
  const t = await startApp({ mountPath: '/ops' });
  try {
    assert.equal((await t.get('/ops/api/v1/about', { as: 'stevie' })).json.mountPath, '/ops');
    assert.equal((await t.get('/somewhere-else', { as: 'stevie' })).text, FALLBACK);
  } finally {
    await t.close();
  }
});

test('the API is signed-in only, and unknown routes and bad ids use the one error shape', async () => {
  const t = await startApp({ seed: true });
  try {
    const signedOut = await t.get(`${API}/releases`);
    assert.deepEqual([signedOut.status, signedOut.json.error.code], [401, 'unauthenticated']);
    const missing = await t.get(`${API}/nope`, { as: 'stevie' });
    assert.equal(missing.status, 404);
    assert.deepEqual(Object.keys(missing.json.error).sort(), ['code', 'message']);
    assert.equal((await t.get(`${API}/releases/REL-999`, { as: 'stevie' })).status, 404);
    assert.equal((await t.get(`${API}/releases/../../etc`, { as: 'stevie' })).status, 404);
    assert.equal((await t.post(`${API}/releases`, { as: 'stevie', body: { itemId: 'nope' } })).status, 400);
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
    // A Viewer can't make a release (draft): refused, and the refusal recorded.
    const made = await t.post(`${API}/releases`, { as: 'naledi-k', body: { itemId: 'PRD-031', featureId: 'FEAT-031-1' } });
    assert.equal(made.status, 403);
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'naledi-k' && a.permission === 'draft'));
    const before = t.auditLog.length;
    assert.equal((await t.post(`${API}/releases`, { as: 'priya-s', body: { itemId: 'PRD-031', featureId: 'FEAT-031-1' } })).status, 503, 'no lifecycle engine here');
    assert.ok(t.auditLog.slice(before).some((a) => a.actor === 'priya-s' && a.action === `POST ${API}/releases`));
  } finally {
    await t.close();
  }
});

test('everything is written inside the app\'s own folder', async () => {
  const t = await startApp({ seed: true });
  try {
    const all = await filesUnder(t.rootDir);
    assert.ok(all.length >= 2);
    assert.deepEqual(all.filter((f) => !f.startsWith('operations/')), []);
  } finally {
    await t.close();
  }
});

test('a bad start throws before anything is mounted; an unknown deployer is refused, not pretended', async () => {
  for (const [why, options] of [
    ['a host without events', { changeHost: (h) => ({ ...h, events: undefined }) }],
    ['a serverManager nobody initialised', { serverManager: { initialized: false } }],
    ['a mount path that is not a path', { mountPath: 'operations' }],
  ]) {
    const t = await startApp(options).catch((err) => ({ registerError: err, close: async () => {} }));
    try {
      assert.ok(t.registerError, why);
      if (t.get) assert.equal((await t.get(`${API}/about`, { as: 'stevie' })).text, FALLBACK, why);
    } finally {
      await t.close();
    }
  }
  process.env.OPERATIONS_DEPLOYER = 'argo';
  try {
    const t = await startApp();
    try {
      assert.match(t.registerError.message, /only "mock" exists until one is approved/);
    } finally {
      await t.close();
    }
  } finally {
    delete process.env.OPERATIONS_DEPLOYER;
  }
});

test('the app never initialises the serverManager, and uses the host\'s logging', async () => {
  const t = await startApp();
  try {
    assert.deepEqual(t.serverManager.calls.map((c) => `${c.service}:${c.instanceName}`), ['logging:operations']);
  } finally {
    await t.close();
  }
});

test('seeding is idempotent, and a reset rewrites it; with no content only the policies', async () => {
  const t = await startApp({ seed: true });
  try {
    const policies = path.join(t.dataDir, 'policies.yaml');
    await fs.appendFile(policies, '\n# edited by hand\n');
    await t.hosted.seed({ reset: false });
    assert.match(await fs.readFile(policies, 'utf8'), /edited by hand/);
    await t.hosted.seed({ reset: true });
    assert.doesNotMatch(await fs.readFile(policies, 'utf8'), /edited by hand/);
    await t.hosted.seed({ reset: true, content: false });
    assert.deepEqual(await filesUnder(t.dataDir), ['policies.yaml', 'seed.yaml']);
  } finally {
    await t.close();
  }
});
