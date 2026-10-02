// @ts-check
// Phase F02: running git, and running some git commands ONE AT A TIME.
//
// Several agents work at once, each in its own worktree. But some git commands
// change files shared by all of them (the mirror's refs, its list of
// worktrees, its config). Two `git worktree add`s at the same moment can
// collide on .git/worktrees or a ref lock. So those go through a queue per
// repository: parallel work, serial bookkeeping. (Same trick as harness Phase 29.)
// And across processes, a lock file: see withRepoLock().
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Run git and return its stdout, trimmed. Throws with git's own message on failure.
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 */
export async function git(args, { cwd, env } = {}) {
  try {
    const { stdout } = await run('git', args, { cwd, env: env && { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 });
    return stdout.trim();
  } catch (error) {
    const err = /** @type {any} */ (error);
    const message = String(err.stderr || err.message).trim().replace(/^fatal: /, '');
    throw new Error(`git ${args[0]} failed: ${message}`);
  }
}

/** @type {Map<string, Promise<unknown>>} */
const queues = new Map();

/**
 * Run `fn` after everything queued before it for the same `key` (e.g. a mirror's folder).
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function serially(key, fn) {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Keep the chain alive but don't let one failure poison the next caller.
  queues.set(key, next.catch(() => {}));
  return next;
}

/**
 * `serially` only orders work INSIDE this process. Two `factory` commands run
 * at once are two processes, and they raced to create the same mirror (found
 * by the F02 checkpoint, not by the tests: the tests ran in one process).
 * So shared git bookkeeping also takes a LOCK FILE, which works across processes:
 *
 *   open("<dir>.lock", "wx")   "wx" = create, and fail if it already exists: atomic
 *   … do the work …
 *   delete the lock
 *
 * A process that crashes holding the lock would block everyone forever, so a
 * lock whose owner (the pid written inside) no longer exists is "stale" and removed.
 * @template T
 * @param {string} dir
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withRepoLock(dir, fn, { timeoutMs = 120_000 } = {}) {
  return serially(dir, async () => {
    const lock = `${dir}.lock`;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
        break;
      } catch (error) {
        if (/** @type {any} */ (error).code !== 'EEXIST') throw error;
        if (isStale(lock)) fs.rmSync(lock, { force: true });
        else if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${lock} (held by pid ${readPid(lock)}).`);
        else await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 50));
      }
    }
    try {
      return await fn();
    } finally {
      fs.rmSync(lock, { force: true });
    }
  });
}

function readPid(lock) {
  try {
    return Number(fs.readFileSync(lock, 'utf8'));
  } catch {
    return 0;
  }
}

function isStale(lock) {
  const pid = readPid(lock);
  if (!pid) return false; // being written right now: wait
  try {
    process.kill(pid, 0); // signal 0: "does this process exist?", sends nothing
    return false;
  } catch (error) {
    return /** @type {any} */ (error).code === 'ESRCH';
  }
}

/** Commit identity: the user's if git has one, otherwise "factory" (never changes their config). */
export async function identityArgs(cwd) {
  const email = await git(['config', 'user.email'], { cwd }).catch(() => '');
  return email ? [] : ['-c', 'user.name=factory', '-c', 'user.email=factory@localhost'];
}
