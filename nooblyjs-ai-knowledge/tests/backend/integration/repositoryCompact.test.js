/**
 * @fileoverview Shrinking a clone by dropping history.
 *
 * The contract under test:
 *   1. It really shrinks a real repository, and leaves it USABLE — the working
 *      tree intact and still able to commit and push. This is the claim the whole
 *      feature rests on, so it is tested against actual git rather than a stub.
 *   2. The REMOTE is never touched. That is the entire reason this was chosen
 *      over a squash-and-force-push, and it is what makes the operation safe to
 *      repeat and safe to run without coordinating with anyone.
 *   3. Unpushed or unfetched work is REFUSED, because `gc` around commits that
 *      exist nowhere else is the one way this can lose data.
 *   4. Uncommitted changes survive — these repositories almost always hold some,
 *      so refusing a dirty tree would make the feature unusable.
 *   5. It shares one exclusion lock with sync, since `gc` repacks the object
 *      store a commit would be writing into.
 *
 * Filed under integration/, not components/, because it spawns real git and
 * builds real repositories — that is the point (the safety claims are about what
 * git actually does, and a stub would only re-assert what this module already
 * says), but it costs ~2 minutes and does not belong in the fast unit loop.
 * Nothing here reaches the network: the "remote" is a local bare repository.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  startCompact,
  getCompactJob,
  performCompact,
  readObjectStore,
  isShallow,
  assertCompactable,
} = require('../../../src/shared/repositories/repositoryCompact');

const { isBusy, runExclusive } = require('../../../src/shared/repositories/repositorySync');

jest.setTimeout(60000);

/** Run git in `cwd`, returning stdout. */
function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let root;
let remote;
let work;

/**
 * A bare remote with `commits` commits, and a full clone of it. Each commit
 * rewrites the same large, poorly-compressible file — the shape that actually
 * bloats these repositories (a re-rendered base64 image), so the history has
 * real weight to reclaim.
 */
function buildRepo(commits = 6) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-'));
  remote = path.join(root, 'origin.git');
  work = path.join(root, 'work');

  git(root, 'init', '--bare', '-q', '-b', 'main', remote);
  git(root, 'clone', '-q', `file://${remote.replace(/\\/g, '/')}`, work);
  git(work, 'config', 'user.email', 'test@test');
  git(work, 'config', 'user.name', 'test');

  for (let i = 0; i < commits; i += 1) {
    // Random-ish payload per commit: like base64 image output, it does not delta.
    const payload = Array.from({ length: 800 }, (_, k) => `${i}-${(k * 7919 + i * 104729) % 1e9}`).join('');
    fs.writeFileSync(path.join(work, 'diagram.md'), payload);
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', `commit ${i}`);
  }
  git(work, 'push', '-q', 'origin', 'main');
}

/** A filer stand-in wrapping a real simple-git-compatible handle over `work`. */
function realFiler(dir = work, { autoCommit = true } = {}) {
  const timers = [];
  const handle = {
    async raw(args) { return git(dir, ...args); },
    async status() {
      const porcelain = git(dir, 'status', '--porcelain', '--branch');
      const ahead = /\[ahead (\d+)/.exec(porcelain);
      const behind = /behind (\d+)/.exec(porcelain);
      const files = porcelain.split('\n').filter((l) => l && !l.startsWith('##'));
      return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0, files };
    },
  };
  return {
    timers,
    provider: {
      git: handle,
      localPath: dir,
      branch: 'main',
      autoFetch: false,
      autoCommit,
      startAutoFetch() { timers.push('startAutoFetch'); },
      stopAutoFetch() { timers.push('stopAutoFetch'); },
      startAutoCommit() { timers.push('startAutoCommit'); },
      stopAutoCommit() { timers.push('stopAutoCommit'); },
    },
    async initialize() {},
  };
}

afterEach(() => {
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});

describe('performCompact — against a real repository', () => {
  test('shrinks the clone, keeps the working tree, and leaves it able to commit and push', async () => {
    buildRepo(3);
    const filer = realFiler();

    const before = await readObjectStore(filer.provider.git);
    expect(await isShallow(filer.provider.git)).toBe(false);

    const result = await performCompact({ filer, instanceName: 'repo-real', depth: 1 });

    expect(result.shallow).toBe(true);
    expect(result.commitsBefore).toBe(3);
    expect(result.commitsAfter).toBe(1);
    expect(result.reclaimedBytes).toBeGreaterThan(0);
    expect(result.after.totalBytes).toBeLessThan(before.totalBytes);

    // The documents are all still there — history went, content did not.
    expect(fs.existsSync(path.join(work, 'diagram.md'))).toBe(true);

    // And the clone still works for its actual job.
    fs.writeFileSync(path.join(work, 'diagram.md'), 'after compaction');
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'post-compact');
    expect(() => git(work, 'push', '-q', 'origin', 'main')).not.toThrow();
  });

  test('the REMOTE keeps its full history — nothing is rewritten', async () => {
    buildRepo(3);
    const remoteCommitsBefore = Number(git(remote, 'rev-list', '--count', 'main').trim());

    await performCompact({ filer: realFiler(), instanceName: 'repo-remote', depth: 1 });

    const remoteCommitsAfter = Number(git(remote, 'rev-list', '--count', 'main').trim());
    expect(remoteCommitsAfter).toBe(remoteCommitsBefore);
    expect(remoteCommitsAfter).toBe(3);
  });

  test('is reversible — the history comes back with fetch --unshallow', async () => {
    buildRepo(3);
    await performCompact({ filer: realFiler(), instanceName: 'repo-undo', depth: 1 });
    expect(Number(git(work, 'rev-list', '--count', 'HEAD').trim())).toBe(1);

    git(work, 'fetch', '-q', '--unshallow', 'origin', 'main');
    git(work, 'reset', '-q', '--hard', 'origin/main');
    expect(Number(git(work, 'rev-list', '--count', 'HEAD').trim())).toBe(3);
  });

  test('keeps `depth` commits when asked for more than one', async () => {
    buildRepo(5);
    const result = await performCompact({ filer: realFiler(), instanceName: 'repo-depth', depth: 3 });
    expect(result.commitsBefore).toBe(5);
    expect(result.commitsAfter).toBe(3);
  });

  test('UNCOMMITTED changes survive — these repositories always have some', async () => {
    buildRepo(3);
    fs.writeFileSync(path.join(work, 'unsaved.md'), 'work in progress');
    fs.writeFileSync(path.join(work, 'diagram.md'), 'edited but not committed');

    const result = await performCompact({ filer: realFiler(), instanceName: 'repo-dirty', depth: 1 });

    expect(result.dirtyFilesPreserved).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(work, 'unsaved.md'), 'utf8')).toBe('work in progress');
    expect(fs.readFileSync(path.join(work, 'diagram.md'), 'utf8')).toBe('edited but not committed');
  });

  test('pauses the auto timers and restores the configured ones', async () => {
    buildRepo(3);
    const filer = realFiler(work, { autoCommit: true });

    await performCompact({ filer, instanceName: 'repo-timers', depth: 1 });

    expect(filer.timers.slice(0, 2)).toEqual(['stopAutoFetch', 'stopAutoCommit']);
    expect(filer.timers).toContain('startAutoCommit');
    expect(filer.timers).not.toContain('startAutoFetch');
  });

  test('compacting an already-shallow clone is safe and reclaims nothing new', async () => {
    buildRepo(3);
    await performCompact({ filer: realFiler(), instanceName: 'repo-twice', depth: 1 });
    const second = await performCompact({ filer: realFiler(), instanceName: 'repo-twice', depth: 1 });

    expect(second.wasShallow).toBe(true);
    expect(second.shallow).toBe(true);
    expect(second.commitsAfter).toBe(1);
  });
});

describe('assertCompactable — what it refuses', () => {
  test('refuses a clone holding commits the remote does not have', async () => {
    buildRepo(3);
    fs.writeFileSync(path.join(work, 'diagram.md'), 'local only');
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'unpushed');

    await expect(assertCompactable(realFiler().provider.git, 'repo-ahead'))
      .rejects.toMatchObject({ code: 'COMPACT_AHEAD' });
  });

  test('refuses a clone that is behind the remote', async () => {
    buildRepo(3);
    // Advance the remote via a second clone, then make this one aware of it.
    const other = path.join(root, 'other');
    git(root, 'clone', '-q', `file://${remote.replace(/\\/g, '/')}`, other);
    git(other, 'config', 'user.email', 'o@o');
    git(other, 'config', 'user.name', 'o');
    fs.writeFileSync(path.join(other, 'diagram.md'), 'from elsewhere');
    git(other, 'add', '-A');
    git(other, 'commit', '-qm', 'remote moved');
    git(other, 'push', '-q', 'origin', 'main');
    git(work, 'fetch', '-q', 'origin', 'main');

    await expect(assertCompactable(realFiler().provider.git, 'repo-behind'))
      .rejects.toMatchObject({ code: 'COMPACT_BEHIND' });
  });

  test('a clone level with the remote is compactable, dirty or not', async () => {
    buildRepo(3);
    fs.writeFileSync(path.join(work, 'scratch.md'), 'dirty');
    await expect(assertCompactable(realFiler().provider.git, 'repo-ok'))
      .resolves.toMatchObject({ ahead: 0, behind: 0 });
  });
});

describe('startCompact — the async job', () => {
  test('returns a running job immediately and fills in the result when it finishes', async () => {
    buildRepo(3);
    const job = startCompact({ filer: realFiler(), instanceName: 'repo-job', depth: 1 });

    expect(job).toMatchObject({ instanceName: 'repo-job', running: true, depth: 1, result: null });
    expect(getCompactJob('repo-job')).toBe(job);

    while (job.running) await new Promise((r) => setTimeout(r, 25));

    expect(job.error).toBeNull();
    expect(job.result.commitsAfter).toBe(1);
    expect(job.finishedAt).toBeTruthy();
  });

  test('a failure is recorded on the job rather than thrown into the void', async () => {
    buildRepo(3);
    fs.writeFileSync(path.join(work, 'diagram.md'), 'local only');
    git(work, 'add', '-A');
    git(work, 'commit', '-qm', 'unpushed');

    const job = startCompact({ filer: realFiler(), instanceName: 'repo-job-fail', depth: 1 });
    while (job.running) await new Promise((r) => setTimeout(r, 25));

    expect(job.errorCode).toBe('COMPACT_AHEAD');
    expect(job.error).toMatch(/not on the remote/);
    expect(job.result).toBeNull();
  });

  /* gc repacks the object store a commit would be writing into, so the two
     operations must contend for ONE lock, not one each. */
  test('refuses to start while a SYNC holds the repository', async () => {
    buildRepo(2);
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const held = runExclusive('repo-contended', 'a synchronisation', () => blocked);

    expect(isBusy('repo-contended')).toBe(true);
    expect(() => startCompact({ filer: realFiler(), instanceName: 'repo-contended', depth: 1 }))
      .toThrow(/busy/i);

    release();
    await held;
  });

  test('a refused start leaves the PREVIOUS run\'s report intact', async () => {
    buildRepo(3);
    const first = startCompact({ filer: realFiler(), instanceName: 'repo-report', depth: 1 });
    while (first.running) await new Promise((r) => setTimeout(r, 25));

    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    const held = runExclusive('repo-report', 'a synchronisation', () => blocked);

    expect(() => startCompact({ filer: realFiler(), instanceName: 'repo-report', depth: 1 })).toThrow();
    expect(getCompactJob('repo-report')).toBe(first);
    expect(getCompactJob('repo-report').result).toBeTruthy();

    release();
    await held;
  });
});
