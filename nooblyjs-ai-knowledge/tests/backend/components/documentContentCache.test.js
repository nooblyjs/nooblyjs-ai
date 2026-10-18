/**
 * @fileoverview Freshness-validated document content cache.
 *
 * Regression cover for a stale-content bug seen in production: a space root
 * `home.md` that is a SYMLINK into a git repo, where the same physical file is
 * also reachable as `Content/home.md`. Because the cache is keyed by PATH but
 * describes a FILE, one file occupied two cache entries; a write invalidated
 * only the path the file watcher reported, and the core cache's `put(key, value)`
 * takes no TTL — so the other entry served a 33-byte stub forever while
 * `fs.stat` reported the real 373KB file.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  readContentCache,
  writeContentCache,
} = require('../../../src/wiki/utils/documentContentCache');

/** Minimal stand-in for the core cache: put(key, value) — no TTL, like the real one. */
function makeCache() {
  const store = new Map();
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
  };
}

let tmpDir;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doccache-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeFile(rel, content) {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return abs;
}

describe('documentContentCache', () => {
  test('returns cached content while the file is unchanged', async () => {
    const cache = makeCache();
    const abs = writeFile('doc.md', 'original');
    const stats = fs.statSync(abs);

    await writeContentCache(cache, 'S-doc.md', 'original', stats);
    expect(await readContentCache(cache, 'S-doc.md', stats)).toBe('original');
  });

  test('rejects the entry once the file changes underneath it', async () => {
    const cache = makeCache();
    const abs = writeFile('doc.md', 'original');
    await writeContentCache(cache, 'S-doc.md', 'original', fs.statSync(abs));

    // Rewrite with different content/size, as a workflow or git pull would.
    fs.writeFileSync(abs, 'a much longer replacement body', 'utf8');

    expect(await readContentCache(cache, 'S-doc.md', fs.statSync(abs))).toBeNull();
  });

  test('rejects a same-size change (mtime alone catches it)', async () => {
    const cache = makeCache();
    const abs = writeFile('doc.md', 'aaaa');
    await writeContentCache(cache, 'S-doc.md', 'aaaa', fs.statSync(abs));

    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(abs, 'bbbb', 'utf8');
    fs.utimesSync(abs, later, later);

    expect(await readContentCache(cache, 'S-doc.md', fs.statSync(abs))).toBeNull();
  });

  test('legacy raw-string entries are treated as stale and re-read', async () => {
    const cache = makeCache();
    const abs = writeFile('doc.md', 'on disk');
    // What an older build wrote: the bare string, with no file identity.
    cache.store.set('S-doc.md', 'stale stub');

    expect(await readContentCache(cache, 'S-doc.md', fs.statSync(abs))).toBeNull();
  });

  describe('the symlink case that caused the bug', () => {
    /* A space root `home.md` symlinked to a file that is also reachable as
       `Content/home.md`. Two cache keys, one physical file. */
    let target, link, canSymlink;

    beforeEach(() => {
      target = writeFile('Content/home.md', 'ORIGINAL BODY');
      link = path.join(tmpDir, 'home.md');
      try { fs.symlinkSync(target, link); canSymlink = true; }
      catch { canSymlink = false; } // Windows without developer mode/admin
    });

    test('a write through one path invalidates BOTH keys', async () => {
      if (!canSymlink) return; // symlink creation unavailable in this environment
      const cache = makeCache();

      // Both paths cached from the same file.
      await writeContentCache(cache, 'S-home.md', 'ORIGINAL BODY', fs.statSync(link));
      await writeContentCache(cache, 'S-Content/home.md', 'ORIGINAL BODY', fs.statSync(target));
      expect(await readContentCache(cache, 'S-home.md', fs.statSync(link))).toBe('ORIGINAL BODY');

      // The workflow rewrites the TARGET; only one path's watcher event fires.
      fs.writeFileSync(target, 'REPLACED WITH A MUCH LONGER BODY', 'utf8');

      // Neither key may serve the old bytes: fs.stat follows the symlink, so both
      // validate against the same underlying file.
      expect(await readContentCache(cache, 'S-home.md', fs.statSync(link))).toBeNull();
      expect(await readContentCache(cache, 'S-Content/home.md', fs.statSync(target))).toBeNull();
    });

    test('stat through the symlink describes the target, not the link', () => {
      if (!canSymlink) return;
      expect(fs.statSync(link).size).toBe(fs.statSync(target).size);
      expect(fs.statSync(link).size).not.toBe(fs.lstatSync(link).size);
    });
  });

  describe('resilience', () => {
    test('a cache failure never breaks the read path', async () => {
      const abs = writeFile('doc.md', 'x');
      const broken = { async get() { throw new Error('cache down'); }, async put() {} };
      await expect(readContentCache(broken, 'k', fs.statSync(abs))).resolves.toBeNull();
    });

    test('a cache failure never breaks the write path', async () => {
      const abs = writeFile('doc.md', 'x');
      const broken = { async get() { return null; }, async put() { throw new Error('cache down'); } };
      await expect(writeContentCache(broken, 'k', 'x', fs.statSync(abs))).resolves.toBeUndefined();
    });

    test('missing cache or stats is handled', async () => {
      const abs = writeFile('doc.md', 'x');
      expect(await readContentCache(null, 'k', fs.statSync(abs))).toBeNull();
      expect(await readContentCache(makeCache(), 'k', null)).toBeNull();
      await expect(writeContentCache(makeCache(), 'k', 'x', null)).resolves.toBeUndefined();
    });

    test('non-string content is not cached', async () => {
      const cache = makeCache();
      const abs = writeFile('doc.md', 'x');
      await writeContentCache(cache, 'k', Buffer.from('x'), fs.statSync(abs));
      expect(cache.store.has('k')).toBe(false);
    });
  });
});
