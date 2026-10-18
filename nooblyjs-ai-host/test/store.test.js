// FsStore (nooblyjs-core) guarantees: atomic writes, per-path locks, path safety, CORE_SCHEMA, serialised appends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FsStore, StoreError, tempDir } from './helpers.js';

test('writes are atomic: no temp files left, and a reader sees the old or the new text, never half', async () => {
  const store = new FsStore(await tempDir());
  const big = 'x'.repeat(2_000_000);
  await store.writeText(['a.md'], 'old');
  const writes = [store.writeText(['a.md'], big), store.writeText(['a.md'], 'new')];
  const reads = Array.from({ length: 20 }, () => store.readText(['a.md']));
  for (const text of await Promise.all(reads)) assert.ok(['old', 'new', big].includes(text), 'a read saw a partial file');
  await Promise.all(writes);
  assert.deepEqual((await fs.readdir(store.root)).filter((n) => n.includes('.tmp-')), []);
});

test('updateDoc holds a per-path lock, so concurrent increments are not lost', async () => {
  const store = new FsStore(await tempDir());
  await store.writeDoc(['counter.md'], { n: 0 });
  await Promise.all(Array.from({ length: 25 }, () => store.updateDoc(['counter.md'], (doc) => ({ data: { n: doc.data.n + 1 } }))));
  assert.equal((await store.readDoc(['counter.md'])).data.n, 25);
});

test('path escapes and unsafe segments are refused', async () => {
  const store = new FsStore(await tempDir());
  for (const bad of [['..', 'x'], ['a', '..', '..', 'etc'], ['/etc/passwd'], ['a/b'], ['.hidden'], [''], [42], ['C:\\x']]) {
    await assert.rejects(store.writeText(bad, 'nope'), StoreError, `accepted ${JSON.stringify(bad)}`);
  }
  assert.throws(() => store.resolve(['ok', '..']), StoreError);
});

test('YAML uses CORE_SCHEMA: ISO dates stay strings', async () => {
  const store = new FsStore(await tempDir());
  await store.writeDoc(['d.md'], { at: '2026-10-08T09:41:00Z' }, 'Body');
  await fs.writeFile(path.join(store.root, 'raw.md'), '---\nat: 2026-10-08T09:41:00Z\n---\n\nBody\n');
  assert.equal(typeof (await store.readDoc(['raw.md'])).data.at, 'string');
  assert.deepEqual(await store.readDoc(['d.md']), { data: { at: '2026-10-08T09:41:00Z' }, body: 'Body\n' });
});

test('appends to a YAML stream are serialised and read back whole', async () => {
  const store = new FsStore(await tempDir());
  await Promise.all(Array.from({ length: 50 }, (_, i) => store.appendYaml(['events', 'day.yaml'], { i, text: 'line\nwith: colon' })));
  const records = await store.readYamlStream(['events', 'day.yaml']);
  assert.equal(records.length, 50);
  assert.deepEqual(records.map((r) => r.i).sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i));
  assert.ok(records.every((r) => r.text === 'line\nwith: colon'));
});

test('readYaml and writeYaml round-trip config files', async () => {
  const store = new FsStore(await tempDir());
  assert.equal(await store.readYaml(['missing.yaml']), null);
  await store.writeYaml(['config', 'x.yaml'], { apps: [{ mountPath: '/a', enabled: false }] });
  assert.deepEqual(await store.readYaml(['config', 'x.yaml']), { apps: [{ mountPath: '/a', enabled: false }] });
});
