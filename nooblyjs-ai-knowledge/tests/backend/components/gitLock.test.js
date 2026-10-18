/**
 * @fileoverview Recovery from a leftover git `*.lock`.
 *
 * The contract under test:
 *   1. A lock held by a LIVE process is waited for, never deleted.
 *   2. A lock that has gone untouched past the stale threshold is removed and the
 *      operation retried — that is the abandoned lock a killed git process
 *      leaves, which otherwise blocks the repository forever while the auto-commit
 *      timer swallows the error it raises every hour.
 *   3. The file removed is the one GIT NAMED, and only when it sits inside that
 *      repository's own `.git` and ends in `.lock`. A message pointing anywhere
 *      else deletes nothing.
 *   4. A non-lock error is never retried and never touches the filesystem.
 *
 * (3) is the load-bearing one: this is the only code in the platform that deletes
 * a file chosen by a string parsed out of an error message.
 */

'use strict';

const fs = require('node:fs');
const fsp = require('node:fs').promises;
const os = require('node:os');
const path = require('node:path');

const {
  isLockError,
  lockPathFromError,
  inspectLock,
  inspectIndexLock,
  removeStaleLock,
  withLockRecovery,
} = require('../../../src/shared/repositories/gitLock');

/** The exact message git emits, as seen in production. */
const GIT_LOCK_MESSAGE = (lockPath) =>
  `fatal: Unable to create '${lockPath}': File exists.\n\n`
  + 'Another git process seems to be running in this repository, e.g.\n'
  + "an editor opened by 'git commit'. Please make sure all processes\n"
  + 'are terminated then try again. If it still fails, a git process\n'
  + 'may have crashed in this repository earlier:\n'
  + 'remove the file manually to continue.';

let repoDir;

beforeEach(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlock-'));
  fs.mkdirSync(path.join(repoDir, '.git'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

/** Write a lock file and backdate its mtime by `ageMs`. */
function writeLock(name = 'index.lock', ageMs = 0) {
  const lockPath = path.join(repoDir, '.git', name);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, '');
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(lockPath, when, when);
  }
  return lockPath;
}

describe('isLockError', () => {
  test('recognises the message git actually emits', () => {
    expect(isLockError(new Error(GIT_LOCK_MESSAGE('/repo/.git/index.lock')))).toBe(true);
  });

  test('recognises a ref lock, not just the index', () => {
    expect(isLockError(new Error("fatal: Unable to create '/r/.git/refs/heads/main.lock': File exists"))).toBe(true);
  });

  test('an unrelated git failure is not a lock error — it must not be retried', () => {
    expect(isLockError(new Error('Failed to push: authentication failed'))).toBe(false);
    expect(isLockError(new Error('could not read Username for https://bitbucket.org'))).toBe(false);
    expect(isLockError(null)).toBe(false);
  });
});

describe('lockPathFromError', () => {
  test('takes the path git named rather than assuming index.lock', () => {
    const named = '/home/nodeuser/repo/.git/refs/heads/main.lock';
    expect(lockPathFromError(new Error(GIT_LOCK_MESSAGE(named)), '/home/nodeuser/repo')).toBe(named);
  });

  test('falls back to the conventional index lock when the message names no file', () => {
    const err = new Error('Another git process seems to be running in this repository');
    expect(lockPathFromError(err, '/repo')).toBe(path.join('/repo', '.git', 'index.lock'));
  });

  test('yields nothing for an unrelated error', () => {
    expect(lockPathFromError(new Error('boom'), '/repo')).toBeNull();
  });
});

describe('inspectLock / inspectIndexLock', () => {
  test('an absent lock is reported absent, not as an error', async () => {
    await expect(inspectLock(path.join(repoDir, '.git', 'index.lock')))
      .resolves.toMatchObject({ present: false, stale: false });
  });

  test('a freshly written lock is present but NOT stale', async () => {
    const lockPath = writeLock('index.lock', 0);
    await expect(inspectLock(lockPath, 60000)).resolves.toMatchObject({ present: true, stale: false });
  });

  test('a lock untouched past the threshold is stale', async () => {
    const lockPath = writeLock('index.lock', 5 * 60 * 1000);
    const state = await inspectLock(lockPath, 60000);
    expect(state).toMatchObject({ present: true, stale: true });
    expect(state.ageMs).toBeGreaterThanOrEqual(5 * 60 * 1000 - 2000);
  });

  test('inspectIndexLock never throws — a status panel must not fail on a stat', async () => {
    await expect(inspectIndexLock(null)).resolves.toBeNull();
    await expect(inspectIndexLock('/nonexistent/path')).resolves.toMatchObject({ present: false });
  });
});

describe('removeStaleLock — what it refuses to delete', () => {
  test('removes a stale lock inside the repository .git', async () => {
    const lockPath = writeLock('index.lock', 5 * 60 * 1000);
    await expect(removeStaleLock({ lockPath, localPath: repoDir, staleMs: 60000 }))
      .resolves.toMatchObject({ removed: true, reason: 'stale' });
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('leaves a FRESH lock alone — that is a live git process, not a leftover', async () => {
    const lockPath = writeLock('index.lock', 0);
    await expect(removeStaleLock({ lockPath, localPath: repoDir, staleMs: 60000 }))
      .resolves.toMatchObject({ removed: false, reason: 'active' });
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test('refuses a path outside the repository, however stale', async () => {
    const outside = path.join(os.tmpdir(), `gitlock-outside-${process.pid}.lock`);
    fs.writeFileSync(outside, '');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(outside, old, old);
    try {
      await expect(removeStaleLock({ lockPath: outside, localPath: repoDir, staleMs: 60000 }))
        .resolves.toMatchObject({ removed: false, reason: 'outside-repository' });
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test('refuses a traversal that climbs back out of .git', async () => {
    const escape = path.join(repoDir, '.git', '..', '..', 'passwd.lock');
    await expect(removeStaleLock({ lockPath: escape, localPath: repoDir, staleMs: 0 }))
      .resolves.toMatchObject({ removed: false, reason: 'outside-repository' });
  });

  test('refuses a file inside .git that is not a lock', async () => {
    const configPath = path.join(repoDir, '.git', 'config');
    fs.writeFileSync(configPath, '[core]\n');
    await expect(removeStaleLock({ lockPath: configPath, localPath: repoDir, staleMs: 0 }))
      .resolves.toMatchObject({ removed: false, reason: 'not-a-lock-file' });
    expect(fs.existsSync(configPath)).toBe(true);
  });

  test('a lock that vanished between check and delete is not an error', async () => {
    await expect(removeStaleLock({
      lockPath: path.join(repoDir, '.git', 'index.lock'), localPath: repoDir, staleMs: 0,
    })).resolves.toMatchObject({ removed: false, reason: 'already-gone' });
  });
});

describe('withLockRecovery', () => {
  const opts = () => ({ localPath: repoDir, instanceName: 'repo-test', waitMs: 60, staleMs: 60000 });

  test('a successful operation runs exactly once and touches nothing', async () => {
    const op = jest.fn().mockResolvedValue('ok');
    await expect(withLockRecovery(op, opts())).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('a non-lock error propagates immediately, without a retry', async () => {
    const op = jest.fn().mockRejectedValue(new Error('Failed to push: authentication failed'));
    await expect(withLockRecovery(op, opts())).rejects.toThrow(/authentication failed/);
    expect(op).toHaveBeenCalledTimes(1);
  });

  test('a STALE lock is removed and the operation retried — the production failure', async () => {
    const lockPath = writeLock('index.lock', 10 * 60 * 1000);
    const op = jest.fn()
      .mockRejectedValueOnce(new Error(GIT_LOCK_MESSAGE(lockPath)))
      .mockResolvedValueOnce('committed');

    await expect(withLockRecovery(op, opts())).resolves.toBe('committed');
    expect(op).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('a lock released while waiting is retried WITHOUT deleting anything', async () => {
    const lockPath = writeLock('index.lock', 0);
    const op = jest.fn()
      .mockRejectedValueOnce(new Error(GIT_LOCK_MESSAGE(lockPath)))
      .mockResolvedValueOnce('done');

    // The live process finishes and removes its own lock mid-wait.
    setTimeout(() => fs.rmSync(lockPath, { force: true }), 20);

    await expect(withLockRecovery(op, { ...opts(), waitMs: 2000 })).resolves.toBe('done');
    expect(op).toHaveBeenCalledTimes(2);
  });

  test('a lock still held by a LIVE process fails with which file and why', async () => {
    const lockPath = writeLock('index.lock', 0);
    const op = jest.fn().mockRejectedValue(new Error(GIT_LOCK_MESSAGE(lockPath)));

    await expect(withLockRecovery(op, opts())).rejects.toMatchObject({
      code: 'GIT_LOCKED',
      lockPath,
      message: expect.stringContaining('a git process really is running'),
    });
    // Retried once at most, and the live lock survived.
    expect(op).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  test('a lock error naming a file outside the repository deletes nothing', async () => {
    const outside = path.join(os.tmpdir(), `gitlock-evil-${process.pid}.lock`);
    fs.writeFileSync(outside, '');
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(outside, old, old);
    const op = jest.fn().mockRejectedValue(new Error(GIT_LOCK_MESSAGE(outside)));

    try {
      await expect(withLockRecovery(op, opts())).rejects.toMatchObject({ code: 'GIT_LOCKED' });
      expect(fs.existsSync(outside)).toBe(true);
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
