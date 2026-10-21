// The hosted-app contract (noobly structure.md §2a; the hosted-app checklist in the root roadmap): the app mounts once
// under its path, never listens, signs people in with the host, refuses with an audit record, writes only inside its own
// folder, and a bad start mounts nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, filesUnder, FALLBACK } from './helpers.js';

const API = '/security/api/v1';

test('register() mounts the API under the mount path and describes itself', async () => {
  const t = await startApp();
  try {
    assert.equal(t.registerError, null);
    const about = await t.get(`${API}/about`, { as: 'naledi-k' });
    assert.equal(about.status, 200);
    assert.deepEqual([about.json.name, about.json.mountPath, about.json.scanner, about.json.realScanner], ['security', '/security', 'mock', false]);
    assert.deepEqual(about.json.connected, { workflows: false, product: false, factory: false, teammates: false });
    for (const key of ['name', 'label', 'icon', 'mountPath', 'ui', 'nav', 'status', 'services', 'seed', 'close']) assert.ok(t.hosted[key], key);
  } finally {
    await t.close();
  }
});

test('the app works under another mount path, and leaves everything else to the host', async () => {
  const t = await startApp({ mountPath: '/sec' });
  try {
    assert.equal((await t.get('/sec/api/v1/about', { as: 'stevie' })).json.mountPath, '/sec');
    assert.equal((await t.get('/somewhere-else', { as: 'stevie' })).text, FALLBACK);
  } finally {
    await t.close();
  }
});

test('the API is signed-in only, and unknown routes and bad ids use the one error shape', async () => {
  const t = await startApp({ seed: true });
  try {
    const signedOut = await t.get(`${API}/findings`);
    assert.deepEqual([signedOut.status, signedOut.json.error.code], [401, 'unauthenticated']);
    const missing = await t.get(`${API}/nope`, { as: 'stevie' });
    assert.equal(missing.status, 404);
    assert.deepEqual(Object.keys(missing.json.error).sort(), ['code', 'message']);
    assert.equal((await t.get(`${API}/findings/FND-999`, { as: 'stevie' })).status, 404);
    assert.equal((await t.get(`${API}/findings/../../etc`, { as: 'stevie' })).status, 404);
    assert.equal((await t.get(`${API}/findings?state=lost`, { as: 'stevie' })).status, 400);
    assert.equal((await t.get(`${API}/threat-models/TM-999`, { as: 'stevie' })).status, 404);
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
    // A Contributor can't accept a risk (accept-risk): refused, and the refusal recorded.
    const risk = await t.post(`${API}/findings/FND-002/accept-risk`, { as: 'priya-s', body: { reason: 'x', expiresInDays: 30 } });
    assert.equal(risk.status, 403);
    assert.ok(t.auditLog.some((a) => a.action === 'access.refused' && a.actor === 'priya-s' && a.permission === 'accept-risk'));
    const before = t.auditLog.length;
    assert.equal((await t.put(`${API}/findings/FND-001/owner`, { as: 'priya-s', body: { owner: 'lerato-m' } })).status, 200);
    assert.ok(t.auditLog.slice(before).some((a) => a.actor === 'priya-s' && a.action === `PUT ${API}/findings/FND-001/owner` && a.status === 200));
  } finally {
    await t.close();
  }
});

test('everything is written inside the app\'s own folder', async () => {
  const t = await startApp({ seed: true });
  try {
    await t.hosted.services.scanChange({ repo: 'web-storefront', files: [{ path: 'package.json', text: '{"dependencies":{"left-pad":"1.3.0"}}' }] });
    await t.post(`${API}/findings/FND-002/accept-risk`, { as: 'thabo-n', body: { reason: 'TLS comes with the cluster upgrade', expiresInDays: 30 } });
    const all = await filesUnder(t.rootDir);
    assert.ok(all.length >= 5);
    assert.deepEqual(all.filter((f) => !f.startsWith('security/')), []);
  } finally {
    await t.close();
  }
});

test('a bad start throws before anything is mounted; an unknown scanner is refused, not pretended', async () => {
  for (const [why, options] of [
    ['a host without events', { changeHost: (h) => ({ ...h, events: undefined }) }],
    ['a serverManager nobody initialised', { serverManager: { initialized: false } }],
    ['a mount path that is not a path', { mountPath: 'security' }],
  ]) {
    const t = await startApp(options).catch((err) => ({ registerError: err, close: async () => {} }));
    try {
      assert.ok(t.registerError, why);
      if (t.get) assert.equal((await t.get(`${API}/about`, { as: 'stevie' })).text, FALLBACK, why);
    } finally {
      await t.close();
    }
  }
  process.env.SECURITY_SCANNER = 'semgrep';
  try {
    const t = await startApp();
    try {
      assert.match(t.registerError.message, /no real scanner is approved yet/);
    } finally {
      await t.close();
    }
  } finally {
    delete process.env.SECURITY_SCANNER;
  }
});

test('the app never initialises the serverManager, and uses the host\'s logging', async () => {
  const t = await startApp();
  try {
    assert.deepEqual(t.serverManager.calls.map((c) => `${c.service}:${c.instanceName}`), ['logging:security']);
  } finally {
    await t.close();
  }
});

test('seeding is idempotent, and a reset rewrites the story with times around now; with no content only the policies', async () => {
  const t = await startApp({ seed: true });
  try {
    const finding = path.join(t.dataDir, 'findings', 'FND-001.md');
    const first = await fs.readFile(finding, 'utf8');
    assert.doesNotMatch(first, /\{\{/, 'every relative time was placed');
    await fs.appendFile(finding, '\nedited by hand\n');
    await t.hosted.seed({ reset: false });
    assert.match(await fs.readFile(finding, 'utf8'), /edited by hand/);
    await t.hosted.seed({ reset: true });
    assert.doesNotMatch(await fs.readFile(finding, 'utf8'), /edited by hand/);
    await t.hosted.seed({ reset: true, content: false });
    assert.deepEqual(await filesUnder(t.dataDir), ['policies.yaml', 'seed.yaml']);
  } finally {
    await t.close();
  }
});
