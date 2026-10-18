// models/fs-store.js: Markdown front matter, path safety, per-file locks and the document cache.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startApp, closeHost } from '../helpers.js';
import { FsStore, parseMarkdown, serializeMarkdown, StoreError } from '../../src/models/fs-store.js';

let app;
before(async () => {
  app = await startApp();
});
after(async () => {
  await app.close();
  await closeHost(); // worker threads and timers, so the test process can exit
});

test('markdown front matter round-trips and keeps dates as strings', () => {
  const text = serializeMarkdown({ id: 'ada', hiredAt: '2026-03-14', rate: 48, traits: ['a', 'b'] }, '# Persona\n\nHello');
  const { data, body } = parseMarkdown(text);
  assert.deepEqual(data, { id: 'ada', hiredAt: '2026-03-14', rate: 48, traits: ['a', 'b'] });
  assert.equal(body.trim(), '# Persona\n\nHello');
});

test('store rejects path traversal and odd segments', async () => {
  const store = new FsStore(await fs.mkdtemp(path.join(os.tmpdir(), 'tm-')));
  for (const bad of ['..', '../x', 'a/b', '.hidden', '']) {
    assert.throws(() => store.resolve(['teammates', bad]), StoreError);
  }
});

test('store serializes concurrent read-modify-write on the same file', async () => {
  const store = new FsStore(await fs.mkdtemp(path.join(os.tmpdir(), 'tm-')));
  await store.writeDoc(['counter.md'], { n: 0 });
  await Promise.all(Array.from({ length: 25 }, () => store.updateDoc(['counter.md'], (d) => ({ data: { n: d.data.n + 1 } }))));
  assert.equal((await store.readDoc(['counter.md'])).data.n, 25);
});

test('parsed documents are cached, picked up again after outside edits, and secrets are never cached', async () => {
  const { store } = app;
  const before = store.cacheInfo();
  const first = await store.readDoc(['config', 'settings.md']);
  const second = await store.readDoc(['config', 'settings.md']);
  assert.deepEqual(second, first);
  assert.ok(store.cacheInfo().hits > before.hits, 'second read is a cache hit');

  // Callers may change what they read without touching the cache.
  second.data.timezone = 'Mars/Olympus';
  assert.notEqual((await store.readDoc(['config', 'settings.md'])).data.timezone, 'Mars/Olympus');

  // An edit made outside the app (e.g. in a text editor) is seen on the next read.
  const file = path.join(app.dataDir, 'config', 'settings.md');
  const text = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, text.replace(/^---\n/, '---\nexternalEdit: yes\n'));
  assert.equal((await store.readDoc(['config', 'settings.md'])).data.externalEdit, 'yes');

  // Writes through the store replace the cached copy.
  await app.repos.config.updateSettings({ externalEdit: 'no' });
  assert.equal((await app.repos.config.getSettings()).externalEdit, 'no');

  // Users, keys, the session secret and webhook secrets stay out of the cache (it is readable on /services).
  await store.readDoc(['system', 'users.md']);
  await store.readDoc(['config', 'webhooks.md']);
  const keys = [...store.cachedKeys];
  assert.ok(keys.some((k) => k.endsWith(`${path.sep}settings.md`)));
  assert.ok(!keys.some((k) => k.includes(`${path.sep}system${path.sep}`) || k.endsWith('webhooks.md')));
  assert.equal(await app.core.cache.get(`doc:${path.join(app.dataDir, 'system', 'users.md')}`), undefined);
});
