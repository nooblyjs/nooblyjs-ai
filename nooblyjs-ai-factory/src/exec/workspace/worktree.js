// @ts-check
// Phase F02: a WORKSPACE per agent step: its own folder, branch, sandbox
// settings, harness home and cleanup.
//
//   acquire({ repo, base, name })
//     1. fetch the mirror                          (mirror.js)
//     2. pin the base commit                       main → 3f9a1c…
//     3. read .factory/config.json AT that commit  (repo-config.js)
//     4. git worktree add -b factory/ws/<name>-<rand> …/<id>/repo <sha>
//     5. write the harness home: settings.json     (harness-settings.js)
//
//   release(ws, { keep })
//     1. commit whatever the agent changed         ← the CONTROL PLANE commits, not the agent
//     2. remove the checkout (unless keep)         ← kept on failure, for a human to inspect
//     3. no commits? delete the branch too         ← nothing to review, nothing left behind
//     meta.json and the harness home (transcript) stay until `factory workspace clean`
//
// Why does the factory commit, not the agent? In the sandbox the agent can't
// write the mirror's .git (outside its workspace), so `git commit` would fail
// there anyway. And it matches the rule that the control plane owns branches.
import fs from 'node:fs';
import path from 'node:path';
import { isoNow, systemClock } from '../../util/clock.js';
import { newId, slugify } from '../../util/ids.js';
import { factoryHome } from '../../util/paths.js';
import { git, identityArgs, withRepoLock } from './git.js';
import { harnessSettingsFor, writeGatesFile, writeHarnessHome } from './harness-settings.js';
import { ensureMirror, resolveBase } from './mirror.js';
import { loadRepoConfig } from './repo-config.js';

/**
 * @typedef {Object} Workspace
 * @property {string} id          ws-mh3k2c9a-4f1a2b
 * @property {string} name
 * @property {string} repo        where it came from (a path or URL)
 * @property {string} slug
 * @property {string} mirror      the bare mirror's folder
 * @property {string} dir         ~/.factory/workspaces/<id>
 * @property {string} path        the checkout the agent works in (<dir>/repo)
 * @property {string} harnessHome NOOBLY_HOME for its agents (<dir>/harness)
 * @property {string} branch      factory/ws/<name>-<rand>
 * @property {string} baseRef     what was asked for ('main')
 * @property {string} baseSha     what it resolved to, pinned
 * @property {'active' | 'kept' | 'released'} status
 * @property {string} createdAt
 * @property {import('./repo-config.js').RepoConfig} config
 * @property {object} harnessSettings
 * @property {string} gatesFile   Phase F04: <dir>/gates.json, for the Stop hook
 * @property {{ commits: number, stat: string } | undefined} [result]
 */

const META = 'meta.json';

export function workspacesDir(env = process.env) {
  return path.join(factoryHome(env), 'workspaces');
}

/**
 * @param {{ repo: string, base?: string, name?: string, configSha?: string, clock?: import('../../util/clock.js').Clock, env?: NodeJS.ProcessEnv }} options
 *   configSha (Phase F07): read .factory/config.json from THIS commit instead of the base. Verify uses the
 *   ORIGINAL base's config, so a build that edited the config can't change which checks run.
 * @returns {Promise<Workspace>}
 */
export async function acquireWorkspace({ repo, base, name = 'workspace', configSha, clock = systemClock, env = process.env }) {
  const mirror = await ensureMirror(repo, { env });
  const { ref, sha } = await resolveBase(mirror.dir, base);
  const config = await loadRepoConfig(mirror.dir, configSha ?? sha);

  const id = newId('ws', clock);
  const dir = path.join(workspacesDir(env), id);
  const branch = `factory/ws/${slugify(name, 24)}-${id.slice(-6)}`;
  const checkout = path.join(dir, 'repo');
  fs.mkdirSync(dir, { recursive: true });

  await withRepoLock(mirror.dir, async () => {
    // Cached folders (node_modules…) must never be committed, even if the repo forgot to .gitignore them.
    // info/exclude lives in the mirror and applies to all its worktrees.
    const cached = config.setup?.cachePaths ?? [];
    if (cached.length) addExcludes(mirror.dir, cached);
    await git(['worktree', 'add', '-q', '-b', branch, checkout, sha], { cwd: mirror.dir });
  });

  const gatesFile = path.join(dir, 'gates.json');
  writeGatesFile(gatesFile, config);
  const harnessSettings = harnessSettingsFor(config, { gatesFile });
  const harnessHome = path.join(dir, 'harness');
  writeHarnessHome(harnessHome, harnessSettings);

  /** @type {Workspace} */
  const ws = { id, name, repo: mirror.repo, slug: mirror.slug, mirror: mirror.dir, dir, path: checkout, harnessHome, branch, baseRef: ref, baseSha: sha, status: 'active', createdAt: isoNow(clock), config, harnessSettings, gatesFile };
  saveMeta(ws);
  return ws;
}

/**
 * @param {Workspace} ws
 * @param {{ keep?: boolean, message?: string }} [options]
 * @returns {Promise<{ commits: number, stat: string, branch: string | null, kept: boolean }>}
 */
export async function releaseWorkspace(ws, { keep = false, message } = {}) {
  if (ws.status === 'released') throw new Error(`Workspace ${ws.id} was already released.`);
  if (fs.existsSync(ws.path) && (await git(['status', '--porcelain'], { cwd: ws.path }))) {
    await git(['add', '-A'], { cwd: ws.path });
    // --no-verify: the repo's hooks are the repo's code, and they'd run outside any sandbox.
    await git([...(await identityArgs(ws.path)), 'commit', '-q', '--no-verify', '-m', message ?? `factory: work from ${ws.name}`], { cwd: ws.path });
  }
  const commits = Number(await git(['rev-list', '--count', `${ws.baseSha}..${ws.branch}`], { cwd: ws.mirror }));
  const stat = commits ? await git(['diff', '--stat', `${ws.baseSha}..${ws.branch}`], { cwd: ws.mirror }) : '';

  if (!keep) {
    await withRepoLock(ws.mirror, async () => {
      await git(['worktree', 'remove', '--force', ws.path], { cwd: ws.mirror }).catch(() => fs.rmSync(ws.path, { recursive: true, force: true }));
      await git(['worktree', 'prune'], { cwd: ws.mirror });
      if (!commits) await git(['branch', '-D', ws.branch], { cwd: ws.mirror });
    });
  }
  ws.status = keep ? 'kept' : 'released';
  ws.result = { commits, stat };
  saveMeta(ws);
  return { commits, stat, branch: commits || keep ? ws.branch : null, kept: keep };
}

/** Every workspace the factory knows about, newest first. */
export function listWorkspaces(env = process.env) {
  const root = workspacesDir(env);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .sort()
    .reverse() // ids sort by time (Phase F00), so this is newest first
    .map((id) => loadWorkspace(id, env))
    .filter((ws) => ws !== null);
}

/** @returns {Workspace | null} */
export function loadWorkspace(id, env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(path.join(workspacesDir(env), id, META), 'utf8'));
  } catch {
    return null;
  }
}

/** Delete released workspaces' folders (meta + transcripts). Their branches stay in the mirror. */
export function cleanWorkspaces(env = process.env) {
  const removed = [];
  for (const ws of listWorkspaces(env)) {
    if (ws.status !== 'released') continue;
    fs.rmSync(ws.dir, { recursive: true, force: true });
    removed.push(ws.id);
  }
  return removed;
}

function saveMeta(ws) {
  fs.writeFileSync(path.join(ws.dir, META), `${JSON.stringify(ws, null, 2)}\n`);
}

function addExcludes(mirrorDir, paths) {
  const file = path.join(mirrorDir, 'info', 'exclude');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  const missing = paths.map((p) => `/${p.replace(/^\/+|\/+$/g, '')}/`).filter((line) => !existing.includes(line));
  if (!missing.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${existing.length && existing.at(-1) !== '' ? '\n' : ''}${missing.join('\n')}\n`);
}
