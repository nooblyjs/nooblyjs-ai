// The shared rule (NooblyJS Phase 24): Teammates writes its data through host.store, the store the host made for this
// app's dataDir, with Teammates' document cache on it. A store rooted anywhere else is not used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { storeFor } from '../../index.js';
import { FsStore } from '../../src/models/fs-store.js';

const cacheable = () => true;

test('hosted, the store is the host\'s, with the document cache attached', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-host-store-'));
  const cache = { get: async () => null, put: async () => {}, delete: async () => {} };
  const given = new FsStore(dataDir);
  const store = storeFor({ store: given }, dataDir, { cache, cacheable });
  assert.equal(store, given);
  assert.equal(store.cache, cache);
  assert.equal(store.cacheable, cacheable);
  await store.writeDoc(['teammates', 'ada.md'], { name: 'Ada' }, 'Notes');
  assert.equal((await fs.readFile(path.join(dataDir, 'teammates', 'ada.md'), 'utf8')).includes('name: Ada'), true);
});

test('a host store rooted elsewhere, or none, gives Teammates a store of its own in its dataDir', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-host-store-'));
  const elsewhere = new FsStore(path.join(dataDir, '..'));
  const own = storeFor({ store: elsewhere }, dataDir, { cache: null, cacheable });
  assert.notEqual(own, elsewhere);
  assert.equal(own.root, path.resolve(dataDir));
  assert.equal(storeFor({}, dataDir, { cache: null, cacheable }).root, path.resolve(dataDir));
});

test('register() keeps its data in host.store', async () => {
  const { startApp } = await import('../helpers.js');
  const app = await startApp({ login: false });
  try {
    assert.ok(app.store instanceof FsStore);
    assert.equal(app.store.root, path.resolve(app.dataDir));
    assert.ok(app.store.cache, 'the document cache is on the host\'s store');
  } finally {
    await app.close?.();
  }
});
