// @ts-check
// Phase F02: install ONCE, reuse many times.
//
// Most repos need a setup step before an agent can do anything useful
// (`npm ci`, `pip install -r requirements.txt`). Run it for every workspace
// and every step waits a minute for the same node_modules.
//
// So the result is cached, keyed by everything that could change it:
//
//   key = sha256( command + cachePaths + blob ids of the cacheKey files at the base commit )
//
// A blob id is git's hash of a file's contents, so "package-lock.json changed"
// = "its blob id changed" = new key = setup runs again. Same idea as CI caches
// (actions/cache keyed by hashFiles('package-lock.json')).
//
//   miss  run setup in the workspace (sandboxed) → copy cachePaths into ~/.factory/cache/<slug>/<key>/
//   hit   copy them from the cache into the workspace
//
// SINGLE-FLIGHT: if two workspaces miss the same key at the same time, the
// second waits for the first instead of running setup twice.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { factoryHome } from '../../util/paths.js';
import { runCommand } from '../sandbox.js';
import { blobId } from './mirror.js';

/** @type {Map<string, Promise<void>>} */
const inFlight = new Map();

/**
 * @param {import('./worktree.js').Workspace} ws
 * @param {import('./repo-config.js').RepoConfig} config
 * @param {{ run?: typeof runCommand, allowUnsandboxed?: boolean, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ status: 'none' | 'hit' | 'miss' | 'uncached', key?: string, durationMs: number }>}
 */
export async function ensureSetup(ws, config, { run = runCommand, allowUnsandboxed = false, env = process.env } = {}) {
  const started = Date.now();
  const setup = config.setup;
  if (!setup) return { status: 'none', durationMs: 0 };
  const runSetup = async () => {
    const result = await run(setup.command, { cwd: ws.path, network: config.network, allowUnsandboxed });
    if (result.code !== 0) throw new Error(`Setup "${setup.command}" failed (exit ${result.code}):\n${result.output.slice(-2000)}`);
  };

  if (!setup.cachePaths.length) {
    await runSetup();
    return { status: 'uncached', durationMs: Date.now() - started };
  }

  const key = await cacheKey(ws, setup);
  const dir = path.join(factoryHome(env), 'cache', ws.slug, key);
  let status = /** @type {'hit' | 'miss'} */ ('hit');

  if (!fs.existsSync(path.join(dir, '.complete'))) {
    let pending = inFlight.get(dir);
    if (!pending) {
      status = 'miss';
      pending = (async () => {
        await runSetup();
        // Copy into a temporary folder, then rename: a crash half-way never leaves a "complete" cache.
        const tmp = `${dir}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
        for (const p of setup.cachePaths) {
          if (fs.existsSync(path.join(ws.path, p))) fs.cpSync(path.join(ws.path, p), path.join(tmp, p), { recursive: true, verbatimSymlinks: true });
        }
        fs.writeFileSync(path.join(tmp, '.complete'), `${new Date().toISOString()}\n`);
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        try {
          fs.renameSync(tmp, dir);
        } catch {
          fs.rmSync(tmp, { recursive: true, force: true }); // another process won the race: fine
        }
      })().finally(() => inFlight.delete(dir));
      inFlight.set(dir, pending);
      await pending;
      return { status, key, durationMs: Date.now() - started };
    }
    await pending; // someone else is running this exact setup: wait, then copy
  }

  for (const p of setup.cachePaths) {
    if (fs.existsSync(path.join(dir, p))) fs.cpSync(path.join(dir, p), path.join(ws.path, p), { recursive: true, verbatimSymlinks: true });
  }
  return { status, key, durationMs: Date.now() - started };
}

async function cacheKey(ws, setup) {
  const blobs = await Promise.all(setup.cacheKey.map(async (file) => `${file}=${await blobId(ws.mirror, ws.baseSha, file)}`));
  return crypto.createHash('sha256').update(JSON.stringify([setup.command, setup.cachePaths, blobs])).digest('hex').slice(0, 16);
}
