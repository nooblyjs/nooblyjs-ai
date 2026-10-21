// @ts-check
// Phase F04: deterministic gates.
// Phase F07: …as their own station, on a CLEAN CHECKOUT of exactly the committed code.
//
// In F04 the gates ran in the builder's workspace. That checked the files on
// disk, which is not quite the same as the commit: an untracked file, a build
// artifact, or a node_modules the agent patched could make a check pass that
// the commit alone would fail. Now:
//
//   new workspace at <build sha>  ──►  setup (cached)  ──►  every gate  ──►  release
//
// "It passes on a clean checkout of the commit" is what CI proves, and what
// the reviewer is about to merge.
//
// Phase F14: plus the SCOPE GUARD (declared paths, protected paths), as the first check.
//
// The gates come from the ORIGINAL base commit's .factory/config.json, not the
// build commit's, so an agent that edited the config can't change which checks run.
//
// NooblyJS Phase 19: hosted with NooblyJS Security, the commit's changed files (and package.json) are scanned
// after the repository's gates (ctx.live.scan): each kind (secrets, SAST, SCA, licence, IaC) is a gate of its
// own, and the result carries the change's SBOM. The scanner decides; a model never passes a gate.
import { runGates } from '../../exec/gates/runner.js';
import { commandIsolation } from '../../exec/sandbox.js';
import { ensureSetup } from '../../exec/workspace/setup-cache.js';
import { acquireWorkspace, releaseWorkspace } from '../../exec/workspace/worktree.js';
import { headOf } from './common.js';
import { git } from '../../exec/workspace/git.js';
import { checkScope, scopeGate } from '../../exec/gates/scope-guard.js';
import fs from 'node:fs';
import path from 'node:path';

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { store, request, itemKey, log } = ctx;
  const build = headOf(ctx); // Phase F13: the build plus any repairs
  if (!build?.sha) throw new Error('verify needs a build with a commit');

  const ws = await acquireWorkspace({ repo: request.repo, base: build.sha, configSha: build.originalBaseSha, name: `${itemKey}-verify`, env: store.env });
  try {
    // Phase F14: the SCOPE GUARD first: free, certain, and it needs no sandbox.
    const changed = (await git(['diff', '--name-only', `${build.prBaseSha}..${build.sha}`], { cwd: ws.mirror })).split('\n').filter(Boolean);
    const spec = ctx.results.spec;
    const scope = checkScope({ changed, tasks: spec?.tasks ?? null, specDir: spec?.specDir ?? null, granted: ctx.run.scopeGranted ?? [] });
    const strict = ws.config.scope !== 'warn';
    if (!scope.ok) log(`scope: ${scope.violations.map((v) => `${v.file} (${v.why})`).join(', ')}${strict ? '' : ' (warn only)'}`);
    const scopeResults = strict && !scope.ok ? [scopeGate(scope)] : [];

    const { gates } = ws.config;
    let ran = { passed: true, results: /** @type {any[]} */ ([]) };
    if (gates.length) {
      const sandbox = commandIsolation(); // Phase F23: bubblewrap, or a container image
      if (!sandbox.available && !request.allowUnsandboxed) throw new Error(`the gates are the repository's own commands and need a sandbox (${sandbox.reason})`);
      await ensureSetup(ws, ws.config, { allowUnsandboxed: request.allowUnsandboxed, env: store.env });
      ran = await runGates(gates, { cwd: ws.path, network: ws.config.network, allowUnsandboxed: request.allowUnsandboxed });
    }
    // NooblyJS Phase 19: Security's scans, as gates after the repository's own (fail fast: not when those failed).
    const security = ran.passed ? await securityScan(ctx, ws.path, changed, build.sha) : null;
    if (!gates.length && !security) {
      await releaseWorkspace(ws);
      if (!scopeResults.length) {
        log('verify: no gates configured');
        return { costUsd: 0, gates: null, passed: null, scope, changed };
      }
      return { costUsd: 0, gates: { passed: false, results: scopeResults }, passed: false, scope, changed, checkedSha: build.sha };
    }
    const scanned = security?.results ?? [];
    const verdict = { passed: ran.passed && !scopeResults.length && scanned.every((g) => g.status === 'passed'), results: [...scopeResults, ...ran.results, ...scanned] };
    log(`verify (clean checkout of ${build.sha.slice(0, 8)}): ${verdict.results.map((g) => `${g.name} ${g.status}`).join(' · ')}`);
    await releaseWorkspace(ws, { keep: !verdict.passed });
    // A failure keeps this clean checkout, where it failed, for a human to look at.
    return {
      costUsd: 0, gates: verdict, passed: verdict.passed, scope, changed, checkedSha: build.sha, workspace: verdict.passed ? null : ws.path,
      ...(security ? { security: { scanId: security.scanId, scanner: security.scanner, real: security.real, sbom: security.sbom } } : {}),
    };
  } catch (error) {
    await releaseWorkspace(ws, { keep: true }).catch(() => {});
    throw error;
  }
}

const MAX_SCAN_BYTES = 512 * 1024;

/**
 * NooblyJS Phase 19: Security scans the commit, read from the clean checkout. Null when Security isn't there (or the
 * run isn't NooblyJS's). A scan that can't be made is an error gate: a security gate fails closed.
 * @param {import('./common.js').StationContext} ctx
 * @param {string} dir   the clean checkout
 * @param {string[]} changed
 * @param {string} sha
 */
async function securityScan(ctx, dir, changed, sha) {
  const scan = ctx.live?.scan;
  const noobly = ctx.request?.noobly;
  if (typeof scan !== 'function' || !noobly) return null;
  const started = Date.now();
  const files = [];
  for (const rel of new Set([...changed, 'package.json'])) {
    const full = path.join(dir, rel);
    if (!full.startsWith(dir + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) continue;
    const buf = fs.readFileSync(full);
    if (buf.length > MAX_SCAN_BYTES || buf.includes(0)) continue;
    files.push({ path: rel, text: buf.toString('utf8') });
  }
  try {
    const r = await scan({ repo: noobly.repoName ?? ctx.request.repo, itemId: noobly.itemId ?? null, runId: ctx.runId, sha, findingId: noobly.findingId ?? null, files });
    if (!r) return null;
    const results = r.results.map((g) => ({
      name: g.name, command: `NooblyJS Security · ${g.label} (${r.scanner}${r.real ? '' : ' scanner: not a real scan'})`, status: g.status,
      exitCode: null, durationMs: Date.now() - started, excerpt: g.status === 'passed' ? '' : g.excerpt,
    }));
    return { results, scanId: r.scanId, scanner: r.scanner, real: r.real, sbom: r.sbom };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { results: [{ name: 'security', command: 'NooblyJS Security', status: 'error', exitCode: null, durationMs: Date.now() - started, excerpt: `The scan could not be made: ${message}` }], scanId: null, scanner: null, real: false, sbom: null };
  }
}
