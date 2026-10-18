/**
 * @fileoverview On-demand (UI-triggered) synchronisation of a git-backed filer.
 *
 * The repositories registered by repositoryManager.js sync on TIMERS — whichever
 * of `synchronization.fetch` / `synchronization.commit` is true, every
 * `synchronization.interval` seconds. This module is the manual equivalent behind
 * the Repository analytics screen's sync button: run the SAME operations, now,
 * for whichever direction the repository is actually configured for. A repository
 * configured only to fetch fetches; one configured only to commit commits and
 * pushes; one configured for both does both.
 *
 * WHY THIS IS NOT JUST `provider.autoCommitAndPush()`. That is the core method the
 * commit timer calls, and its catch block ends with
 *   `// Do not rethrow — periodic timers must not crash the app`
 * so it swallows every failure and returns undefined either way. Correct for a
 * timer; wrong for a button. A rejected push (expired Bitbucket token, protected
 * branch, no upstream) would leave the screen reporting a successful sync while
 * nothing ever left the machine. The commit path is therefore composed here from
 * the provider's own primitives and EVERY error propagates to the caller.
 *
 * Two deliberate differences from the timer, both in the user's favour:
 *
 *   1. Nothing to commit but `ahead > 0` still PUSHES. `autoCommitAndPush` returns
 *      early on a clean tree, so a commit whose push failed once sits unpushed
 *      until something dirties the tree again — which on a read-mostly knowledge
 *      repository can be days.
 *   2. Commit+push runs BEFORE fetch. `provider.fetch()` pulls when behind, and
 *      `_pullWithConflictResolution` resets --hard to origin/<branch> once the
 *      local dirty count reaches `conflictThreshold`. Committing and pushing
 *      first means there is no uncommitted work left for that safety valve to
 *      discard.
 *
 * ONE SYNC PER REPOSITORY AT A TIME, AGAINST BOTH RIVALS. Two `git add -A` →
 * commit → push sequences interleaved in one working tree produce commits neither
 * caller asked for — and git enforces this itself with `.git/index.lock`, so the
 * loser does not merely misbehave, it fails outright with "Unable to create
 * '…/index.lock': File exists".
 *
 *   - Against another CLICK, and against a history compaction (repositoryCompact
 *     repacks the object store a commit writes into): `runExclusive` refuses the
 *     second with `code: 'REPOSITORY_BUSY'` rather than queueing it, because
 *     "your click did nothing yet" is a worse answer than "one is already
 *     running".
 *   - Against this repository's own AUTO TIMERS: they are stopped for the
 *     duration and restarted after (`pauseAutoSync`). Note this narrows the race
 *     without closing it — `clearInterval` does not cancel a timer callback that
 *     is already executing.
 *   - Against anything else, including a lock left behind by a git process that
 *     was KILLED (a deployment landing on an auto-commit): every action runs
 *     through `withLockRecovery`, which waits for a live lock and removes a
 *     provably abandoned one. See gitLock.js — that leftover lock is the failure
 *     that silently stops a repository syncing, because the auto-commit timer
 *     swallows the error it raises every hour thereafter.
 *
 * Reaching `filer.provider.git` (the simple-git handle) is the one piece of core
 * internals this module touches: the public FilingService surface exposes
 * `fetch()`, `push()` and `commitWithMessage(commitId, …)` — the last of which
 * only settles a queued CommitQueue entry — but nothing that stages an arbitrary
 * working tree. `push()` IS used through the wrapper so core's
 * rejected/non-fast-forward retry is preserved.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-17
 */

'use strict';

const { withLockRecovery } = require('./gitLock');

/** instanceName → in-flight sync promise. */
const inFlight = new Map();

/**
 * The operations a repository config asks for, in EXECUTION order (commit before
 * fetch — see the header). Returns [] when the repository syncs in neither
 * direction, which callers must treat as "no button to press".
 *
 * @param {Object} config Normalised config from readRepositoryConfigs().
 * @return {Array<'commit'|'fetch'>}
 */
function actionsFor(config) {
  const sync = (config && config.synchronization) || {};
  const actions = [];
  if (sync.commit === true) actions.push('commit');
  if (sync.fetch === true) actions.push('fetch');
  return actions;
}

/**
 * The simple-git handle behind a core FilingService wrapper, initialising the
 * provider first when the startup clone has not run.
 *
 * A null handle means `_ensureRepository()` never completed — repositoryManager
 * skips the clone when the target folder is non-empty and has no .git — so say
 * that, rather than letting a downstream call fail with a bare git message.
 *
 * @param {Object} filer Core FilingService (provider 'git').
 * @param {string} instanceName
 * @return {Promise<Object>} simple-git instance
 */
async function gitHandleFor(filer, instanceName) {
  const provider = filer && filer.provider;
  if (!provider) {
    throw new Error(`Repository "${instanceName}" has no filing provider.`);
  }
  if (!provider.git && typeof filer.initialize === 'function') {
    // Idempotent: returns immediately once the provider is initialised.
    await filer.initialize();
  }
  if (!provider.git) {
    throw new Error(
      `Repository "${instanceName}" is not cloned yet — the startup clone was skipped or failed. ` +
      'Check the application log for "Git repositories:" warnings.'
    );
  }
  return provider.git;
}

/**
 * Stage everything, commit when there is something staged, then push. Also
 * pushes a clean tree that is ahead of the remote.
 *
 * @param {Object} filer Core FilingService.
 * @param {Object} git simple-git handle.
 * @return {Promise<{committed: boolean, pushed: boolean, files: number,
 *   ahead: number, message: ?string}>}
 */
async function commitAndPush(filer, git) {
  await git.add(['-A']);

  // `git diff --cached --name-only` is the definitive "is there anything to
  // commit" test once everything is staged; simple-git's status buckets
  // (staged/created/deleted/modified/renamed) each cover only one change kind,
  // so checking them individually is easy to get subtly wrong.
  const stagedOut = (await git.diff(['--cached', '--name-only'])) || '';
  const files = stagedOut.split('\n').map((s) => s.trim()).filter(Boolean);

  if (!files.length) {
    const status = await git.status();
    const ahead = Number(status.ahead) || 0;
    if (ahead > 0) {
      await filer.push();
      return { committed: false, pushed: true, files: 0, ahead, message: null };
    }
    return { committed: false, pushed: false, files: 0, ahead: 0, message: null };
  }

  // Same message shape the commit timer writes, so the history stays uniform and
  // matches the "Commit message" the analytics screen advertises.
  const configured = filer.provider.commitMessage || 'Manual sync';
  const message = `${configured} [${new Date().toISOString()}]`;
  await git.commit(message);

  // Through the wrapper: core's push() re-fetches and retries once when the
  // remote rejects a non-fast-forward.
  await filer.push();

  return { committed: true, pushed: true, files: files.length, ahead: 0, message };
}

/**
 * Fetch, and pull when the branch is behind (core's fetch() does both, applying
 * the provider's conflict-resolution strategy).
 *
 * `fetch()` resolves void, so whether anything actually arrived is established by
 * comparing HEAD across the call rather than trusted from a return value.
 *
 * @param {Object} filer Core FilingService.
 * @param {Object} git simple-git handle.
 * @return {Promise<{pulled: boolean, head: ?string, behind: number}>}
 */
async function fetchAndPull(filer, git) {
  const headBefore = await git.revparse(['HEAD']).catch(() => null);
  await filer.fetch();
  const headAfter = await git.revparse(['HEAD']).catch(() => null);
  const status = await git.status();

  return {
    pulled: !!headBefore && !!headAfter && String(headBefore) !== String(headAfter),
    head: headAfter ? String(headAfter).trim().slice(0, 8) : null,
    behind: Number(status.behind) || 0
  };
}

/**
 * Stop this repository's auto-fetch / auto-commit timers so they cannot take
 * git's index lock while a manual sync holds it, and hand back a function that
 * restores exactly the timers the configuration asks for.
 *
 * `stopAuto*` is a no-op when the timer is not running and `startAuto*` is a
 * no-op when it already is, so this is safe regardless of the provider's state.
 * Restarting resets the interval phase — the next automatic run lands a full
 * interval after the manual one, which is the desired behaviour anyway.
 *
 * @param {Object} provider GitFilingProvider.
 * @return {Function} resume()
 */
function pauseAutoSync(provider) {
  provider.stopAutoFetch?.();
  provider.stopAutoCommit?.();
  return function resume() {
    try {
      if (provider.autoFetch) provider.startAutoFetch?.();
      if (provider.autoCommit) provider.startAutoCommit?.();
    } catch (_) {
      // Never let timer restoration mask the sync's own outcome.
    }
  };
}

/**
 * Run the requested actions in order and report what each one did.
 *
 * Each action is wrapped in `withLockRecovery` rather than the loop as a whole,
 * so a lock is recovered from at the granularity it was hit. Both actions are
 * safely repeatable from the start: re-running `commitAndPush` re-stages (`add
 * -A` is idempotent) and re-tests `diff --cached`, so a commit that DID land
 * before the failure falls through to the clean-tree-but-ahead push path rather
 * than being committed twice.
 *
 * On failure the error carries `.partial` — the result accumulated so far — so a
 * commit that landed locally but failed to push is still reported as such
 * instead of vanishing behind the push error.
 *
 * @param {Object} params
 * @return {Promise<Object>}
 */
async function performSync({ filer, instanceName, actions, log, actor }) {
  const started = Date.now();
  const git = await gitHandleFor(filer, instanceName);
  const who = actor || 'unknown user';
  const localPath = filer.provider.localPath;

  const result = {
    instanceName,
    actions: [...actions],
    commit: null,
    fetch: null,
    status: null,
    durationMs: 0
  };

  const resumeAutoSync = pauseAutoSync(filer.provider);
  try {
    for (const action of actions) {
      const recover = (label, operation) =>
        withLockRecovery(operation, { localPath, instanceName, label, log });

      if (action === 'commit') {
        log?.info?.(`Repository sync: commit+push "${instanceName}" requested by ${who}`);
        result.commit = await recover('commit+push', () => commitAndPush(filer, git));
      } else if (action === 'fetch') {
        log?.info?.(`Repository sync: fetch+pull "${instanceName}" requested by ${who}`);
        result.fetch = await recover('fetch+pull', () => fetchAndPull(filer, git));
      }
    }
  } catch (err) {
    err.partial = { ...result, durationMs: Date.now() - started };
    throw err;
  } finally {
    resumeAutoSync();
  }

  // Fresh status so the caller can repaint from the sync response. Best-effort:
  // the sync itself already succeeded and must not be reported as failed because
  // a follow-up status read did not.
  try {
    const status = await filer.getGitStatus();
    result.status = {
      branch: status.branch || null,
      ahead: status.git ? status.git.ahead : null,
      behind: status.git ? status.git.behind : null,
      changed: Array.isArray(status.git && status.git.files) ? status.git.files.length : 0,
      pendingCommits: status.pendingCommits || 0
    };
  } catch (_) { /* best-effort */ }

  result.durationMs = Date.now() - started;
  log?.info?.(
    `✓ Repository sync: "${instanceName}" [${actions.join('+')}] finished in ${result.durationMs}ms`
  );
  return result;
}

/**
 * Give `task` exclusive use of one repository's working tree.
 *
 * The gate covers every long git operation on a repository, not syncs alone —
 * history compaction (repositoryCompact.js) repacks the object store while a
 * sync would be committing into it, so the two must never overlap. One map,
 * shared, is what makes that true; a second lock beside this one would let each
 * operation prove only that it is not racing itself.
 *
 * @param {string} instanceName Registry instance name.
 * @param {string} operation Human name of the work, used in the busy message.
 * @param {Function} task Zero-arg function returning a promise.
 * @return {Promise<*>}
 * @throws {Error} `code: 'REPOSITORY_BUSY'` when something else holds the repository.
 */
async function runExclusive(instanceName, operation, task) {
  const active = inFlight.get(instanceName);
  if (active) {
    const err = new Error(
      `Repository "${instanceName}" is busy — ${active.operation} is already running.`
    );
    err.code = 'REPOSITORY_BUSY';
    err.busyWith = active.operation;
    throw err;
  }

  const entry = { operation };
  entry.promise = Promise.resolve()
    .then(task)
    .finally(() => inFlight.delete(instanceName));
  inFlight.set(instanceName, entry);
  return entry.promise;
}

/**
 * Synchronise one repository now, refusing a concurrent run for the same
 * instance.
 *
 * @param {Object} params
 * @param {Object} params.filer Core FilingService (provider 'git').
 * @param {string} params.instanceName Registry instance name.
 * @param {Array<'commit'|'fetch'>} params.actions From actionsFor(config).
 * @param {Object=} params.log Structured logger.
 * @param {string=} params.actor Email/username of the triggering user, for the log.
 * @return {Promise<Object>} Per-action outcome + refreshed git status.
 * @throws {Error} `code: 'REPOSITORY_BUSY'` when the repository is in use.
 */
async function syncRepository({ filer, instanceName, actions, log, actor }) {
  return runExclusive(instanceName, 'a synchronisation', () =>
    performSync({ filer, instanceName, actions, log, actor }));
}

/**
 * @param {string} instanceName
 * @return {boolean} true while any exclusive operation holds this repository.
 */
function isBusy(instanceName) {
  return inFlight.has(instanceName);
}

/**
 * @param {string} instanceName
 * @return {?string} Name of the operation holding the repository, or null.
 */
function busyWith(instanceName) {
  const active = inFlight.get(instanceName);
  return active ? active.operation : null;
}

module.exports = {
  actionsFor,
  syncRepository,
  isBusy,
  busyWith,
  // Shared with repositoryCompact.js — see runExclusive/pauseAutoSync above.
  runExclusive,
  pauseAutoSync,
  // Exported for tests.
  commitAndPush,
  fetchAndPull,
  gitHandleFor
};
