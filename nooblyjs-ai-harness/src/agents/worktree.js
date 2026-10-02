// Phase 29: a git WORKTREE per subagent, so several can edit at the same time.
//
// Two agents editing the same folder overwrite each other (and each other's
// "read before write" checks go stale). A git worktree is a second working
// folder of the same repository, on its own branch:
//
//   git worktree add -b noobly/fix-logging-3f9a ~/.noobly/projects/<slug>/worktrees/fix-logging-3f9a HEAD
//
// The subagent works there. When it's done, noobly commits what it changed to
// that branch and removes the folder; the BRANCH stays for you to look at and
// merge (/merge). If it changed nothing, branch and folder both go.
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { projectDir } from '../session-store/transcript.js';

const run = promisify(execFile);
const git = async (args, cwd) => (await run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout.trim();

// `git worktree add/remove` change shared files in .git: one at a time.
let queue = Promise.resolve();
const serially = (fn) => (queue = queue.then(fn, fn));

/**
 * Create a worktree + branch from HEAD.
 * @returns {Promise<{ dir: string, cwd: string, branch: string, base: string, root: string }>}  `cwd`: the same subfolder as the parent's, inside the worktree
 */
export async function createWorktree(cwd, name) {
  let root;
  try {
    root = await git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    throw new Error('isolation "worktree" needs a git repository, and this project is not one.');
  }
  let base;
  try {
    base = await git(['rev-parse', '--verify', 'HEAD'], root);
  } catch {
    throw new Error('isolation "worktree" needs at least one commit (a worktree starts from HEAD).');
  }
  const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'task'}-${crypto.randomBytes(3).toString('hex')}`;
  const branch = `noobly/${id}`;
  const dir = path.join(projectDir(root), 'worktrees', id);
  await serially(() => git(['worktree', 'add', '-q', '-b', branch, dir, base], root));
  return { dir, cwd: path.join(dir, path.relative(root, cwd)), branch, base, root };
}

/**
 * Commit what the subagent changed to its branch, and remove the folder.
 * @returns {Promise<{ changed: boolean, branch: string, commits: number, stat: string }>}
 */
export async function finishWorktree(worktree, message) {
  const { dir, branch, base, root } = worktree;
  if (await git(['status', '--porcelain'], dir)) {
    await git(['add', '-A'], dir);
    // Use the user's git identity if there is one; otherwise sign as noobly (never change their config).
    const identity = (await git(['config', 'user.email'], dir).catch(() => '')) ? [] : ['-c', 'user.name=noobly', '-c', 'user.email=noobly@localhost'];
    await git([...identity, 'commit', '-q', '--no-verify', '-m', message], dir);
  }
  const commits = Number(await git(['rev-list', '--count', `${base}..${branch}`], root));
  const stat = commits ? await git(['diff', '--stat', base, branch], root) : '';
  await serially(async () => {
    await git(['worktree', 'remove', '--force', dir], root);
    if (!commits) await git(['branch', '-D', branch], root);
  });
  return { changed: commits > 0, branch, commits, stat };
}
