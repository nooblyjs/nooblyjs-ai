/**
 * @fileoverview Recovery from a leftover git `*.lock` file.
 *
 * WHAT BREAKS. git takes an exclusive lock (`.git/index.lock`, `.git/HEAD.lock`,
 * `.git/refs/heads/<branch>.lock`) around anything that rewrites the index or a
 * ref, and removes it on exit. A process that is KILLED mid-operation never gets
 * to remove it, and the lock then blocks that repository forever:
 *
 *   fatal: Unable to create '<repo>/.git/index.lock': File exists.
 *
 * On this platform the usual cause is a backend restart (a deployment) landing on
 * top of an in-flight auto-commit. That would be a minor annoyance except for how
 * it FAILS: core's `autoCommitAndPush` swallows every error — "Do not rethrow —
 * periodic timers must not crash the app" — so from the moment the lock appears,
 * every hourly auto-commit dies against it in silence. The repository quietly
 * stops syncing and the analytics screen goes on showing auto-commit "On". The
 * first honest report comes from the manual sync button, possibly days later.
 *
 * WHAT THIS DOES, in escalating order, and only ever in reaction to git actually
 * refusing:
 *
 *   1. WAIT. A lock held by a live process is not an error, it is a queue. Poll
 *      until it disappears (default 15s) and retry.
 *   2. REMOVE, but only a lock that is provably STALE: untouched for
 *      `staleMs` (default 60s). git updates the lock's mtime as it writes the new
 *      index into it, so a full minute without a single write means no process is
 *      writing. A fresh lock is left alone and the caller is told a real git
 *      process is running.
 *   3. Give up with git's own message plus which file is holding it.
 *
 * THE PATH IS TAKEN FROM GIT'S ERROR, NOT GUESSED. `Unable to create '<path>'`
 * names the exact file, so recovery never has to assume it was `index.lock` —
 * a ref lock is handled by the same code. Before unlinking, the path is checked
 * to be inside THIS repository's `.git` directory and to end in `.lock`; anything
 * else is refused, so a malformed or hostile message cannot direct a delete
 * elsewhere.
 *
 * RESIDUAL RISK, stated plainly: "no write for 60s" infers that no process holds
 * the lock; it does not prove it. A git command that locks, then blocks for over
 * a minute before writing — a very slow pre-commit hook, an ENOSPC stall — would
 * be misread as dead, and removing its lock could corrupt the operation it was
 * part of. Callers reduce this by stopping their own auto-sync timers first (see
 * repositorySync.performSync), so the only candidate is an external process.
 * Tune with `REPO_SYNC_LOCK_STALE_MS`; raise it if this repository runs slow
 * hooks.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-18
 */

'use strict';

const path = require('node:path');
const fsp = require('node:fs').promises;

/** How long to wait for a live process to release the lock. */
const LOCK_WAIT_MS = Number(process.env.REPO_SYNC_LOCK_WAIT_MS) > 0
  ? Number(process.env.REPO_SYNC_LOCK_WAIT_MS)
  : 15000;

/** How long a lock must go untouched before it is treated as abandoned. */
const LOCK_STALE_MS = Number(process.env.REPO_SYNC_LOCK_STALE_MS) > 0
  ? Number(process.env.REPO_SYNC_LOCK_STALE_MS)
  : 60000;

const LOCK_POLL_MS = 500;

/**
 * Does this error mean git refused because another process holds a lock?
 *
 * @param {Error} err
 * @return {boolean}
 */
function isLockError(err) {
  const message = String((err && err.message) || '');
  return /\.lock':\s*File exists/i.test(message)
    || /Another git process seems to be running/i.test(message)
    || /index\.lock/i.test(message);
}

/**
 * The lock file git named, or the conventional index lock when the message says
 * a git process is running but does not name a file.
 *
 * @param {Error} err
 * @param {string} localPath Repository working directory.
 * @return {?string}
 */
function lockPathFromError(err, localPath) {
  const message = String((err && err.message) || '');
  const named = message.match(/Unable to create '([^']+\.lock)'/i);
  if (named) return named[1];
  if (!localPath) return null;
  if (/index\.lock|Another git process seems to be running/i.test(message)) {
    return path.join(localPath, '.git', 'index.lock');
  }
  return null;
}

/**
 * Current state of a lock file.
 *
 * @param {string} lockPath
 * @param {number=} staleMs
 * @return {Promise<{present: boolean, path: string, ageMs: ?number, stale: boolean}>}
 */
async function inspectLock(lockPath, staleMs = LOCK_STALE_MS) {
  const resolved = path.resolve(lockPath);
  try {
    const stat = await fsp.stat(resolved);
    const ageMs = Math.max(0, Date.now() - stat.mtimeMs);
    return { present: true, path: resolved, ageMs, stale: ageMs >= staleMs };
  } catch (err) {
    if (err.code === 'ENOENT') return { present: false, path: resolved, ageMs: null, stale: false };
    throw err;
  }
}

/**
 * The index lock for a repository, reported for diagnostics. Never throws — a
 * status panel must not fail because a stat did.
 *
 * @param {string} localPath Repository working directory.
 * @param {number=} staleMs
 * @return {Promise<?{present: boolean, path: string, ageMs: ?number, stale: boolean}>}
 */
async function inspectIndexLock(localPath, staleMs = LOCK_STALE_MS) {
  if (!localPath) return null;
  try {
    return await inspectLock(path.join(localPath, '.git', 'index.lock'), staleMs);
  } catch (_) {
    return null;
  }
}

/**
 * Poll until the lock is gone or the deadline passes.
 *
 * @param {string} lockPath
 * @param {number} waitMs
 * @return {Promise<boolean>} true when the lock cleared on its own.
 */
async function waitForLockRelease(lockPath, waitMs) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const state = await inspectLock(lockPath).catch(() => null);
    if (state && !state.present) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

/**
 * Remove the lock, but only when it is inside this repository's `.git`, ends in
 * `.lock`, and has gone `staleMs` without being written.
 *
 * @param {Object} params
 * @param {string} params.lockPath
 * @param {string} params.localPath Repository working directory.
 * @param {number=} params.staleMs
 * @param {Object=} params.log
 * @param {string=} params.instanceName For the log line.
 * @return {Promise<{removed: boolean, reason: string, ageMs: ?number}>}
 */
async function removeStaleLock({ lockPath, localPath, staleMs = LOCK_STALE_MS, log, instanceName }) {
  const resolved = path.resolve(lockPath);
  const gitDir = path.resolve(localPath || '', '.git');

  if (!resolved.endsWith('.lock')) {
    return { removed: false, reason: 'not-a-lock-file', ageMs: null };
  }
  if (!localPath || !resolved.startsWith(gitDir + path.sep)) {
    // Never delete outside the repository git directory named by the caller.
    return { removed: false, reason: 'outside-repository', ageMs: null };
  }

  let state;
  try {
    state = await inspectLock(resolved, staleMs);
  } catch (err) {
    return { removed: false, reason: `stat-failed: ${err.message}`, ageMs: null };
  }

  if (!state.present) return { removed: false, reason: 'already-gone', ageMs: null };
  if (!state.stale) return { removed: false, reason: 'active', ageMs: state.ageMs };

  try {
    await fsp.unlink(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') return { removed: false, reason: 'already-gone', ageMs: state.ageMs };
    return { removed: false, reason: `unlink-failed: ${err.message}`, ageMs: state.ageMs };
  }

  log?.warn?.(
    `Git lock: removed STALE ${resolved} for "${instanceName || localPath}" — untouched for `
    + `${Math.round(state.ageMs / 1000)}s, so no git process was writing it. This is what a git `
    + 'process killed mid-operation leaves behind, commonly a backend restart during an auto-commit; '
    + 'every auto-sync since then will have been failing silently against it.'
  );
  return { removed: true, reason: 'stale', ageMs: state.ageMs };
}

/**
 * Run a git operation, recovering once from a lock held by a dead process.
 *
 * `operation` must be safely repeatable: it is re-run from the start after the
 * lock clears.
 *
 * @param {Function} operation Zero-arg function returning a promise.
 * @param {Object} params
 * @param {string} params.localPath Repository working directory.
 * @param {string=} params.instanceName
 * @param {string=} params.label What is being retried, for the log.
 * @param {Object=} params.log
 * @param {number=} params.waitMs
 * @param {number=} params.staleMs
 * @return {Promise<*>} Whatever `operation` resolves to.
 */
async function withLockRecovery(operation, {
  localPath,
  instanceName,
  label = 'git operation',
  log,
  waitMs = LOCK_WAIT_MS,
  staleMs = LOCK_STALE_MS
} = {}) {
  try {
    return await operation();
  } catch (err) {
    if (!isLockError(err)) throw err;

    const lockPath = lockPathFromError(err, localPath);
    if (!lockPath) throw err;

    log?.warn?.(
      `Git lock: "${instanceName}" ${label} blocked by ${lockPath} — waiting up to `
      + `${Math.round(waitMs / 1000)}s for it to clear.`
    );

    if (await waitForLockRelease(lockPath, waitMs)) {
      log?.info?.(`Git lock: "${instanceName}" lock cleared on its own — retrying ${label}.`);
      return operation();
    }

    const outcome = await removeStaleLock({ lockPath, localPath, staleMs, log, instanceName });
    if (outcome.removed) return operation();

    // Still held, and not provably abandoned — say which file and why we left it.
    const age = outcome.ageMs == null ? 'unknown' : `${Math.round(outcome.ageMs / 1000)}s`;
    const detail = outcome.reason === 'active'
      ? `It was last written ${age} ago, so a git process really is running in ${localPath}. `
        + 'Wait for it to finish and sync again.'
      : `The lock was left in place (${outcome.reason}). If no git process is running in `
        + `${localPath}, remove ${lockPath} and sync again.`;

    const wrapped = new Error(`${err.message.trim()}\n\n${detail}`);
    wrapped.cause = err;
    wrapped.code = 'GIT_LOCKED';
    wrapped.lockPath = lockPath;
    throw wrapped;
  }
}

module.exports = {
  LOCK_WAIT_MS,
  LOCK_STALE_MS,
  isLockError,
  lockPathFromError,
  inspectLock,
  inspectIndexLock,
  waitForLockRelease,
  removeStaleLock,
  withLockRecovery
};
