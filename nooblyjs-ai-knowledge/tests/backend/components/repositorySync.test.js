/**
 * @fileoverview On-demand repository synchronisation — the sync button behind the
 * Repository analytics screen.
 *
 * The contract under test:
 *   1. What runs is decided by the repository's OWN config: commit only, fetch
 *      only, both (commit FIRST), or nothing at all. A fetch-only mirror must
 *      never be pushed to from the UI.
 *   2. Failures PROPAGATE. This is the whole reason the module exists rather than
 *      delegating to core's `provider.autoCommitAndPush()`, whose catch block
 *      swallows every error so a timer cannot crash the app — behind a button
 *      that turns a rejected push into a reported success.
 *   3. A clean tree that is AHEAD still pushes. The timer returns early on a
 *      clean tree, so a commit whose push failed once stays unpushed.
 *   4. One sync per repository at a time — two interleaved `add -A` + commit
 *      sequences in one working tree produce commits nobody asked for.
 *
 * (2) is the load-bearing one: silent success is indistinguishable from working,
 * which is exactly how "sync is on" outages go unnoticed.
 */

'use strict';

const {
  actionsFor,
  syncRepository,
  isBusy,
  commitAndPush,
  gitHandleFor,
} = require('../../../src/shared/repositories/repositorySync');

/**
 * A stand-in for simple-git that records the commands it was given.
 * `staged` is what `diff --cached --name-only` answers; `status` seeds ahead/behind.
 */
function fakeGit({ staged = [], ahead = 0, behind = 0, head = 'a'.repeat(40), commitFails = false } = {}) {
  const calls = [];
  return {
    calls,
    async add(args) { calls.push(['add', ...args]); },
    async diff(args) { calls.push(['diff', ...args]); return staged.join('\n'); },
    async status() { calls.push(['status']); return { ahead, behind, files: [], staged, created: [], deleted: [], modified: [] }; },
    async commit(message) {
      calls.push(['commit', message]);
      if (commitFails) throw new Error('nothing to commit, working tree clean');
    },
    async revparse() { calls.push(['revparse']); return head; },
  };
}

/**
 * A stand-in for the core FilingService wrapper over a GitFilingProvider.
 */
function fakeFiler(git, {
  pushFails = false,
  fetchFails = false,
  commitMessage = 'Auto-sync: Test',
  autoFetch = false,
  autoCommit = false,
} = {}) {
  const calls = [];
  const timers = [];
  return {
    calls,
    timers,
    provider: {
      git,
      commitMessage,
      localPath: '/tmp/fake-repo',
      autoFetch,
      autoCommit,
      startAutoFetch() { timers.push('startAutoFetch'); },
      stopAutoFetch() { timers.push('stopAutoFetch'); },
      startAutoCommit() { timers.push('startAutoCommit'); },
      stopAutoCommit() { timers.push('stopAutoCommit'); },
    },
    async initialize() { calls.push('initialize'); },
    async push() {
      calls.push('push');
      if (pushFails) throw new Error('Failed to push: remote rejected (authentication failed)');
    },
    async fetch() {
      calls.push('fetch');
      if (fetchFails) throw new Error('could not read Username for https://bitbucket.org');
    },
    async getGitStatus() {
      return { branch: 'main', git: { ahead: 0, behind: 0, files: [] }, pendingCommits: 0 };
    },
  };
}

const cfg = (fetch, commit) => ({ synchronization: { enabled: true, interval: 3600, fetch, commit } });

describe('actionsFor — the configured directions decide what a sync does', () => {
  test('commit runs BEFORE fetch, so a pull can never reset --hard over uncommitted work', () => {
    expect(actionsFor(cfg(true, true))).toEqual(['commit', 'fetch']);
  });

  test('a fetch-only repository yields no commit action — the UI cannot push to a mirror', () => {
    expect(actionsFor(cfg(true, false))).toEqual(['fetch']);
  });

  test('a commit-only repository yields no fetch action', () => {
    expect(actionsFor(cfg(false, true))).toEqual(['commit']);
  });

  test('a repository that syncs in neither direction yields nothing to press', () => {
    expect(actionsFor(cfg(false, false))).toEqual([]);
    expect(actionsFor({})).toEqual([]);
    expect(actionsFor(null)).toEqual([]);
  });

  test('only a literal true enables a direction — a truthy string is not configuration', () => {
    expect(actionsFor({ synchronization: { fetch: 'yes', commit: 1 } })).toEqual([]);
  });
});

describe('commitAndPush', () => {
  test('stages everything, commits the configured message and pushes', async () => {
    const git = fakeGit({ staged: ['a.md', 'b/c.pdf'] });
    const filer = fakeFiler(git);

    const result = await commitAndPush(filer, git);

    expect(git.calls[0]).toEqual(['add', '-A']);
    expect(filer.calls).toContain('push');
    expect(result).toMatchObject({ committed: true, pushed: true, files: 2 });
    expect(result.message).toMatch(/^Auto-sync: Test \[.+\]$/);
  });

  test('a clean tree that is AHEAD still pushes — the timer would stop here', async () => {
    const git = fakeGit({ staged: [], ahead: 3 });
    const filer = fakeFiler(git);

    const result = await commitAndPush(filer, git);

    expect(result).toEqual({ committed: false, pushed: true, files: 0, ahead: 3, message: null });
    expect(filer.calls).toContain('push');
    expect(git.calls.some((c) => c[0] === 'commit')).toBe(false);
  });

  test('a clean tree in step with the remote neither commits nor pushes', async () => {
    const git = fakeGit({ staged: [], ahead: 0 });
    const filer = fakeFiler(git);

    const result = await commitAndPush(filer, git);

    expect(result).toEqual({ committed: false, pushed: false, files: 0, ahead: 0, message: null });
    expect(filer.calls).not.toContain('push');
  });

  test('a rejected push REJECTS — core swallows this, which is why this module exists', async () => {
    const git = fakeGit({ staged: ['a.md'] });
    const filer = fakeFiler(git, { pushFails: true });

    await expect(commitAndPush(filer, git)).rejects.toThrow(/authentication failed/);
  });
});

describe('syncRepository', () => {
  test('runs commit then fetch for a repository configured for both', async () => {
    const git = fakeGit({ staged: ['a.md'] });
    const filer = fakeFiler(git);

    const result = await syncRepository({
      filer, instanceName: 'repo-both', actions: actionsFor(cfg(true, true)),
    });

    expect(result.actions).toEqual(['commit', 'fetch']);
    expect(result.commit).toMatchObject({ committed: true, files: 1 });
    expect(result.fetch).toMatchObject({ pulled: false });
    expect(filer.calls.indexOf('push')).toBeLessThan(filer.calls.indexOf('fetch'));
  });

  test('a HEAD that moved across fetch() reports a real pull — fetch() itself resolves void', async () => {
    let head = 'a'.repeat(40);
    const git = fakeGit();
    git.revparse = async () => head;
    const filer = fakeFiler(git);
    filer.fetch = async () => { head = 'b'.repeat(40); };

    const result = await syncRepository({ filer, instanceName: 'repo-fetch', actions: ['fetch'] });

    expect(result.fetch.pulled).toBe(true);
    expect(result.fetch.head).toBe('b'.repeat(8));
  });

  test('a failed action carries the partial result, so a local commit is not lost behind the push error', async () => {
    const git = fakeGit({ staged: ['a.md', 'b.md'] });
    const filer = fakeFiler(git, { pushFails: true });

    await expect(
      syncRepository({ filer, instanceName: 'repo-partial', actions: ['commit', 'fetch'] })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/authentication failed/),
      partial: expect.objectContaining({ instanceName: 'repo-partial', commit: null, fetch: null }),
    });

    // The commit landed locally even though the push did not; the follow-up fetch
    // was NOT attempted, because pulling over a failed push is how work is lost.
    expect(git.calls.some((c) => c[0] === 'commit')).toBe(true);
    expect(filer.calls).not.toContain('fetch');
  });

  test('a second sync for the same repository is refused, not queued', async () => {
    // The gate is built BEFORE the sync starts: `release` must exist by the time
    // the assertions run, and how many microtasks precede push() is not ours to
    // predict.
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const git = fakeGit({ staged: ['a.md'] });
    const filer = fakeFiler(git);
    filer.push = () => blocked;

    const first = syncRepository({ filer, instanceName: 'repo-busy', actions: ['commit'] });
    expect(isBusy('repo-busy')).toBe(true);

    await expect(
      syncRepository({ filer, instanceName: 'repo-busy', actions: ['commit'] })
    ).rejects.toMatchObject({ code: 'REPOSITORY_BUSY' });

    release();
    await first;
    expect(isBusy('repo-busy')).toBe(false);
  });

  test('a different repository is not blocked by a busy one', async () => {
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const busyGit = fakeGit({ staged: ['a.md'] });
    const busy = fakeFiler(busyGit);
    busy.push = () => blocked;

    const first = syncRepository({ filer: busy, instanceName: 'repo-a', actions: ['commit'] });
    const other = await syncRepository({
      filer: fakeFiler(fakeGit()), instanceName: 'repo-b', actions: ['fetch'],
    });

    expect(other.fetch).toBeTruthy();
    release();
    await first;
  });

  /* The auto timers hold the same .git/index.lock a manual sync needs, and git
     refuses rather than queues — "Unable to create '…/index.lock': File exists".
     Stopping them for the duration is what keeps a click off its own timer. */
  test('stops the auto timers for the duration and restores the configured ones', async () => {
    const filer = fakeFiler(fakeGit({ staged: ['a.md'] }), { autoCommit: true, autoFetch: false });

    await syncRepository({ filer, instanceName: 'repo-timers', actions: ['commit'] });

    expect(filer.timers.slice(0, 2)).toEqual(['stopAutoFetch', 'stopAutoCommit']);
    // Only the timer this repository is configured for comes back.
    expect(filer.timers).toContain('startAutoCommit');
    expect(filer.timers).not.toContain('startAutoFetch');
  });

  test('restores the auto timers even when the sync FAILS — a bad push must not leave them off', async () => {
    const filer = fakeFiler(fakeGit({ staged: ['a.md'] }), {
      pushFails: true, autoCommit: true, autoFetch: true,
    });

    await expect(
      syncRepository({ filer, instanceName: 'repo-timers-fail', actions: ['commit'] })
    ).rejects.toThrow();

    expect(filer.timers).toContain('startAutoFetch');
    expect(filer.timers).toContain('startAutoCommit');
  });

  test('the in-flight slot is released after a FAILED sync, so the button is not wedged', async () => {
    const git = fakeGit({ staged: ['a.md'] });
    const filer = fakeFiler(git, { pushFails: true });

    await expect(
      syncRepository({ filer, instanceName: 'repo-fail', actions: ['commit'] })
    ).rejects.toThrow();
    expect(isBusy('repo-fail')).toBe(false);
  });
});

describe('gitHandleFor', () => {
  test('initialises a provider whose clone has not run yet', async () => {
    const git = fakeGit();
    const filer = fakeFiler(null);
    filer.initialize = async () => { filer.provider.git = git; filer.calls.push('initialize'); };

    await expect(gitHandleFor(filer, 'repo-late')).resolves.toBe(git);
    expect(filer.calls).toContain('initialize');
  });

  test('says the clone was skipped rather than failing later with a bare git error', async () => {
    const filer = fakeFiler(null);
    await expect(gitHandleFor(filer, 'repo-nogit')).rejects.toThrow(/not cloned yet/);
  });

  test('a filer with no provider at all is reported as such', async () => {
    await expect(gitHandleFor({}, 'repo-broken')).rejects.toThrow(/no filing provider/);
  });
});
