/**
 * @fileoverview Discard this host's local state and match the remote exactly.
 *
 *   git fetch origin <branch>
 *   git reset --hard origin/<branch>
 *   git clean -fd
 *
 * WHAT THIS IS FOR. A content repository on this platform is written by machines —
 * workflow renderers, `.system/` artifact generators, the auto-commit timer — and
 * when one of those goes wrong it goes wrong at scale: a few thousand rewritten
 * documents, a half-finished conversion run, a merge the provider's conflict
 * strategy resolved in the unwanted direction. The clone is a CACHE of the remote,
 * not a place work is authored, so the cheapest repair is to throw the local copy
 * away and take the remote's version. That is what Sync cannot do: `fetch()` pulls
 * and MERGES, so a diverged or dirty tree stays diverged.
 *
 * WHAT IT DESTROYS, stated plainly, because nothing here can be undone from the UI:
 *   - every uncommitted change to a tracked file (`reset --hard`),
 *   - every LOCAL COMMIT the remote does not have — including ones the auto-commit
 *     timer made and could not push,
 *   - every untracked file and folder (`clean -fd`).
 * Only `.gitignore`d files survive, because `clean` is run WITHOUT `-x`: on these
 * hosts that is what keeps a local `.env`, editor state and any node_modules under
 * a content root out of the blast radius. `-x` would take them too and there is no
 * reason to.
 *
 * WHAT IT DOES NOT TOUCH: the remote. There is no push, no force-push, no history
 * rewrite — nothing another clone can notice. That asymmetry is the whole safety
 * argument for offering this as a button at all, and it is why a reset needs no
 * coordination with anyone else, unlike the rewrite it superficially resembles.
 *
 * RECOVERY, such as it is. `reset --hard` leaves the discarded tip in the reflog,
 * so a local commit is recoverable with `git reflog` on the host until something
 * expires it — and `repositoryCompact` expires it deliberately (`reflog expire
 * --expire=now`). Uncommitted and untracked content is simply gone. So the discarded
 * commits are LOGGED with their subjects before the reset runs; that log line is
 * frequently the only surviving record of what was thrown away.
 *
 * WHY IT REPORTS WHAT IT DISCARDED, rather than just succeeding. "Reset" that says
 * nothing is indistinguishable from "reset" that silently ate three days of an
 * auto-commit backlog because a push had been failing on an expired token. The
 * result carries the commit subjects, the changed-file count and the removed paths
 * so the screen can say what it actually cost.
 *
 * THE CONFIGURED BRANCH IS THE TARGET, not whatever happens to be checked out. If
 * the clone has drifted onto another branch or a detached HEAD, `reset --hard` moves
 * THAT ref to `origin/<branch>` — the content becomes correct while the checkout
 * stays wrong, and the auto-commit timer would go on committing somewhere that
 * cannot be pushed. Repairing a checkout is a different operation with different
 * risks, so this one does not attempt it; it reports `branchMismatch` instead, which
 * is the honest answer and the one that leads to the right fix.
 *
 * A RESET CAN SUCCEED AND LEAVE THE TREE DIRTY, and that is not a bug in the reset:
 * these repositories contain paths that differ only in case, which Windows cannot
 * represent, so git writes both blobs to one file and reports the loser as modified
 * forever. `findCaseCollisions` names them — the diagnosis is worth more than the
 * operation on the day it happens.
 *
 * Runs under the same exclusion, timer pause and lock recovery as a manual sync (see
 * repositorySync.js) — a reset mid-commit is how a repository ends up in a state
 * neither operation intended.
 *
 * AFTERMATH, worth knowing when reading logs: a reset can rewrite thousands of files
 * in seconds, and the wiki's FileWatcher sees every one of them. Expect a burst of
 * change events, cache invalidation and search re-indexing behind it. That is
 * correct — the documents really did change — but it is why a reset on a large
 * content root is felt by the app for a minute or so afterwards.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-20
 */

'use strict';

const { runExclusive, pauseAutoSync, gitHandleFor } = require('./repositorySync');
const { withLockRecovery } = require('./gitLock');

/** Most discarded commits described in the result (all of them are counted). */
const MAX_REPORTED_COMMITS = 20;

/** Most removed paths listed in the result (all of them are counted). */
const MAX_REPORTED_PATHS = 50;

/**
 * Snapshot of the working tree, taken before and after the reset so the caller can
 * report the difference rather than assert success.
 *
 * @param {Object} git simple-git handle.
 * @return {Promise<{head: ?string, branch: ?string, ahead: number, behind: number,
 *   dirty: number}>}
 */
async function readState(git) {
  const status = await git.status();
  const head = await git.revparse(['HEAD']).catch(() => null);
  const files = Array.isArray(status.files) ? status.files : [];
  return {
    head: head ? String(head).trim() : null,
    branch: status.current || null,
    ahead: Number(status.ahead) || 0,
    behind: Number(status.behind) || 0,
    dirty: files.length,
    // Kept for diagnosis only (see findCaseCollisions) and stripped before the
    // state is returned to a caller — a large content root's dirty list is
    // thousands of paths and none of them belong in an HTTP response.
    paths: files.map((f) => f.path).filter(Boolean)
  };
}

/** The transport-safe view of a state: everything except the raw path list. */
function publicState(state) {
  const { paths, ...rest } = state;
  return rest;
}

/**
 * Tracked paths that differ from another tracked path ONLY in case.
 *
 * WHY A RESET CAN FINISH AND LEAVE THE TREE DIRTY — the one failure mode that
 * makes this operation look broken when it worked perfectly.
 *
 * These repositories are written by workflows that name documents after upstream
 * records, and upstream happily holds two entities called `Monitor Store
 * Performance` and `Monitor store performance`. On the Linux host that generated
 * them, and on the remote, those are two files. On Windows they are ONE, so
 * `checkout`/`reset --hard` writes both blobs to the same path, the last one wins,
 * and git then reports the loser as modified — forever. `reset --hard` cannot fix
 * it, `clean` cannot fix it, and every sync afterwards tries to commit the
 * difference back.
 *
 * Reported rather than repaired, because there is no local repair: no Windows
 * filesystem can hold both files. The fix is upstream — drop one variant from the
 * repository (on a case-sensitive host, or `git rm --cached` the loser and push)
 * and stop the generator emitting names that collide case-insensitively.
 *
 * `ls-files -z` because these names carry spaces, brackets and non-ASCII, which
 * git's default output would quote and escape.
 *
 * @param {Object} git simple-git handle.
 * @return {Promise<Array<Array<string>>>} One inner array per colliding group.
 */
async function findCaseCollisions(git) {
  const out = String(await git.raw(['ls-files', '-z']) || '');
  const byLower = new Map();
  for (const raw of out.split('\0')) {
    const file = raw.trim();
    if (!file) continue;
    const key = file.toLowerCase();
    const group = byLower.get(key);
    if (group) group.push(file);
    else byLower.set(key, [file]);
  }
  const groups = [];
  for (const group of byLower.values()) {
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

/**
 * The local commits `origin/<branch>` does not have — i.e. exactly what the reset
 * is about to drop.
 *
 * Best-effort by design: this is diagnostics, and a clone whose HEAD is unborn or
 * whose remote ref is missing must not fail the reset that would repair it. The
 * count comes from `rev-list --count` so it is honest even when the subject list is
 * capped.
 *
 * @param {Object} git simple-git handle.
 * @param {string} range e.g. `origin/main..HEAD`.
 * @return {Promise<{count: number, commits: Array<{hash: string, subject: string}>}>}
 */
async function readDiscardedCommits(git, range) {
  try {
    const countOut = await git.raw(['rev-list', '--count', range]);
    const count = Number(String(countOut).trim()) || 0;
    if (!count) return { count: 0, commits: [] };

    const logOut = String(await git.raw([
      'log', '--no-decorate', '--pretty=format:%h %s', `-n${MAX_REPORTED_COMMITS}`, range
    ]) || '');
    const commits = logOut
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const space = line.indexOf(' ');
        return space === -1
          ? { hash: line, subject: '' }
          : { hash: line.slice(0, space), subject: line.slice(space + 1) };
      });
    return { count, commits };
  } catch (_) {
    return { count: 0, commits: [] };
  }
}

/**
 * Paths `git clean` reported removing.
 *
 * `clean` prints one `Removing <path>` line per entry (a directory arrives as a
 * single line with a trailing slash, so this counts ENTRIES removed, not files
 * within them). Parsed rather than pre-computed with `--dry-run` because a separate
 * dry run is a second walk of a large tree and can disagree with the real one.
 *
 * @param {string} output stdout of `git clean -fd`.
 * @return {Array<string>}
 */
function parseCleanOutput(output) {
  return String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^Removing\s+(.+)$/i);
      return match ? match[1].trim() : null;
    })
    .filter(Boolean);
}

/**
 * Confirm the remote branch this reset targets actually exists, before anything
 * destructive runs.
 *
 * Without this the failure lands on `reset --hard origin/main` with git's own
 * "unknown revision or path not in the working tree", which reads like a corrupt
 * clone. The real cause is nearly always mundane — the remote's default branch is
 * `master`, or `branch` in repositories.json is a typo — and neither is guessable
 * from git's message.
 *
 * @param {Object} git simple-git handle.
 * @param {string} target e.g. `origin/main`.
 * @param {string} instanceName
 * @return {Promise<string>} The target commit sha.
 * @throws {Error} `code: 'RESET_NO_REMOTE_BRANCH'`
 */
async function assertRemoteBranch(git, target, instanceName) {
  try {
    const sha = await git.raw(['rev-parse', '--verify', `${target}^{commit}`]);
    return String(sha).trim();
  } catch (err) {
    const wrapped = new Error(
      `"${instanceName}" has no remote branch "${target}" after fetching. Check `
      + '`branch` in repositories.json against the branch the remote actually publishes '
      + '(a repository whose default is `master` is the usual cause).'
    );
    wrapped.code = 'RESET_NO_REMOTE_BRANCH';
    wrapped.cause = err;
    throw wrapped;
  }
}

/**
 * Do the reset. Assumes exclusive access — call through resetRepository.
 *
 * @param {Object} params
 * @param {Object} params.filer Core FilingService (provider 'git').
 * @param {string} params.instanceName
 * @param {Object=} params.log
 * @param {string=} params.actor
 * @return {Promise<Object>} What was discarded and where the clone ended up.
 */
async function performReset({ filer, instanceName, log, actor }) {
  const started = Date.now();
  const git = await gitHandleFor(filer, instanceName);
  const provider = filer.provider;
  const localPath = provider.localPath;
  const branch = provider.branch || 'main';
  const remote = provider.remote || 'origin';
  const target = `${remote}/${branch}`;
  const who = actor || 'unknown user';

  const before = await readState(git);
  // A checkout that has drifted is reported, never silently "fixed" — see header.
  const branchMismatch = !!before.branch && before.branch !== branch;

  const resumeAutoSync = pauseAutoSync(provider);
  let discarded = { count: 0, commits: [] };
  let removedPaths = [];
  try {
    const recover = (label, operation) =>
      withLockRecovery(operation, { localPath, instanceName, label, log });

    // 1. Bring the remote-tracking ref up to date. The branch is named explicitly
    //    so this does not depend on the clone's refspec — a `--single-branch`
    //    shallow clone (what repositoryManager makes when `depth` is set) has a
    //    narrow one. A shallow clone STAYS shallow: fetch keeps the existing
    //    horizon unless asked to --unshallow.
    await recover('fetch', () => git.raw(['fetch', remote, branch]));

    const targetSha = await assertRemoteBranch(git, target, instanceName);

    // 2. Establish, and LOG, what is about to be thrown away. This runs after the
    //    fetch so it is measured against the tip the reset will land on, and before
    //    the reset because afterwards there is nothing left to measure.
    discarded = await readDiscardedCommits(git, `${target}..HEAD`);
    log?.warn?.(
      `Repository reset: "${instanceName}" → ${target} (${targetSha.slice(0, 8)}) requested by ${who}. `
      + `Discarding ${discarded.count} local commit(s), ${before.dirty} uncommitted change(s) and every `
      + 'untracked file. The remote is not modified.'
      + (discarded.commits.length
        ? ` Commits: ${discarded.commits.map((c) => `${c.hash} ${c.subject}`).join(' | ')}`
        : '')
      + (branchMismatch
        ? ` NOTE: this clone is on "${before.branch}", not the configured "${branch}" — that ref is `
          + 'what moves.'
        : '')
    );

    // 3. Tracked files: match the remote exactly.
    await recover('reset --hard', () => git.raw(['reset', '--hard', target]));

    // 4. Untracked files and directories. Deliberately no `-x`: ignored files are
    //    local infrastructure, not stale content (see header).
    const cleanOut = await recover('clean', () => git.raw(['clean', '-fd']));
    removedPaths = parseCleanOutput(cleanOut);
  } finally {
    resumeAutoSync();
  }

  const after = await readState(git);

  // A tree that is STILL dirty after a hard reset plus a clean is not a failed
  // reset — it is almost always a case collision the filesystem cannot represent
  // (see findCaseCollisions). Diagnosed here, at the only moment the answer is
  // unambiguous, because the alternative is a user watching a "successful" reset
  // leave 22 modified files behind with nothing to explain it.
  let caseCollisions = null;
  if (after.dirty > 0) {
    const groups = await findCaseCollisions(git).catch(() => []);
    if (groups.length) {
      const stillDirty = new Set(after.paths.map((p) => p.toLowerCase()));
      const stuck = groups.filter((group) => stillDirty.has(group[0].toLowerCase()));
      caseCollisions = {
        total: groups.length,
        stuck: stuck.length,
        groups: (stuck.length ? stuck : groups).slice(0, MAX_REPORTED_PATHS)
      };
      if (stuck.length) {
        log?.warn?.(
          `Repository reset: "${instanceName}" is still showing ${after.dirty} modified file(s) after `
          + `the reset. ${stuck.length} of ${groups.length} tracked path group(s) differ only in CASE, `
          + 'which this filesystem cannot represent — git writes both blobs to the same file and reports '
          + 'the loser as modified. No reset can clear this; remove one variant from the repository. '
          + `First: ${stuck[0].join(' | ')}`
        );
      }
    }
  }

  const result = {
    instanceName,
    remote,
    branch,
    target,
    before: publicState(before),
    after: publicState(after),
    // What is STILL modified now that the reset has finished, and why.
    residualDirty: after.dirty,
    caseCollisions,
    branchMismatch,
    checkedOutBranch: before.branch,
    discardedCommitCount: discarded.count,
    // Capped for transport; discardedCommitCount is the true number.
    discardedCommits: discarded.commits,
    discardedFiles: before.dirty,
    removedCount: removedPaths.length,
    removedPaths: removedPaths.slice(0, MAX_REPORTED_PATHS),
    // `head` moving is the proof the reset changed anything at all; a clone that
    // was already level with the remote reports false and no discards.
    moved: !!before.head && !!after.head && before.head !== after.head,
    durationMs: Date.now() - started
  };

  log?.info?.(
    `✓ Repository reset: "${instanceName}" now at ${target} `
    + `${after.head ? after.head.slice(0, 8) : '?'} `
    + `(dropped ${result.discardedCommitCount} commit(s), ${result.discardedFiles} change(s), `
    + `removed ${result.removedCount} untracked entr${result.removedCount === 1 ? 'y' : 'ies'}) `
    + `in ${result.durationMs}ms`
  );
  return result;
}

/**
 * Reset one repository to its remote now, refusing a concurrent run for the same
 * instance.
 *
 * Shares repositorySync's exclusion map, so a reset can never interleave with a
 * sync or a compaction on the same working tree.
 *
 * @param {Object} params
 * @param {Object} params.filer Core FilingService (provider 'git').
 * @param {string} params.instanceName Registry instance name.
 * @param {Object=} params.log Structured logger.
 * @param {string=} params.actor Email/username of the triggering user, for the log.
 * @return {Promise<Object>} See performReset.
 * @throws {Error} `code: 'REPOSITORY_BUSY'` when the repository is in use.
 */
async function resetRepository({ filer, instanceName, log, actor }) {
  return runExclusive(instanceName, 'a reset to remote', () =>
    performReset({ filer, instanceName, log, actor }));
}

module.exports = {
  resetRepository,
  // Also read by the analytics route, so a tree that can never be clean is
  // explained on the screen rather than only in a reset's result.
  findCaseCollisions,
  // Exported for tests.
  performReset,
  readState,
  readDiscardedCommits,
  parseCleanOutput,
  assertRemoteBranch,
  MAX_REPORTED_COMMITS,
  MAX_REPORTED_PATHS
};
