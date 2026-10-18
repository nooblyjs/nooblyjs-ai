/**
 * @fileoverview Reset a repository to its remote — the destructive button on the
 * Repository analytics screen.
 *
 * The contract under test:
 *   1. The three commands, in order, against the CONFIGURED branch:
 *      `fetch origin <branch>` → `reset --hard origin/<branch>` → `clean -fd`.
 *      `main` is a default, not an assumption — a repository on `master` that
 *      silently reset to `origin/main` would either fail loudly or, far worse,
 *      succeed against the wrong branch.
 *   2. `clean` runs WITHOUT `-x`. Ignored files on these hosts are local
 *      infrastructure (a `.env`, editor state, node_modules under a content root),
 *      not stale content, and losing them is not part of what anyone clicked.
 *   3. NOTHING DESTRUCTIVE RUNS UNTIL THE TARGET IS PROVEN. If `origin/<branch>`
 *      is not there after the fetch, the reset must abort before `reset --hard`,
 *      not discard the working tree and then discover it has nowhere to land.
 *   4. It reports what it destroyed. A reset that only says "done" is
 *      indistinguishable from one that quietly ate an auto-commit backlog that had
 *      been failing to push for days — and the log line it writes first is often
 *      the only surviving record of those commits.
 *   5. It holds the SAME exclusion lock as sync and compaction, and restores the
 *      auto-sync timers even when git fails.
 *
 * (3) is the one worth being pedantic about: every other failure here costs a
 * confusing error message, that one costs the working tree.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  resetRepository,
  performReset,
  parseCleanOutput,
  assertRemoteBranch,
  findCaseCollisions,
} = require('../../../src/shared/repositories/repositoryReset');
const { isBusy, syncRepository } = require('../../../src/shared/repositories/repositorySync');

/**
 * A stand-in for simple-git that records every command and flips its answers once
 * the reset has run, so before/after state is distinguishable.
 */
function fakeGit({
  branch = 'main',
  ahead = 0,
  behind = 0,
  dirty = [],
  headBefore = 'a'.repeat(40),
  headAfter = 'b'.repeat(40),
  remoteBranchMissing = false,
  cleanOutput = '',
  logOutput = '',
  failOn = null,
  // Paths `ls-files -z` answers with, and whether the tree stays dirty after the
  // reset — the case-collision shape observed live on Windows.
  trackedFiles = [],
  dirtyAfterReset = null,
} = {}) {
  const state = { didReset: false };
  const calls = [];
  const raws = [];

  const git = {
    calls,
    raws,
    state,
    async status() {
      calls.push(['status']);
      const after = dirtyAfterReset === null ? [] : dirtyAfterReset;
      return state.didReset
        ? { current: branch, ahead: 0, behind: 0, files: after.map((p) => ({ path: p })) }
        : { current: branch, ahead, behind, files: dirty.map((p) => ({ path: p })) };
    },
    async revparse(args) {
      calls.push(['revparse', ...args]);
      return state.didReset ? headAfter : headBefore;
    },
    async raw(args) {
      calls.push(['raw', ...args]);
      raws.push(args.join(' '));
      const command = args[0];
      if (failOn && args.join(' ').includes(failOn)) {
        throw new Error(`fatal: simulated failure running git ${args.join(' ')}`);
      }
      if (command === 'fetch') return '';
      if (command === 'rev-parse') {
        if (remoteBranchMissing) {
          throw new Error(`fatal: Needed a single revision\n${args[2]}`);
        }
        return `${'c'.repeat(40)}\n`;
      }
      if (command === 'rev-list') return `${ahead}\n`;
      if (command === 'log') return logOutput;
      if (command === 'ls-files') return trackedFiles.join('\0');
      if (command === 'reset') { state.didReset = true; return ''; }
      if (command === 'clean') return cleanOutput;
      return '';
    },
  };
  return git;
}

/** A stand-in for the core FilingService wrapper over a GitFilingProvider. */
function fakeFiler(git, { branch = 'main', autoFetch = false, autoCommit = false } = {}) {
  const timers = [];
  return {
    timers,
    provider: {
      git,
      branch,
      localPath: '/tmp/fake-repo',
      autoFetch,
      autoCommit,
      startAutoFetch() { timers.push('startAutoFetch'); },
      stopAutoFetch() { timers.push('stopAutoFetch'); },
      startAutoCommit() { timers.push('startAutoCommit'); },
      stopAutoCommit() { timers.push('stopAutoCommit'); },
    },
    async initialize() {},
    async push() {},
    async fetch() {},
    async getGitStatus() {
      return { branch, git: { ahead: 0, behind: 0, files: [] }, pendingCommits: 0 };
    },
  };
}

describe('performReset — the commands, in order', () => {
  test('fetches, hard-resets to the remote branch, then cleans', async () => {
    const git = fakeGit();
    const filer = fakeFiler(git);

    await performReset({ filer, instanceName: 'repo-order' });

    const destructive = git.raws.filter((c) => /^(fetch|reset|clean)/.test(c));
    expect(destructive).toEqual([
      'fetch origin main',
      'reset --hard origin/main',
      'clean -fd',
    ]);
  });

  test('targets the CONFIGURED branch, not a hardcoded main', async () => {
    const git = fakeGit({ branch: 'develop' });
    const filer = fakeFiler(git, { branch: 'develop' });

    const result = await performReset({ filer, instanceName: 'repo-develop' });

    expect(git.raws).toContain('fetch origin develop');
    expect(git.raws).toContain('reset --hard origin/develop');
    expect(result.target).toBe('origin/develop');
  });

  test('cleans WITHOUT -x, so ignored files (.env, node_modules) survive', async () => {
    const git = fakeGit();
    await performReset({ filer: fakeFiler(git), instanceName: 'repo-clean' });

    const clean = git.calls.find((c) => c[0] === 'raw' && c[1] === 'clean');
    expect(clean.slice(1)).toEqual(['clean', '-fd']);
    expect(git.raws.some((c) => c.includes('-x'))).toBe(false);
  });

  test('never pushes, force-pushes or rewrites — the remote is not touched', async () => {
    const git = fakeGit();
    const filer = fakeFiler(git);
    filer.push = () => { throw new Error('reset must not push'); };

    await performReset({ filer, instanceName: 'repo-no-push' });

    expect(git.raws.some((c) => /\bpush\b|--force|filter-branch/.test(c))).toBe(false);
  });
});

describe('performReset — refusing to destroy anything it cannot land', () => {
  test('a missing remote branch aborts BEFORE reset --hard runs', async () => {
    const git = fakeGit({ remoteBranchMissing: true });

    await expect(performReset({ filer: fakeFiler(git), instanceName: 'repo-nobranch' }))
      .rejects.toMatchObject({ code: 'RESET_NO_REMOTE_BRANCH' });

    // The whole point: the working tree is untouched, so the fix is a config edit
    // rather than a re-clone.
    expect(git.raws.some((c) => c.startsWith('reset'))).toBe(false);
    expect(git.raws.some((c) => c.startsWith('clean'))).toBe(false);
    expect(git.state.didReset).toBe(false);
  });

  test('the message names the likely cause rather than echoing git', async () => {
    const git = fakeGit({ remoteBranchMissing: true });
    await expect(assertRemoteBranch(git, 'origin/main', 'repo-x'))
      .rejects.toThrow(/repositories\.json/);
  });

  test('a failed reset still propagates — this is a button, not a timer', async () => {
    const git = fakeGit({ failOn: 'reset --hard' });
    await expect(performReset({ filer: fakeFiler(git), instanceName: 'repo-resetfail' }))
      .rejects.toThrow(/simulated failure/);
  });
});

describe('performReset — reporting what was destroyed', () => {
  test('counts the local commits, changed files and removed entries', async () => {
    const git = fakeGit({
      ahead: 3,
      dirty: ['a.md', 'b/c.md'],
      logOutput: '1111111 Auto-sync: Engineering [2026-08-19]\n2222222 Auto-sync: Engineering [2026-08-18]',
      cleanOutput: 'Removing stray.md\nRemoving tmp/\nRemoving .system/derived/x.pdf.md\n',
    });

    const result = await performReset({ filer: fakeFiler(git), instanceName: 'repo-report' });

    expect(result.discardedCommitCount).toBe(3);
    expect(result.discardedCommits[0]).toEqual({
      hash: '1111111', subject: 'Auto-sync: Engineering [2026-08-19]',
    });
    expect(result.discardedFiles).toBe(2);
    expect(result.removedCount).toBe(3);
    expect(result.removedPaths).toContain('tmp/');
    expect(result.moved).toBe(true);
  });

  test('LOGS the discarded commit subjects before dropping them', async () => {
    // reset --hard leaves them in the reflog until something expires it — and
    // repositoryCompact expires it deliberately — so this line is frequently the
    // only durable record of what was thrown away.
    const warn = jest.fn();
    const git = fakeGit({ ahead: 1, logOutput: '9999999 Auto-sync: unpushed for six days' });

    await performReset({
      filer: fakeFiler(git), instanceName: 'repo-log', log: { warn, info: jest.fn() }, actor: 'admin@x',
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unpushed for six days'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('admin@x'));
  });

  test('a clone already level with the remote reports nothing discarded', async () => {
    const head = 'd'.repeat(40);
    const git = fakeGit({ headBefore: head, headAfter: head });

    const result = await performReset({ filer: fakeFiler(git), instanceName: 'repo-level' });

    expect(result).toMatchObject({
      moved: false, discardedCommitCount: 0, discardedFiles: 0, removedCount: 0,
    });
  });

  test('a drifted checkout is REPORTED, not silently reset onto the wrong ref', async () => {
    // reset --hard moves whatever ref is checked out. The content becomes correct
    // while the checkout stays wrong, so the auto-commit timer would go on
    // committing where it cannot push — that has to be visible.
    const git = fakeGit({ branch: 'hotfix' });
    const filer = fakeFiler(git, { branch: 'main' });

    const result = await performReset({ filer, instanceName: 'repo-drift' });

    expect(result.branchMismatch).toBe(true);
    expect(result.checkedOutBranch).toBe('hotfix');
    expect(result.target).toBe('origin/main');
  });
});

/**
 * The live report that produced this suite's most important behaviour: a reset
 * that logged "now at origin/main … 22 change(s)" while all 22 files stayed
 * modified in both the UI and VS Code. The reset was correct — HEAD matched
 * origin/main and git itself had written every file — but the repository holds 23
 * tracked path pairs differing only in case, which Windows cannot represent. git
 * writes both blobs to one path, the last wins, and the loser reads as modified
 * after every reset. Without this diagnosis the operation looks broken forever.
 */
describe('a tree that is still dirty after the reset', () => {
  const PAIR_A = 'FinTech/Features/Monitor Store Performance.md';
  const PAIR_B = 'FinTech/Features/Monitor store performance.md';

  const collidingGit = (extra = {}) => fakeGit({
    dirty: [PAIR_A],
    dirtyAfterReset: [PAIR_A],
    trackedFiles: [PAIR_A, PAIR_B, 'FinTech/Features/Unrelated.md'],
    ...extra,
  });

  test('names the colliding paths instead of reporting a clean success', async () => {
    const result = await performReset({ filer: fakeFiler(collidingGit()), instanceName: 'repo-case' });

    expect(result.residualDirty).toBe(1);
    expect(result.caseCollisions).toMatchObject({ total: 1, stuck: 1 });
    expect(result.caseCollisions.groups[0].sort()).toEqual([PAIR_B, PAIR_A].sort());
  });

  test('warns in the log, since this is not repairable from the UI', async () => {
    const warn = jest.fn();
    await performReset({
      filer: fakeFiler(collidingGit()), instanceName: 'repo-case-log', log: { warn, info: jest.fn() },
    });

    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/only in CASE/));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Monitor store performance.md'));
  });

  test('does not look for collisions when the reset left a clean tree', async () => {
    const git = fakeGit({ dirty: ['a.md'], trackedFiles: ['a.md'] });
    const result = await performReset({ filer: fakeFiler(git), instanceName: 'repo-clean-after' });

    expect(result.residualDirty).toBe(0);
    expect(result.caseCollisions).toBeNull();
    // `ls-files` on a large content root is not free — it must stay off the
    // ordinary path.
    expect(git.raws.some((c) => c.startsWith('ls-files'))).toBe(false);
  });

  test('a dirty tree with no collisions reports the residue without a false cause', async () => {
    // Something else is writing to the clone — a workflow, a sync daemon. Wrong
    // to blame case collisions for that.
    const git = fakeGit({ dirty: ['a.md'], dirtyAfterReset: ['a.md'], trackedFiles: ['a.md', 'b.md'] });
    const result = await performReset({ filer: fakeFiler(git), instanceName: 'repo-rewritten' });

    expect(result.residualDirty).toBe(1);
    expect(result.caseCollisions).toBeNull();
  });

  test('the raw dirty path list never reaches the caller', async () => {
    // A large content root's dirty list is thousands of paths; it is diagnosis
    // input, not an HTTP payload.
    const result = await performReset({ filer: fakeFiler(collidingGit()), instanceName: 'repo-paths' });
    expect(result.before.paths).toBeUndefined();
    expect(result.after.paths).toBeUndefined();
  });
});

describe('findCaseCollisions', () => {
  test('groups tracked paths that differ only in case', async () => {
    const git = fakeGit({ trackedFiles: ['A/b.md', 'a/B.md', 'A/c.md'] });
    const groups = await findCaseCollisions(git);

    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual(['A/b.md', 'a/B.md'].sort());
  });

  test('reads NUL-separated output — these names carry spaces and brackets', async () => {
    const git = fakeGit({
      trackedFiles: ['[RM Data] In-Store Sales.md', '[RM Data] In-store Sales.md'],
    });
    await findCaseCollisions(git);

    expect(git.raws).toContain('ls-files -z');
  });

  test('a repository with no collisions yields nothing', async () => {
    const git = fakeGit({ trackedFiles: ['a.md', 'b.md', 'c/d.md'] });
    await expect(findCaseCollisions(git)).resolves.toEqual([]);
  });
});

describe('parseCleanOutput', () => {
  test('reads the paths git reported removing', () => {
    expect(parseCleanOutput('Removing a.md\nRemoving b/\n')).toEqual(['a.md', 'b/']);
  });

  test('ignores anything that is not a Removing line', () => {
    expect(parseCleanOutput('Would remove c.md\n\nSkipping repository d/\n')).toEqual([]);
  });

  test('survives an empty or absent output', () => {
    expect(parseCleanOutput('')).toEqual([]);
    expect(parseCleanOutput(undefined)).toEqual([]);
  });
});

describe('resetRepository — exclusion and timers', () => {
  test('restores the configured auto timers after a successful reset', async () => {
    const filer = fakeFiler(fakeGit(), { autoCommit: true, autoFetch: false });

    await resetRepository({ filer, instanceName: 'repo-timers-ok' });

    expect(filer.timers.slice(0, 2)).toEqual(['stopAutoFetch', 'stopAutoCommit']);
    expect(filer.timers).toContain('startAutoCommit');
    expect(filer.timers).not.toContain('startAutoFetch');
  });

  test('restores them even when git FAILS — a bad reset must not leave sync off', async () => {
    const filer = fakeFiler(fakeGit({ failOn: 'clean' }), { autoCommit: true, autoFetch: true });

    await expect(resetRepository({ filer, instanceName: 'repo-timers-fail' })).rejects.toThrow();

    expect(filer.timers).toContain('startAutoFetch');
    expect(filer.timers).toContain('startAutoCommit');
    expect(isBusy('repo-timers-fail')).toBe(false);
  });

  test('is refused while the SAME repository is syncing — one lock covers all three', async () => {
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const filer = fakeFiler(fakeGit());
    filer.fetch = () => blocked;
    // A sync holds the exclusion; a reset must not interleave with it.
    const sync = syncRepository({ filer, instanceName: 'repo-shared-lock', actions: ['fetch'] });

    await expect(resetRepository({ filer, instanceName: 'repo-shared-lock' }))
      .rejects.toMatchObject({ code: 'REPOSITORY_BUSY' });

    release();
    await sync;
    expect(isBusy('repo-shared-lock')).toBe(false);
  });

  test('a different repository is not blocked by a busy one', async () => {
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const busy = fakeFiler(fakeGit());
    busy.fetch = () => blocked;
    const first = syncRepository({ filer: busy, instanceName: 'repo-busy-a', actions: ['fetch'] });

    await expect(resetRepository({ filer: fakeFiler(fakeGit()), instanceName: 'repo-free-b' }))
      .resolves.toMatchObject({ instanceName: 'repo-free-b' });

    release();
    await first;
  });
});

/**
 * Route + screen contract, asserted at source level (this project's jest has no
 * jsdom). Reset is one mistyped path segment from sync and compact, neither of
 * which loses data, so the guards on it are worth pinning: rename a field on
 * either side and the button keeps rendering, simply never guarded again.
 */
describe('Reset — route and screen contract', () => {
  const REPO = path.resolve(__dirname, '../../..');
  const routes = fs.readFileSync(
    path.join(REPO, 'src/datasources/routes/repositoriesRoutes.js'), 'utf8');
  const screen = fs.readFileSync(
    path.join(REPO, 'src/web/datasources/public/js/screens/repository.js'), 'utf8');
  const css = fs.readFileSync(
    path.join(REPO, 'src/web/datasources/public/css/datasources.css'), 'utf8');

  it('registers POST …/reset', () => {
    expect(routes).toMatch(/app\.post\(\s*'\/api\/repositories\/:instanceName\/reset'/);
  });

  it('requires an explicit confirm flag, so the endpoint cannot be hit by accident', () => {
    expect(routes).toMatch(/req\.body\?\.confirm !== true/);
    expect(screen).toMatch(/\/reset`,\s*\{ confirm: true \}/);
  });

  it('is admin-gated, like sync and compact', () => {
    const handler = routes.slice(routes.indexOf("'/api/repositories/:instanceName/reset'"));
    expect(handler.slice(0, 900)).toMatch(/isGlobalAdmin/);
  });

  it('serves canReset, and the screen gates the button on it', () => {
    expect(routes).toMatch(/canReset:/);
    expect(screen).toMatch(/d\.canReset/);
  });

  it('confirms in the browser before posting', () => {
    expect(screen).toMatch(/if \(!resetConfirmed\(loaded, params\.name\)\) return;/);
  });

  it('only quotes counts that belong to THIS repository in the confirm prompt', () => {
    // `local.analytics` is module-level and outlives a navigation.
    expect(screen).toMatch(/local\.analytics\.instanceName === instance/);
  });

  it('paints the reset button once analytics arrive — it renders disabled', () => {
    expect(screen).toMatch(/data-action="reset" disabled/);
    expect(screen).toMatch(/paintResetButton\(root, d\)/);
  });

  it('the analytics route detects case collisions, and only for a dirty tree', () => {
    expect(routes).toMatch(/findCaseCollisions/);
    expect(routes).toMatch(/if \(dirty\.length\)/);
  });

  it('the screen explains a tree that can never be clean', () => {
    expect(screen).toMatch(/d\.caseCollisions/);
    expect(screen).toMatch(/collisionBanner/);
    // Placed with the other diagnostic banners, above the git-status error it
    // explains.
    const body = screen.slice(screen.indexOf('${header}'));
    expect(body.indexOf('${collisionBanner}')).toBeGreaterThan(-1);
    expect(body.indexOf('${collisionBanner}')).toBeLessThan(body.indexOf('${errorBanner}'));
  });

  it('never claims to have reverted files that are still modified', () => {
    expect(screen).toMatch(/r\.discardedFiles \|\| 0\) - \(r\.residualDirty \|\| 0\)/);
  });

  it('uses a button class the stylesheet actually defines', () => {
    // The app does not load Bootstrap's CSS (see CLAUDE.md), so an invented
    // utility class is inert — the destructive button would render as an ordinary
    // one.
    expect(screen).toMatch(/class="btn btn-danger btn-sm" data-action="reset"/);
    expect(css).toMatch(/\.btn-danger\b/);
  });
});
