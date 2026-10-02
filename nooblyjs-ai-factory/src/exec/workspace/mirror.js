// @ts-check
// Phase F02: a MIRROR of each repository the factory works on.
//
//   ~/.factory/repos/<slug>.git      a bare repository (no checked-out files)
//     refs/remotes/origin/*          what the real repo has, updated by `git fetch`
//     refs/heads/factory/*           the factory's own branches, one per workspace
//
// Why not work in the operator's own checkout (or clone it every time)?
//   - their checkout has uncommitted work, a branch they're on, their hooks. Not ours to touch.
//   - a fresh clone per run is slow for big repos.
//   - a mirror is fetched once per run (cheap) and every workspace is a worktree of it.
//
// Every run starts from a PINNED commit (a sha), not a branch name: if main moves
// while an agent works, the agent's starting point doesn't.
//
// The fetch refspec keeps upstream branches under refs/remotes/origin/, so our
// branches in refs/heads/factory/ can never be overwritten or pruned by a fetch.
import fs from 'node:fs';
import path from 'node:path';
import { factoryHome, repoSlug } from '../../util/paths.js';
import { git, withRepoLock } from './git.js';

/** A local path, or something git can fetch from (https://, git@…, file://). */
export function normalizeRepo(repo) {
  if (/^[a-z]+:\/\//i.test(repo) || /^[^/]+@[^:]+:/.test(repo)) return repo;
  return path.resolve(repo);
}

/**
 * Make sure the mirror exists and is up to date.
 * @returns {Promise<{ dir: string, slug: string, repo: string }>}
 */
export async function ensureMirror(repo, { env = process.env } = {}) {
  const source = normalizeRepo(repo);
  const slug = repoSlug(source);
  const dir = path.join(factoryHome(env), 'repos', `${slug}.git`);
  await withRepoLock(dir, async () => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      await git(['init', '-q', '--bare', dir]);
      await git(['remote', 'add', 'origin', source], { cwd: dir });
      await git(['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'], { cwd: dir });
    }
    await git(['fetch', '-q', '--prune', 'origin'], { cwd: dir });
  });
  return { dir, slug, repo: source };
}

/**
 * Which commit to start from.
 * @param {string} mirrorDir
 * @param {string} [base]   a branch of the source repo ('main'), or any commit-ish; default: its default branch
 * @returns {Promise<{ ref: string, sha: string }>}
 */
export async function resolveBase(mirrorDir, base) {
  const ref = base ?? (await defaultBranch(mirrorDir));
  for (const candidate of [`refs/remotes/origin/${ref}`, ref]) {
    const sha = await git(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], { cwd: mirrorDir }).catch(() => '');
    if (sha) return { ref, sha };
  }
  throw new Error(`"${ref}" is not a branch or commit of the repository. Branches: ${(await branches(mirrorDir)).join(', ') || '(none: does the repository have a commit?)'}`);
}

async function defaultBranch(mirrorDir) {
  // "ref: refs/heads/main\tHEAD" — what the source repository's HEAD points at.
  const out = await git(['ls-remote', '--symref', 'origin', 'HEAD'], { cwd: mirrorDir }).catch(() => '');
  return out.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1] ?? 'main';
}

async function branches(mirrorDir) {
  const out = await git(['for-each-ref', '--format=%(refname:strip=3)', 'refs/remotes/origin/'], { cwd: mirrorDir });
  return out.split('\n').filter((b) => b && b !== 'HEAD');
}

/**
 * A file's contents at a commit, or null if it isn't there. Reading config from the
 * PINNED commit (not the operator's working copy) makes a run reproducible.
 */
export async function readFileAt(mirrorDir, sha, file) {
  return git(['show', `${sha}:${file}`], { cwd: mirrorDir }).catch(() => null);
}

/** A file's blob id at a commit (a hash of its contents), or 'missing'. Cheap: nothing is read. */
export async function blobId(mirrorDir, sha, file) {
  return git(['rev-parse', '--verify', '--quiet', `${sha}:${file}`], { cwd: mirrorDir }).catch(() => 'missing');
}
