// @ts-check
// Phase 16d: READING A REPOSITORY for its application architecture. The application architect agent drafts from the
// code at the head of the main branch, so it needs the branch, the head commit, the files and their text. Where:
//
//   repos.yaml names a local git folder        git ls-tree / git show / git rev-parse on that folder (the demo web-storefront)
//   NooblyJS's devtools service sees it         Bitbucket, read-only: the folder listings and files at the branch
//   neither                                      null: the draft is drawn from the design alone, and says so
//
// Read only: nothing here writes to a repository. Files are capped (count and size), so a big repository can't stall a
// draft, and only text files are read.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadReposMap } from '../../config/repos-map.js';

const MAX_FILES = 400;
const MAX_BYTES = 64_000;
const SKIP = /(^|\/)(node_modules|\.git|dist|build|coverage|vendor)(\/|$)/;

/** One git command in a folder, its output or null when it fails. */
function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

/** A local git folder as a reader. */
function localReader(name, dir) {
  const branch = (git(dir, ['symbolic-ref', '--short', 'HEAD']) ?? 'main').trim() || 'main';
  return {
    name, source: 'local', branch,
    async head() { return git(dir, ['rev-parse', branch])?.trim() ?? null; },
    async hasCommit(sha) { return Boolean(sha) && /^[0-9a-f]{4,40}$/i.test(sha) && git(dir, ['cat-file', '-e', `${sha}^{commit}`]) !== null; },
    async files() { return (git(dir, ['ls-tree', '-r', '--name-only', branch]) ?? '').split('\n').filter((f) => f && !SKIP.test(f)).slice(0, MAX_FILES); },
    async read(file) {
      const text = git(dir, ['show', `${branch}:${file}`]);
      return text !== null && text.length <= MAX_BYTES && !text.includes('\u0000') ? text : null;
    },
  };
}

/** A Bitbucket repository NooblyJS sees, through its devtools service (read-only). */
function bitbucketReader(name, devtools, slug) {
  let info = null;
  const load = async () => (info ??= await devtools.repository(slug).catch(() => null));
  return {
    name, source: 'bitbucket', branch: 'main',
    async head() { const r = await load(); return r?.ok ? r.commits?.[0]?.hash ?? null : null; },
    async hasCommit(sha) { const r = await load(); return Boolean(r?.ok && sha && (r.commits ?? []).some((c) => String(c.hash).startsWith(sha))); },
    async files() {
      const r = await load();
      const ref = r?.ok ? r.repository?.branch ?? 'main' : 'main';
      const out = [];
      const walk = async (folder, depth) => {
        if (out.length >= MAX_FILES || depth > 4) return;
        const listing = await devtools.file(slug, folder || '.', { ref }).catch(() => null);
        if (!listing?.ok || listing.kind !== 'folder') return;
        for (const e of listing.entries) {
          if (SKIP.test(e.path)) continue;
          if (e.type === 'folder') await walk(e.path, depth + 1);
          else if (out.length < MAX_FILES) out.push(e.path);
        }
      };
      await walk('', 0);
      return out;
    },
    async read(file) {
      const r = await load();
      const got = await devtools.file(slug, file, { ref: r?.ok ? r.repository?.branch ?? 'main' : 'main' }).catch(() => null);
      return got?.ok && got.kind === 'file' && got.text.length <= MAX_BYTES ? got.text : null;
    },
  };
}

/**
 * Who can read a repository here, by its name ("web-storefront" or "acme/web-storefront").
 * @param {{ env: NodeJS.ProcessEnv, host: any }} options
 * @returns {(repo: string) => Promise<ReturnType<typeof localReader> | ReturnType<typeof bitbucketReader> | null>}
 */
export function createRepoReaders({ env, host }) {
  return async (repo) => {
    const short = String(repo ?? '').split('/').pop() ?? '';
    const where = loadReposMap(env)[short];
    if (where && !/^[a-z][a-z0-9+.-]*:\/\/|^git@/i.test(where) && fs.existsSync(path.join(where, '.git'))) return localReader(short, where);
    const devtools = host.service?.('devtools');
    if (typeof devtools?.file === 'function' && typeof devtools?.repository === 'function') {
      const r = await devtools.repository(short).catch(() => null);
      if (r?.ok) return bitbucketReader(short, devtools, short);
    }
    return null;
  };
}

/** The text of a repository's source files (JavaScript and TypeScript), capped, as { path: text }. */
export async function readSources(reader) {
  const files = (await reader.files()).filter((f) => /\.(m?js|ts)$/.test(f));
  const out = {};
  for (const f of files.slice(0, 120)) {
    const text = await reader.read(f);
    if (text !== null) out[f] = text;
  }
  return { files: await reader.files(), sources: out };
}
