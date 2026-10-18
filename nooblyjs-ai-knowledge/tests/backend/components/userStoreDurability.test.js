'use strict';

/**
 * userStore read/write durability.
 *
 * Every per-user artefact in the wiki — subscriptions, notification history,
 * chat history, pins, the content index, profile preferences, the personal
 * dashboard — goes through this module. A single malformed file therefore has
 * an unreasonably wide blast radius unless the store contains it, and it did:
 * one ZERO-BYTE `notifications.json` made `JSON.parse('')` throw out of
 * `NotificationManager.initialize`, which discarded EVERY space's subscriptions,
 * skipped core-callback registration for all of them, and never started the 30s
 * disk sync. The only symptom was "starting fresh: Unexpected end of JSON input".
 *
 * Two properties keep that from recurring, and both are asserted here:
 *   1. READ tolerates a corrupt file (fallback + warning), because the data is
 *      already gone and a caller's default is the only useful answer.
 *   2. WRITE is atomic, because a truncate-then-write is what CREATES the
 *      zero-byte file when the process dies mid-write.
 */

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const userStore = require('../../../src/wiki/components/userStore');

const IDENTITY = 'someone@example.com';

let baseDir;
let warnings;
let warnSpy;

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'userstore-'));
  warnings = [];
  warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args) => {
    warnings.push(args.join(' '));
  });
});

afterEach(() => {
  warnSpy.mockRestore();
  fs.rmSync(baseDir, { recursive: true, force: true });
});

/** Put raw bytes where userStore expects `fileName` for IDENTITY. */
function seed(fileName, contents) {
  const file = userStore.userPath(baseDir, IDENTITY, fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

describe('readJson tolerates unusable files', () => {
  test('a missing file is the fallback, silently', async () => {
    const value = await userStore.readJson(baseDir, IDENTITY, 'nope.json', { d: 1 });

    expect(value).toEqual({ d: 1 });
    expect(warnings).toEqual([]); // absent is normal, not worth a log line
  });

  test('a ZERO-BYTE file is the fallback, not a thrown SyntaxError', async () => {
    // The exact shape that took notifications down.
    const file = seed('notifications.json', '');

    const value = await userStore.readJson(baseDir, IDENTITY, 'notifications.json', null);

    expect(value).toBeNull();
    // ...and it says WHICH file, which the old failure did not.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(file);
    expect(warnings[0]).toContain('0 bytes');
  });

  test('a truncated file is the fallback too', async () => {
    seed('subscriptions.json', '[{"id":"a","typ');

    const value = await userStore.readJson(baseDir, IDENTITY, 'subscriptions.json', []);

    expect(value).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  test('a real I/O error still propagates', async () => {
    // A directory where a file is expected is a genuine misconfiguration, not
    // recoverable data loss — a caller must not paper over it.
    const file = userStore.userPath(baseDir, IDENTITY, 'pins.json');
    fs.mkdirSync(file, { recursive: true });

    await expect(userStore.readJson(baseDir, IDENTITY, 'pins.json', []))
      .rejects.toMatchObject({ code: expect.stringMatching(/EISDIR|EPERM|EACCES/) });
  });

  test('valid JSON is unaffected', async () => {
    seed('pins.json', JSON.stringify([{ path: 'a.md' }]));

    await expect(userStore.readJson(baseDir, IDENTITY, 'pins.json', []))
      .resolves.toEqual([{ path: 'a.md' }]);
    expect(warnings).toEqual([]);
  });
});

describe('writeJson is atomic', () => {
  test('round-trips and leaves no temp file behind', async () => {
    await userStore.writeJson(baseDir, IDENTITY, 'pins.json', [{ path: 'a.md' }]);

    const dir = path.dirname(userStore.userPath(baseDir, IDENTITY, 'pins.json'));
    expect(fs.readdirSync(dir)).toEqual(['pins.json']);
    await expect(userStore.readJson(baseDir, IDENTITY, 'pins.json', null))
      .resolves.toEqual([{ path: 'a.md' }]);
  });

  test('a payload that cannot be serialised leaves the existing file intact', async () => {
    await userStore.writeJson(baseDir, IDENTITY, 'pins.json', [{ path: 'good.md' }]);

    const circular = {};
    circular.self = circular;
    await expect(userStore.writeJson(baseDir, IDENTITY, 'pins.json', circular)).rejects.toThrow();

    // The old order (open/truncate, then serialise) is exactly how a good file
    // becomes a zero-byte one.
    await expect(userStore.readJson(baseDir, IDENTITY, 'pins.json', null))
      .resolves.toEqual([{ path: 'good.md' }]);
    const dir = path.dirname(userStore.userPath(baseDir, IDENTITY, 'pins.json'));
    expect(fs.readdirSync(dir)).toEqual(['pins.json']);
  });

  test('a reader concurrent with a write never sees a partial file', async () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ id: i, path: `doc-${i}.md` }));
    await userStore.writeJson(baseDir, IDENTITY, 'pins.json', [{ id: 'old' }]);

    const reads = [];
    const write = userStore.writeJson(baseDir, IDENTITY, 'pins.json', big);
    for (let i = 0; i < 40; i++) {
      reads.push(userStore.readJson(baseDir, IDENTITY, 'pins.json', null));
    }
    await write;
    const seen = await Promise.all(reads);

    // Every read is one of the two whole values — never null (the corrupt
    // fallback) and never a short array.
    for (const value of seen) {
      expect(Array.isArray(value)).toBe(true);
      expect(value.length === 1 || value.length === big.length).toBe(true);
    }
    expect(warnings).toEqual([]);
  });
});

describe('writeText is atomic', () => {
  test('round-trips and leaves no temp file behind', async () => {
    await userStore.writeText(baseDir, IDENTITY, 'dashboard.md', '# Hello');

    const dir = path.dirname(userStore.userPath(baseDir, IDENTITY, 'dashboard.md'));
    expect(fs.readdirSync(dir)).toEqual(['dashboard.md']);
    await expect(userStore.readText(baseDir, IDENTITY, 'dashboard.md', null))
      .resolves.toBe('# Hello');
  });
});

describe('NotificationManager survives one unusable file', () => {
  const NotificationManager = require('../../../src/wiki/components/notificationManager');

  /** appBaseDir with a spaces.json, plus a content dir holding user activity. */
  function setupSpace() {
    const appBase = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-app-'));
    const content = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-content-'));
    fs.mkdirSync(path.join(appBase, 'spaces'), { recursive: true });
    fs.writeFileSync(
      path.join(appBase, 'spaces', 'spaces.json'),
      JSON.stringify([{ id: 1, name: 'Engineering', path: content }]),
      'utf8'
    );

    const userFile = (prefix, name) => {
      const file = path.join(content, userStore.ROOT, prefix, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      return file;
    };
    return { appBase, content, userFile };
  }

  test("a zero-byte notifications.json does not discard another user's subscriptions", async () => {
    const { appBase, userFile } = setupSpace();

    // "admin" is healthy and has a subscription.
    fs.writeFileSync(userFile('admin', 'subscriptions.json'), JSON.stringify([
      { id: 's1', userId: 'admin@x.com', type: 'folder', path: 'Standards', createdAt: '2026-01-01' }
    ]), 'utf8');
    // ...and a second user's history file is the zero-byte one.
    fs.writeFileSync(userFile('srbooysen', 'notifications.json'), '', 'utf8');

    const logged = [];
    const log = {
      info: (...a) => logged.push(['info', ...a]),
      warn: (...a) => logged.push(['warn', ...a]),
      error: (...a) => logged.push(['error', ...a])
    };
    const manager = new NotificationManager(null, log, appBase, null, () => {});

    await manager.initialize();
    try {
      // The whole point: admin's subscription survived the other user's bad file.
      expect(manager.subscriptions).toHaveLength(1);
      expect(manager.subscriptions[0].id).toBe('s1');
      expect(manager.subscriptions[0].spaceName).toBe('Engineering');
      // ...and the periodic flush was started rather than skipped. Asserted
      // BEFORE stopSync(), which is what clears the handle.
      expect(manager.syncInterval).not.toBeNull();
      expect(logged.some(([, msg]) => String(msg).includes('starting fresh'))).toBe(false);
    } finally {
      manager.stopSync();
      fs.rmSync(appBase, { recursive: true, force: true });
    }
  });
});
