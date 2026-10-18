// routes/index.js: the one router under the mount path, signed-in only through host.auth, role checks by
// host.requireRole, and every write past host.audit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { coreSignIn, ensureCoreUser, testHost, closeHost } from '../helpers.js';
import { register } from '../../index.js';

process.env.AI_PROVIDER = 'mock';
process.env.LOG_CONSOLE = 'none';
process.env.LOGIN_RATE_LIMIT_MAX ??= '10000';

const MOUNT = '/teammates';
let h;
let hosted;
let dataDir;
let site;
const OWNER = { email: 'olive@example.com', fullName: 'Olive Owner', password: 'Olive-Owner-123', role: 'owner' };
const VIEWER = { email: 'val@example.com', fullName: 'Val Viewer', password: 'Val-Viewer-1234', role: 'viewer' };

before(async () => {
  h = await testHost();
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-register-'));
  const { register } = await import('../../index.js'); // importing it starts nothing
  hosted = await register(h.app, h.serverManager, { mountPath: MOUNT, dataDir, host: h.hostFor({ dataDir }) });
  site = { base: h.base, url: h.base + MOUNT };
  await ensureCoreUser(h.authservice, OWNER);
  await ensureCoreUser(h.authservice, VIEWER);
});
after(async () => {
  await hosted.close();
  await closeHost();
  await fs.rm(dataDir, { recursive: true, force: true });
});

const as = async (who) => {
  const s = await coreSignIn(site, who.email, who.password);
  return (method, url, body) => fetch(site.url + url, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: s.cookie, ...(method === 'GET' ? {} : { 'X-CSRF-Token': s.csrf }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
};

test('everything is under the mount path: files, the API under /api/v1, and the host frame for page URLs', async () => {
  assert.equal((await fetch(`${site.url}/api/v1/health`)).status, 200);
  const js = await fetch(`${site.url}/js/module.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal(js.headers.get('content-security-policy'), null, "the policy is the host's");
  // The app serves no page of its own: deep links get host.frame (the stand-in host answers 501).
  for (const page of ['/team/ada-quill', '/', '/billing']) assert.equal((await fetch(`${site.url}${page}`)).status, 501, page);
  // A missing file is a 404, not the frame.
  assert.equal((await fetch(`${site.url}/index.html`)).status, 404);
  assert.equal((await fetch(`${site.url}/js/nope.js`)).status, 404);
  // Nothing outside it: the old root paths are not the app's.
  assert.equal((await fetch(`${site.base}/api/v1/teammates`)).status, 404);
  assert.equal((await fetch(`${site.base}/team`)).status, 404);
  // Unknown API paths answer in JSON.
  const missing = await (await as(OWNER))('GET', '/api/v1/nope');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'not_found');
});

test('the API is signed-in only, through host.auth', async () => {
  const anon = await fetch(`${site.url}/api/v1/teammates`);
  assert.equal(anon.status, 401);
  assert.equal((await anon.json()).error.code, 'unauthenticated');
  assert.equal((await fetch(`${site.url}/uploads/x.png`)).status, 401);
  assert.equal((await (await as(OWNER))('GET', '/api/v1/teammates')).status, 200);
});

test('a role without the permission is refused by host.requireRole, and the refusal is audited', async () => {
  const viewer = await as(VIEWER);
  assert.equal((await viewer('GET', '/api/v1/teammates')).status, 200);
  const refused = await viewer('PATCH', '/api/v1/teammates/ada-quill', { rate: 1 });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.code, 'forbidden');
  assert.ok(h.auditLog.some((e) => e.action === 'access.refused' && e.actor === VIEWER.email && e.permission === 'approve' && e.target === `PATCH ${MOUNT}/api/v1/teammates/ada-quill`));
  assert.equal((await viewer('GET', '/api/v1/admin/keys')).status, 403);
  assert.ok(h.auditLog.some((e) => e.action === 'access.refused' && e.actor === VIEWER.email && e.permission === 'set-budgets'));
});

test('every write goes past host.audit, and domain events reach host.events', async () => {
  const owner = await as(OWNER);
  const seen = [];
  h.hostFor({ dataDir }).events.on('task.completed', (payload) => seen.push(payload));
  const res = await owner('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Brief on Initech' });
  assert.equal(res.status, 200);
  const { workId } = await res.json();
  assert.ok(h.auditLog.some((e) => e.action === `POST ${MOUNT}/api/v1/teammates/wren-sato/tasks` && e.actor === OWNER.email && e.status === 200));
  // Reads are not audited.
  await owner('GET', '/api/v1/teammates');
  assert.ok(!h.auditLog.some((e) => e.action === `GET ${MOUNT}/api/v1/teammates`));
  assert.ok(h.eventLog.some((e) => e.type === 'task.completed'), 'the host logged the event');
  assert.ok(seen.length >= 1 && JSON.stringify(seen).includes(workId));
});
