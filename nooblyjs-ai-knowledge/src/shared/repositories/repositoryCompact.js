/**
 * @fileoverview Shrink a git-backed filer's local clone by dropping history.
 *
 * WHY THESE REPOSITORIES GROW. They are committed on a timer, and what they hold
 * is machine-written: workflow-rendered landscape documents and regenerated
 * `.system/` artifacts. Measured on the live content roots, roughly half of every
 * large clone is history rather than current content — and not because of commit
 * COUNT. engineering-process reached 339MB of `.git` in SIX commits. The cause is
 * what a commit stores: the biggest documents are markdown files whose entire
 * body is one multi-megabyte line of base64 PNG. Base64 is a delta compressor's
 * worst case, so every re-render of a diagram writes a fresh ~4MB blob rather
 * than a diff, and the history accumulates copies of images nobody will read
 * again.
 *
 * WHY SHALLOW RATHER THAN A REWRITE. Squashing history and force-pushing would
 * shrink the REMOTE too, but it rewrites history other clones share, may be
 * refused by branch protection, and is unrecoverable if it goes wrong. Shallowing
 * touches only this host: `git fetch --depth=N` moves the local horizon up,
 * `reflog expire` drops the refs still pinning what fell below it, and `gc
 * --prune=now` deletes the now-unreachable objects. The remote keeps its full
 * history, no other clone notices, and the whole thing reverses with `git fetch
 * --unshallow`. Verified end to end before this module was written: a shallowed
 * clone still commits and pushes normally, and the remote's history stays intact.
 *
 * WHY DEPTH 1 IS THE DEFAULT. It reclaims the most, and it costs this platform
 * nothing it was not already giving up: the provider's own conflict strategy
 * resets --hard to origin once local divergence passes `conflictThreshold`, so
 * local history is ALREADY treated as disposable. Raise `depth` per repository
 * when someone needs to read recent commits on the host, remembering that each
 * retained auto-commit of a base64 document costs about the size of the image.
 *
 * IT IS RE-RUNNABLE, AND MEANT TO BE. Shallowing does not stop the repository
 * growing again — hourly commits pile up above the horizon just as before. Each
 * run moves the horizon back to the tip and reclaims whatever accumulated since,
 * so this is a maintenance operation, not a one-time migration. Unlike a
 * force-push rewrite it is safe to repeat and safe to schedule.
 *
 * PRECONDITIONS. The branch must be level with its remote. Unpushed commits
 * (`ahead > 0`) are refused because shallowing plus `gc` around work that exists
 * nowhere else is the one way this operation can lose data — sync first, and the
 * commits are safe on the remote. `behind > 0` is refused because the horizon
 * would be set from a tip this clone has not caught up to. A DIRTY working tree
 * is fine and deliberately allowed: these repositories almost always hold changes
 * waiting for the next auto-commit, and neither fetch nor gc touches the working
 * tree.
 *
 * Runs under the same exclusion, timer pause and lock recovery as a manual sync —
 * `gc` repacks the object store a commit would be writing into.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-18
 */

'use strict';

const { runExclusive, pauseAutoSync, gitHandleFor, isBusy } = require('./repositorySync');
const { withLockRecovery } = require('./gitLock');

/** Default commits to retain above the shallow horizon. */
const DEFAULT_DEPTH = Number(process.env.REPO_COMPACT_DEPTH) > 0
  ? Number(process.env.REPO_COMPACT_DEPTH)
  : 1;

/**
 * instanceName → last compaction job. In memory only: a restart loses the
 * REPORT, never the work. Every step is a plain git command that either
 * completed or did not, and re-running is safe.
 */
const jobs = new Map();

/**
 * Object-store size, straight from `git count-objects -v` (KiB) rather than a
 * directory walk — it is one cheap command and it counts what git actually
 * holds, not stale temporary packs.
 *
 * @param {Object} git simple-git handle.
 * @return {Promise<{looseBytes: number, packBytes: number, totalBytes: number,
 *   objects: number, packs: number}>}
 */
async function readObjectStore(git) {
  const out = String(await git.raw(['count-objects', '-v']) || '');
  const field = (key) => {
    const match = out.match(new RegExp(`^${key}:\\s*(\\d+)\\s*$`, 'm'));
    return match ? Number(match[1]) : 0;
  };
  const looseBytes = field('size') * 1024;
  const packBytes = field('size-pack') * 1024;
  return {
    looseBytes,
    packBytes,
    totalBytes: looseBytes + packBytes,
    objects: field('count') + field('in-pack'),
    packs: field('packs')
  };
}

/**
 * @param {Object} git simple-git handle.
 * @return {Promise<boolean>}
 */
async function isShallow(git) {
  const out = await git.raw(['rev-parse', '--is-shallow-repository']);
  return String(out).trim() === 'true';
}

/**
 * @param {Object} git simple-git handle.
 * @return {Promise<number>} Commits reachable from HEAD in THIS clone.
 */
async function countCommits(git) {
  try {
    return Number(String(await git.raw(['rev-list', '--count', 'HEAD'])).trim()) || 0;
  } catch (_) {
    return 0;
  }
}

/**
 * Refuse to compact a clone holding work the remote does not have, or one that
 * has not caught up to the remote.
 *
 * @param {Object} git simple-git handle.
 * @param {string} instanceName
 * @return {Promise<{ahead: number, behind: number, dirty: number}>}
 */
async function assertCompactable(git, instanceName) {
  const status = await git.status();
  const ahead = Number(status.ahead) || 0;
  const behind = Number(status.behind) || 0;

  if (ahead > 0) {
    const err = new Error(
      `"${instanceName}" has ${ahead} commit(s) that are not on the remote. Compaction drops `
      + 'local history, so push them first (Sync), then compact.'
    );
    err.code = 'COMPACT_AHEAD';
    throw err;
  }
  if (behind > 0) {
    const err = new Error(
      `"${instanceName}" is ${behind} commit(s) behind the remote. Fetch first (Sync), then `
      + 'compact, so the retained history is measured from the current tip.'
    );
    err.code = 'COMPACT_BEHIND';
    throw err;
  }

  return { ahead, behind, dirty: Array.isArray(status.files) ? status.files.length : 0 };
}

/**
 * Do the compaction. Assumes exclusive access — call through startCompact.
 *
 * @param {Object} params
 * @return {Promise<Object>} Before/after sizes and what was reclaimed.
 */
async function performCompact({ filer, instanceName, depth, log, actor }) {
  const started = Date.now();
  const git = await gitHandleFor(filer, instanceName);
  const provider = filer.provider;
  const localPath = provider.localPath;
  const branch = provider.branch || 'main';
  const who = actor || 'unknown user';

  const before = await readObjectStore(git);
  const commitsBefore = await countCommits(git);
  const wasShallow = await isShallow(git);
  const state = await assertCompactable(git, instanceName);

  log?.info?.(
    `Repository compact: "${instanceName}" requested by ${who} — depth=${depth}, `
    + `${Math.round(before.totalBytes / 1048576)}MB in ${commitsBefore} commit(s)`
    + `${state.dirty ? `, ${state.dirty} uncommitted change(s) (left untouched)` : ''}`
  );

  const resumeAutoSync = pauseAutoSync(provider);
  try {
    const recover = (label, operation) =>
      withLockRecovery(operation, { localPath, instanceName, label, log });

    // 1. Move the horizon to `depth` commits below the tip.
    await recover('shallow fetch', () =>
      git.raw(['fetch', `--depth=${depth}`, 'origin', branch]));

    // 2. Drop the reflog, which otherwise still references everything below it
    //    and would keep gc from pruning a single object.
    await recover('reflog expire', () =>
      git.raw(['reflog', 'expire', '--expire=now', '--all']));

    // 3. Repack. `--prune=now` rather than the default 2-week grace, because the
    //    objects being dropped were made unreachable deliberately, seconds ago.
    //    Not `--aggressive`: it re-deltas the whole store for a few percent more
    //    on top of minutes of CPU, and base64 blobs do not delta anyway.
    await recover('garbage collect', () =>
      git.raw(['gc', '--prune=now']));
  } finally {
    resumeAutoSync();
  }

  const after = await readObjectStore(git);
  const result = {
    instanceName,
    depth,
    wasShallow,
    shallow: await isShallow(git),
    commitsBefore,
    commitsAfter: await countCommits(git),
    before,
    after,
    reclaimedBytes: Math.max(0, before.totalBytes - after.totalBytes),
    dirtyFilesPreserved: state.dirty,
    durationMs: Date.now() - started
  };

  log?.info?.(
    `✓ Repository compact: "${instanceName}" ${Math.round(before.totalBytes / 1048576)}MB → `
    + `${Math.round(after.totalBytes / 1048576)}MB `
    + `(reclaimed ${Math.round(result.reclaimedBytes / 1048576)}MB, `
    + `${commitsBefore} → ${result.commitsAfter} commits) in ${result.durationMs}ms`
  );
  return result;
}

/**
 * Start a compaction in the background and return its job record immediately.
 *
 * Deliberately not awaited by the caller: `gc` on a repository this size is
 * minutes of CPU, far past any reverse proxy's idle timeout, so the HTTP layer
 * answers 202 and the client polls `getCompactJob`.
 *
 * @param {Object} params
 * @param {Object} params.filer Core FilingService (provider 'git').
 * @param {string} params.instanceName
 * @param {number=} params.depth Commits to retain (default DEFAULT_DEPTH).
 * @param {Object=} params.log
 * @param {string=} params.actor
 * @return {Object} Job record — see getCompactJob.
 * @throws {Error} `code: 'REPOSITORY_BUSY'` when the repository is in use.
 */
function startCompact({ filer, instanceName, depth, log, actor }) {
  if (isBusy(instanceName)) {
    // Checked before the job record is created so a refused start never
    // overwrites the previous run's report.
    const err = new Error(`Repository "${instanceName}" is busy — try again shortly.`);
    err.code = 'REPOSITORY_BUSY';
    throw err;
  }

  const requestedDepth = Number(depth) > 0 ? Math.floor(Number(depth)) : DEFAULT_DEPTH;
  const job = {
    instanceName,
    depth: requestedDepth,
    actor: actor || null,
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    result: null,
    error: null
  };
  jobs.set(instanceName, job);

  runExclusive(instanceName, 'a history compaction', () =>
    performCompact({ filer, instanceName, depth: requestedDepth, log, actor }))
    .then((result) => { job.result = result; })
    .catch((err) => {
      job.error = err.message;
      job.errorCode = err.code || null;
      log?.error?.(`Repository compact failed for "${instanceName}": ${err.message}`);
    })
    .finally(() => {
      job.running = false;
      job.finishedAt = new Date().toISOString();
    });

  return job;
}

/**
 * @param {string} instanceName
 * @return {?Object} The last compaction job for this repository, or null.
 */
function getCompactJob(instanceName) {
  return jobs.get(instanceName) || null;
}

module.exports = {
  DEFAULT_DEPTH,
  startCompact,
  getCompactJob,
  // Exported for tests.
  performCompact,
  readObjectStore,
  isShallow,
  assertCompactable
};
