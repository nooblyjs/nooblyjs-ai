// Phase F26: the NooblyJS hosted-app contract (noobly structure.md §2a; the hosted-app checklist in noobly roadmap.md). register() mounts
// the factory into a bare Express 5 app with the stand-in host (test/fixtures/host.js): the mount
// path, 401 when signed out, 403 (and an audit record) for a role without the permission, an
// audit record on every write, nothing written outside dataDir, and close() stops everything.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { register, NAV, PERMISSIONS } from '../index.js';
import { openStore } from '../src/models/store/events.js';
import { createHost, createTestServerManager, FRAME } from './fixtures/host.js';
import { tmpDir } from './helpers.js';

const FALLBACK = 'the host answers';

async function startApp({ mountPath = '/factory' } = {}) {
  const rootDir = tmpDir('factory-noobly-');
  const dataDir = path.join(rootDir, mountPath.slice(1));
  fs.mkdirSync(dataDir);
  const stand = createHost();
  const serverManager = createTestServerManager();
  const app = express();
  app.use(express.json());
  const hosted = await register(app, serverManager, { mountPath, dataDir, host: stand.host, pollMs: 0 });
  app.use((req, res) => res.status(404).type('text').send(FALLBACK));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  const call = async (method, url, { as, body } = {}) => {
    const res = await fetch(base + url, { method, redirect: 'manual', headers: { ...(as && { 'x-dev-person': as }), ...(body && { 'content-type': 'application/json' }) }, body: body && JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, headers: res.headers, text, json };
  };
  return {
    ...stand, hosted, rootDir, dataDir, serverManager,
    get: (url, o) => call('GET', url, o),
    post: (url, o) => call('POST', url, o),
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await hosted.close();
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve)); // the audit record is written once the answer is sent

test('register() describes the factory at its mount path, with a route for every nav row', async () => {
  const t = await startApp();
  try {
    const { hosted } = t;
    assert.equal(hosted.name, 'factory');
    assert.equal(hosted.mountPath, '/factory');
    assert.deepEqual(hosted.ui, { entry: 'js/module.js', styles: ['css/factory.css', 'product/css/product.css', 'infrastructure/css/infrastructure.css'] });
    // Product's rows, the Factory's own (Build), then Infrastructure's: the order work moves in (sections.js).
    assert.deepEqual(hosted.nav.map((n) => n.key), [
      'product-overview', 'product-portfolios', 'product-board', 'product-specs', 'product-architecture', 'product-ux', 'product-ui', 'product-reviews', 'product-handoffs', 'product-settings',
      'line', 'runs', 'inbox', 'campaigns', 'metrics',
      'infra-environments', 'infra-designs', 'infra-runs', 'infra-testing', 'infra-blueprints', 'infra-cost', 'infra-policies',
    ]);
    assert.deepEqual(hosted.nav.filter((n) => n.group === 'Build').map(({ group, ...row }) => row), NAV);
    assert.deepEqual([...new Set(hosted.nav.map((n) => n.group))], ['Product', 'Build', 'Infrastructure']);
    // Each group has a header: an icon and a line saying what that part of the Factory does.
    assert.deepEqual(hosted.groups.map((g) => g.name), ['Product', 'Build', 'Infrastructure']);
    assert.ok(hosted.groups.every((g) => g.icon && g.hint));
    for (const key of ['status', 'close']) assert.equal(typeof hosted[key], 'function');
    assert.equal(typeof hosted.services.status, 'function');
  } finally {
    await t.close();
  }
});

test('the API answers under the mount path given, and only there', async () => {
  const t = await startApp({ mountPath: '/sf' });
  try {
    assert.equal((await t.get('/sf/api/v1/status', { as: 'naledi-k' })).status, 200);
    assert.equal((await t.get('/factory/api/v1/status', { as: 'naledi-k' })).text, FALLBACK);
    assert.equal((await t.get('/api/status', { as: 'naledi-k' })).text, FALLBACK, 'nothing outside the mount path');
  } finally {
    await t.close();
  }
});

test('signed out, the API answers 401 in the NooblyJS error shape', async () => {
  const t = await startApp();
  try {
    for (const [method, url] of [['get', '/factory/api/v1/status'], ['get', '/factory/api/v1/runs'], ['post', '/factory/api/v1/stop-all']]) {
      const res = await t[method](url);
      assert.equal(res.status, 401, url);
      assert.deepEqual(res.json, { error: { code: 'unauthenticated', message: 'Sign in to continue.' } });
    }
  } finally {
    await t.close();
  }
});

test('a Viewer reads everything (honest zeros on an empty factory) and changes nothing', async () => {
  const t = await startApp();
  try {
    const status = await t.get('/factory/api/v1/status', { as: 'naledi-k' });
    assert.equal(status.status, 200);
    assert.deepEqual([status.json.stopped, status.json.running, status.json.queued, status.json.inbox], [false, [], [], 0]);
    for (const url of ['runs', 'inbox', 'campaigns', 'metrics']) assert.equal((await t.get(`/factory/api/v1/${url}`, { as: 'naledi-k' })).status, 200, url);

    const refused = await t.post('/factory/api/v1/stop-all', { as: 'naledi-k' });
    assert.equal(refused.status, 403);
    assert.equal(refused.json.error.code, 'forbidden');
    assert.deepEqual(t.auditLog.map((r) => [r.actor, r.action, r.target, r.permission]), [['naledi-k', 'access.refused', 'POST /factory/api/v1/stop-all', 'approve']]);
    assert.equal((await t.get('/factory/api/v1/status', { as: 'naledi-k' })).json.stopped, false);
  } finally {
    await t.close();
  }
});

test('an agent is refused the inbox and the kill switch: agents propose, people decide', async () => {
  const t = await startApp();
  try {
    for (const url of ['/factory/api/v1/inbox/any', '/factory/api/v1/stop-all', '/factory/api/v1/resume-all']) {
      const res = await t.post(url, { as: 'ada-quill', body: { decision: 'approved' } });
      assert.equal(res.status, 403, url);
    }
    // The kill switch needs `approve`; the inbox is people-only, whatever the agent's access role allows.
    const refused = t.auditLog.filter((r) => r.action === 'access.refused' && r.actor === 'ada-quill');
    assert.deepEqual(refused.map((r) => r.permission).sort(), ['approve', 'approve', 'people-only']);
  } finally {
    await t.close();
  }
});

test('every write has a permission, and each is audited; reads are not', async () => {
  const t = await startApp();
  try {
    assert.deepEqual(Object.keys(PERMISSIONS), ['POST /api/inbox/:id', 'POST /api/runs/:id/:action', 'POST /api/stop-all', 'POST /api/resume-all']);
    await t.get('/factory/api/v1/status', { as: 'lerato-m' });
    const stop = await t.post('/factory/api/v1/stop-all', { as: 'lerato-m' });
    assert.deepEqual([stop.status, stop.json], [200, { stopped: true }]);
    await settle();
    assert.deepEqual(t.auditLog.map((r) => [r.actor, r.action, r.status]), [['lerato-m', 'POST /factory/api/v1/stop-all', 200]]);
    const card = (await t.hosted.status()).card;
    assert.deepEqual(card.pill, { text: 'Stopped', tone: 'danger' });
    assert.equal((await t.post('/factory/api/v1/resume-all', { as: 'lerato-m' })).json.stopped, false);
  } finally {
    await t.close();
  }
});

test('errors use the one shape: an unknown run or route is a 404 not_found', async () => {
  const t = await startApp();
  try {
    const run = await t.get('/factory/api/v1/runs/nope', { as: 'priya-s' });
    assert.deepEqual([run.status, run.json], [404, { error: { code: 'not_found', message: 'No run "nope".' } }]);
    const retry = await t.post('/factory/api/v1/runs/nope/retry', { as: 'priya-s' });
    assert.equal(retry.json.error.code, 'not_found');
    assert.equal((await t.get('/factory/api/v1/nope', { as: 'priya-s' })).json.error.code, 'not_found');
    assert.equal((await t.get('/factory/api/v1/events', { as: 'priya-s' })).status, 404, 'live updates are the host\'s stream, not ours');
  } finally {
    await t.close();
  }
});

test('page URLs answer with the host\'s frame; the UI module is served; nothing else in public/ is', async () => {
  const t = await startApp();
  try {
    for (const page of ['/factory', '/factory/line', '/factory/runs/run-214', '/factory/inbox?x=1']) {
      const res = await t.get(page, { as: 'naledi-k' });
      assert.deepEqual([res.status, res.text], [200, FRAME], page);
    }
    assert.equal((await t.get('/factory/runs', {})).status, 302, 'signed out: the host sends you to sign in');
    const mod = await t.get('/factory/js/module.js');
    assert.equal(mod.status, 200);
    assert.match(mod.headers.get('content-type'), /javascript/);
    assert.equal(mod.headers.get('content-security-policy'), null, 'one page, one policy: the host\'s');
    assert.match((await t.get('/factory/css/factory.css')).headers.get('content-type'), /css/);
    // A missing file is the host's 404, not the frame; the CLI dashboard's own page is not served here.
    for (const file of ['/factory/js/nope.js', '/factory/dashboard/app.js', '/factory/dashboard/index.html', '/factory/index.html']) {
      assert.equal((await t.get(file, { as: 'naledi-k' })).text, FALLBACK, file);
    }
  } finally {
    await t.close();
  }
});

test('the status card and badge come from the log, and new log events reach the host', async () => {
  const t = await startApp();
  try {
    const status = await t.hosted.status();
    assert.equal(status.badges.inbox, 0);
    // Each section's badges are there too, under their prefixed keys (the Product section's Reviews, Infrastructure's runs).
    assert.deepEqual(Object.keys(status.badges).sort(), ['inbox', 'infra-runs', 'product-reviews']);
    assert.deepEqual(status.card.pill, { text: 'Accepting work', tone: 'ok' });
    assert.deepEqual(status.card.items[0], { label: 'Running now', value: '0 of 3 slots · 0 queued' });
    // One line per section, in words.
    assert.deepEqual(status.card.items.slice(1).map((i) => i.label), ['Product', 'Infrastructure']);
    assert.ok(status.card.items.slice(1).every((i) => typeof i.value === 'string' && i.value.length));
    assert.deepEqual(status.card.meter, { label: 'Spent today', value: '$0 of $20', ratio: 0, tone: 'ok' });
    // Another process (factory submit, factory serve) appends to the same log.
    const other = openStore({ env: { ...process.env, FACTORY_HOME: t.dataDir } });
    try {
      other.append('run:r1', 'run.queued', { runId: 'r1', itemId: 'PRD-031', title: 'Add subtract', request: { line: 'default' } });
      other.append('run:r1', 'inbox.opened', { inboxId: 'i1', runId: 'r1', kind: 'approval', gate: 'spec', title: 'Approve the spec' });
      other.append('run:r1', 'run.finished', { runId: 'r1', status: 'delivered' });
    } finally {
      other.close();
    }
    await t.hosted.flush();
    assert.deepEqual(t.eventLog.map((e) => [e.type, e.payload.system, e.payload.runId, e.payload.summary]), [
      ['run.asked', 'factory', 'r1', 'asks: Approve the spec'],
      ['run.finished', 'factory', 'r1', 'finished run "Add subtract": delivered'],
    ]);
    await t.hosted.flush();
    assert.equal(t.eventLog.length, 2, 'nothing twice');
    assert.equal((await t.hosted.status()).badges.inbox, 1);
    assert.deepEqual((await t.hosted.services.runsForItem('PRD-031')).map((r) => [r.id, r.status]), [['r1', 'delivered']]);

    // A person answers in NooblyJS: recorded under their name.
    const answer = await t.post('/factory/api/v1/inbox/i1', { as: 'lerato-m', body: { decision: 'approved' } });
    assert.equal(answer.status, 200);
    assert.equal(answer.json.entry.by, 'Lerato M. (NooblyJS)');
  } finally {
    await t.close();
  }
});

test('it writes only under its own dataDir, and never initialises the host\'s serverManager', async () => {
  const t = await startApp();
  try {
    await t.post('/factory/api/v1/stop-all', { as: 'stevie' });
    const files = fs.readdirSync(t.rootDir, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(t.rootDir, f)).isFile());
    assert.ok(files.length > 0);
    assert.ok(files.every((f) => f.split(path.sep)[0] === 'factory'), files.join(', '));
  } finally {
    await t.close();
  }
});

test('a start that cannot work throws before anything is mounted', async () => {
  const app = express();
  const { host } = createHost();
  const dataDir = tmpDir('factory-noobly-');
  await assert.rejects(register(app, createTestServerManager(), { dataDir, host: { ...host, frame: undefined } }), /needs host\.frame/);
  await assert.rejects(register(app, createTestServerManager(), { host }), /needs a dataDir/);
  await assert.rejects(register(app, createTestServerManager(), { dataDir, host, mountPath: 'factory' }), /mountPath must look like/);
  assert.equal(app.router?.stack?.length ?? 0, 0, 'nothing was mounted');
  assert.deepEqual(fs.readdirSync(dataDir), [], 'and nothing was written');
});
