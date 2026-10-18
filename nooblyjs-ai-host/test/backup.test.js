// Backup and restore of data/ (Phase 13, roadmap test step 3): a backup taken from a running NooblyJS restores into a
// fresh install with every file and the audit log intact, and NooblyJS starts on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app.js';
import { startApp, testConfig, today, client } from './helpers.js';
import { createBackups, verifyBackup, restoreBackup, nightlyBackup, auditCount, LEFT_OUT } from '../src/services/backup.js';

const tmp = (name) => fs.mkdtemp(path.join(os.tmpdir(), `noobly-${name}-`));
const post = (c, url, json = {}) => c.request(url, { method: 'POST', json });

test('step 3: a backup of a used NooblyJS restores into a fresh install: every file, the audit log, and NooblyJS starts on it', async () => {
  const backupDir = await tmp('backups');
  const fresh = path.join(await tmp('restore'), 'data');
  const first = await startApp();
  let made;
  let before;
  try {
    // Use it: sign in, approve a handoff (lifecycle files, events, audit records), change a guardrail-level setting.
    const stevie = first.client();
    await stevie.signIn('stevie');
    assert.equal((await post(stevie, '/workflows/api/v1/approvals/apr_slotpickerui/decision', { decision: 'approve' })).status, 200);
    await first.noobly.syncSettled();
    // Things a backup leaves out: a log, a secret made at start, a write caught half way.
    await fs.mkdir(path.join(first.dataDir, 'logs'), { recursive: true });
    await fs.writeFile(path.join(first.dataDir, 'logs', 'noobly.log'), 'noise\n');
    await fs.mkdir(path.join(first.dataDir, 'factory'), { recursive: true });
    await fs.writeFile(path.join(first.dataDir, 'factory', 'secret'), 'made-at-start');
    await fs.writeFile(path.join(first.dataDir, 'people', 'stevie.md.tmp-0a1b2c3d'), 'half a write');

    const backups = createBackups({ dataDir: first.dataDir, backupDir, keep: 3 });
    made = await backups.create();
    before = {
      item: (await stevie.json('/workflows/api/v1/items/PRD-028')).body.item,
      audit: await auditCount(first.dataDir),
      events: (await today(first.store, 'events')).length,
    };
    assert.equal(before.item.stage, 'build');
    assert.ok(made.files > 100 && made.audit.records === before.audit.records && before.audit.records > 3);
    const manifest = JSON.parse(await fs.readFile(path.join(made.path, 'manifest.json'), 'utf8'));
    const paths = manifest.files.map((f) => f.path);
    assert.ok(paths.includes('workflows/items/PRD-028.md') || paths.some((p) => p.startsWith('workflows/')), 'the lifecycle is in it');
    assert.ok(!paths.some((p) => p.startsWith('logs/') || p === 'factory/secret' || p.includes('.tmp-')), 'logs, generated secrets and half-written files are left out');
    assert.deepEqual(manifest.leftOut, LEFT_OUT);
    assert.deepEqual((await verifyBackup(made.path)).problems, []);
  } finally { await first.stop(); }

  // A fresh install: an empty data folder. Everything comes back and is checked against the manifest.
  const restored = await restoreBackup(made.path, fresh);
  assert.deepEqual([restored.ok, restored.problems, restored.files], [true, [], made.files]);
  assert.deepEqual(await auditCount(fresh), before.audit, 'the audit log holds the same records, day by day');

  // NooblyJS starts on the restored folder, and the work is where it was.
  const again = await createApp({ config: testConfig(fresh) });
  const server = again.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  try {
    const stevie = client(`http://127.0.0.1:${server.address().port}`);
    await stevie.signIn('stevie');
    const item = (await stevie.json('/workflows/api/v1/items/PRD-028')).body.item;
    assert.deepEqual(item, before.item, "the item is exactly as it was: its stage, its history, who owns it");
    const audit = (await stevie.json('/api/v1/platform/audit?limit=200')).body;
    assert.ok(JSON.stringify(audit).includes('apr_slotpickerui'), 'the approval is in the restored audit log');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await again.close();
  }
});

test('refuses: a restore never overwrites, a damaged backup is not restored, and a backup may not go inside data/', async () => {
  const dataDir = await tmp('data');
  const backupDir = await tmp('backups');
  await fs.mkdir(path.join(dataDir, 'audit', '2026', '10'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'audit', '2026', '10', '2026-10-11.yaml'), '---\nid: aud_1\nat: "2026-10-11T08:00:00.000Z"\naction: session.started\n---\nid: aud_2\nat: "2026-10-11T08:01:00.000Z"\naction: approval.decided\n');
  await fs.mkdir(path.join(dataDir, 'people'));
  await fs.writeFile(path.join(dataDir, 'people', 'stevie.md'), '---\nname: Stevie\n---\n');
  const made = await createBackups({ dataDir, backupDir }).create();

  await assert.rejects(() => restoreBackup(made.path, dataDir), /is not empty .*A restore never overwrites/);
  assert.equal(await fs.readFile(path.join(dataDir, 'people', 'stevie.md'), 'utf8'), '---\nname: Stevie\n---\n', 'the folder was not touched');
  const elsewhere = await tmp('x');
  await assert.rejects(() => restoreBackup(path.join(backupDir, 'nothing-here'), elsewhere), /is not a backup/);

  // Someone edits a file in the backup, or removes an audit record: it is found, and nothing is restored.
  await fs.writeFile(path.join(made.path, 'data', 'people', 'stevie.md'), '---\nname: Mallory\n---\n');
  const target = path.join(await tmp('restore'), 'data');
  await assert.rejects(() => restoreBackup(made.path, target), /damaged and was not restored: changed: people\/stevie\.md/);
  assert.equal(await fs.stat(target).catch(() => null), null);
  await fs.writeFile(path.join(made.path, 'data', 'people', 'stevie.md'), '---\nname: Stevie\n---\n');
  await fs.writeFile(path.join(made.path, 'data', 'audit', '2026', '10', '2026-10-11.yaml'), '---\nid: aud_1\nat: "2026-10-11T08:00:00.000Z"\naction: session.started\n');
  const damaged = await verifyBackup(made.path);
  assert.equal(damaged.ok, false);
  assert.ok(damaged.problems.some((p) => /changed: audit/.test(p)) && damaged.problems.some((p) => /audit log holds 1 records/.test(p)));
  await fs.writeFile(path.join(made.path, 'data', 'extra.md'), 'slipped in');
  assert.ok((await verifyBackup(made.path)).problems.includes('not in the backup: extra.md'));

  await assert.rejects(() => createBackups({ dataDir, backupDir: path.join(dataDir, 'backups') }).create(), /must not be inside the data folder/);
  await assert.rejects(() => createBackups({ dataDir, backupDir: dataDir }).create(), /must not be inside the data folder/);
  await assert.rejects(() => createBackups({ dataDir, backupDir: '' }).create(), /Set BACKUP_DIR/);
});

test('the nightly backup is made once a day, after its hour, and only the newest are kept', async () => {
  const dataDir = await tmp('data');
  const backupDir = await tmp('backups');
  await fs.writeFile(path.join(dataDir, 'a.md'), 'a');
  let now = new Date(2026, 9, 11, 1, 30).getTime();
  const clock = { now: () => now };
  const backups = createBackups({ dataDir, backupDir, keep: 2, clock });
  assert.equal(await nightlyBackup(backups, { clock, hour: 2 }), null, 'not before its hour');
  now = new Date(2026, 9, 11, 2, 5).getTime();
  assert.ok((await nightlyBackup(backups, { clock, hour: 2 })).name.startsWith('noobly-2026'));
  now = new Date(2026, 9, 11, 14, 0).getTime();
  assert.equal(await nightlyBackup(backups, { clock, hour: 2 }), null, 'not twice in a day');
  for (const day of [12, 13]) {
    now = new Date(2026, 9, day, 2, 5).getTime();
    assert.ok(await nightlyBackup(backups, { clock, hour: 2 }));
  }
  const kept = await backups.list();
  assert.equal(kept.length, 2, 'keep: 2');
  assert.ok(kept[0].createdAt > kept[1].createdAt, 'newest first');
  assert.deepEqual((await fs.readdir(backupDir)).filter((n) => n.endsWith('.partial')), [], 'no half-made backup is left');
});
