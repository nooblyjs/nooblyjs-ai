// The hosted-app contract (NooblyJS structure.md §2a, roadmap checklist): register() checks what it is given before it
// mounts anything, never initialises the serverManager, and nothing listens on import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { register } from '../../src/lifecycle/index.js';
import { seed } from '../../src/lifecycle/seed/index.js';
import { createHost, createTestServerManager } from './fixtures/host.js';

const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'noobly-lifecycle-'));

test('register() refuses a host that is missing something, before mounting anything', async () => {
  const dir = await tempDir();
  const { host } = createHost({ dataDir: dir });
  const app = express();
  const before = app.router?.stack?.length ?? 0;
  await assert.rejects(register(app, { initialized: false }, { dataDir: dir, host }), /initialised serverManager/);
  await assert.rejects(register(app, createTestServerManager(), { dataDir: dir, host: { ...host, can: undefined, events: undefined } }), /host\.can, host\.events/);
  await assert.rejects(register(app, createTestServerManager(), { dataDir: dir, host, mountPath: 'workflows' }), /mountPath/);
  await assert.rejects(register(app, createTestServerManager(), { host }), /dataDir/);
  assert.equal(app.router?.stack?.length ?? 0, before, 'nothing was mounted');
  await fs.rm(dir, { recursive: true, force: true });
});

test('it mounts under any path, takes its logger from the host, and close() stops its timer and listeners', async () => {
  const dir = await tempDir();
  const stand = createHost({ dataDir: dir });
  const manager = createTestServerManager();
  const hosted = await register(express(), manager, { dataDir: dir, host: stand.host, mountPath: '/lifecycle', sweepEveryMs: 50 });
  assert.equal(hosted.mountPath, '/lifecycle');
  assert.equal(hosted.name, 'workflows');
  assert.equal(typeof hosted.close, 'function');
  await hosted.seed();
  assert.ok(manager.lines.some((l) => l.instance === 'workflows' && /seeded/.test(l.message)));
  await hosted.close();
  await hosted.close(); // twice is fine
  await fs.rm(dir, { recursive: true, force: true });
});

test('the seed moves the story to now, works out due times from the rules, and is left alone the second time', async () => {
  const dir = await tempDir();
  const { host } = createHost({ dataDir: dir });
  const first = await seed(host.store, { now: '2027-03-03T12:00:00.000Z' }); // a Wednesday
  assert.equal(first.seeded, true);
  const spec = (await host.store.readDoc(['approvals', 'apr_prd031spec.md'])).data;
  assert.equal(spec.requestedAt, '2027-03-02T10:00:00.000Z', '26 hours before now');
  assert.equal(spec.dueAt, '2027-03-03T23:59:59.000Z', 'the end of the next working day: due today');
  // The Design handoff, a working day like the spec; the Build approval, four clock hours.
  const design = (await host.store.readDoc(['approvals', 'apr_slotpickerdesign.md'])).data;
  assert.equal(design.dueAt, '2027-03-04T23:59:59.000Z', 'asked for this morning: due at the end of the next working day');
  const build = (await host.store.readDoc(['approvals', 'apr_slotsapi482.md'])).data;
  assert.equal(build.dueAt, '2027-03-03T14:30:00.000Z', 'four hours after it was asked for');
  // The story is in lifecycle v3's stages.
  assert.equal((await host.store.readDoc(['items', 'PRD-031.md'])).data.stage, 'product');
  assert.equal((await host.store.readDoc(['items', 'PRD-028.md'])).data.stage, 'design');
  assert.equal((await seed(host.store, { now: '2028-01-01T00:00:00.000Z' })).seeded, false);
  assert.equal((await seed(host.store, { reset: true, now: '2028-01-03T10:00:00.000Z' })).seeded, true);
  await fs.rm(dir, { recursive: true, force: true });
});
