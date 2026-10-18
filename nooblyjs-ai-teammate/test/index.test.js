// register() (index.js): the HostedApp it returns, what it writes, how it fails and how it stops. The contract is
// ../nooblyjs-ai-host/.claude/steering/structure.md §2a; the stand-in host is test/fixtures/host.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ensureCoreUser, testHost, closeHost } from './helpers.js';
import { register } from '../index.js';
import { checkTaskName } from '../src/services/scheduler.js';

process.env.AI_PROVIDER = 'mock';
process.env.LOG_CONSOLE = 'none';
process.env.LOGIN_RATE_LIMIT_MAX ??= '10000';

const MOUNT = '/teammates';
let h;
let hosted;
let dataDir;
let site;
let before_;
const OWNER = { email: 'olive@example.com', fullName: 'Olive Owner', password: 'Olive-Owner-123', role: 'owner' };
const VIEWER = { email: 'val@example.com', fullName: 'Val Viewer', password: 'Val-Viewer-1234', role: 'viewer' };

const listTree = async (dir) => (await fs.readdir(dir, { recursive: true })).sort();

before(async () => {
  h = await testHost();
  before_ = await listTree(h.dataDir);
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-register-'));
  const { register } = await import('../index.js'); // importing it starts nothing
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

test('register() describes the app for the host without loading browser code', async () => {
  assert.deepEqual([hosted.name, hosted.label, hosted.mountPath], ['teammates', 'Teammates', MOUNT]);
  assert.deepEqual(hosted.ui, { entry: 'js/module.js', styles: ['css/teammates.css'] });
  assert.equal(typeof hosted.internals.repos, 'object', 'internals are there for the tests');
  assert.ok(hosted.nav.length >= 6);
  for (const row of hosted.nav) {
    assert.match(row.path, /^\/[a-z-]*$/, 'nav paths are relative to the mount path');
    assert.ok(row.key && row.label);
  }
  assert.equal(hosted.nav.find((n) => n.key === 'admin').requires, 'set-budgets');
  // What other apps may call (host.service('teammates')): the team, and one task run as a teammate.
  assert.deepEqual(Object.keys(hosted.services).sort(), ['availability', 'board', 'get', 'provider', 'roster', 'runTask']);
  assert.equal(hosted.services.provider(), 'mock');
  assert.equal((await hosted.services.get('ada-quill')).name, 'Ada Quill');
  for (const fn of ['status', 'seed', 'close']) assert.equal(typeof hosted[fn], 'function', fn);

  const started = Date.now();
  const status = await hosted.status();
  assert.ok(Date.now() - started < 1000, 'status() answers in under 1 s');
  assert.equal(typeof status.badges.approvals, 'number');
  assert.match(status.card.pill.text, /to approve$/);
  assert.ok(['ok', 'warning'].includes(status.card.pill.tone));
  assert.match(status.card.items[0].value, /^\d+ of \d+ on a task$/);
});

test('files are written only under dataDir', async () => {
  for (const folder of ['config', 'teammates', 'system', 'logs']) {
    assert.ok((await fs.stat(path.join(dataDir, folder))).isDirectory(), folder);
  }
  // The host's own folder only gained what the host writes (core's people, sessions and logs).
  const added = (await listTree(h.dataDir)).filter((f) => !before_.includes(f));
  assert.deepEqual(added.filter((f) => !/^(core|logs)([\\/]|$)/.test(f)), []);
});

test('a failing register() leaves nothing mounted', async () => {
  const { register } = await import('../index.js');
  const broken = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-register-broken-'));
  const file = path.join(broken, 'not-a-folder');
  await fs.writeFile(file, 'x');
  try {
    // The workspace can't be created inside a file, so seeding fails after core's services were set up.
    await assert.rejects(register(h.app, h.serverManager, { mountPath: '/broken', dataDir: file, host: h.hostFor({ dataDir: file }) }));
    assert.equal((await fetch(`${site.base}/broken/api/v1/health`)).status, 404);
    await assert.rejects(register(h.app, h.serverManager, { mountPath: '/no-host', dataDir: broken }), /host\.express and host\.auth/);
  } finally {
    await fs.rm(broken, { recursive: true, force: true });
  }
});

test("close() stops the schedule check on core's scheduler", async () => {
  const { register } = await import('../index.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-register-close-'));
  try {
    const app = await register(h.app, h.serverManager, { mountPath: '/closing', dataDir: dir, host: h.hostFor({ dataDir: dir }) });
    // Its core services are named after the mount path. Core scheduling is one service per process, so the
    // check task is named after it too.
    const scheduling = h.serverManager.getServiceInstance('scheduling', 'memory', 'closing');
    assert.ok(scheduling, 'the schedule check runs on core scheduling');
    const running = (name = checkTaskName('closing')) => scheduling.isRunning(name);
    for (let i = 0; i < 100 && !(await running()); i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(await running(), true);
    await app.close();
    assert.equal(await running(), false);
    assert.equal(await running(checkTaskName('teammates')), true, 'the other app keeps running');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
