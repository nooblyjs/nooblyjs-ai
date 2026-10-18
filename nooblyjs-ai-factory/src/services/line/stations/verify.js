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
import { runGates } from '../../exec/gates/runner.js';
import { commandIsolation } from '../../exec/sandbox.js';
import { ensureSetup } from '../../exec/workspace/setup-cache.js';
import { acquireWorkspace, releaseWorkspace } from '../../exec/workspace/worktree.js';
import { headOf } from './common.js';
import { git } from '../../exec/workspace/git.js';
import { checkScope, scopeGate } from '../../exec/gates/scope-guard.js';

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
    if (!gates.length) {
      await releaseWorkspace(ws);
      if (!scopeResults.length) {
        log('verify: no gates configured');
        return { costUsd: 0, gates: null, passed: null, scope, changed };
      }
      return { costUsd: 0, gates: { passed: false, results: scopeResults }, passed: false, scope, changed, checkedSha: build.sha };
    }
    const sandbox = commandIsolation(); // Phase F23: bubblewrap, or a container image
    if (!sandbox.available && !request.allowUnsandboxed) throw new Error(`the gates are the repository's own commands and need a sandbox (${sandbox.reason})`);
    await ensureSetup(ws, ws.config, { allowUnsandboxed: request.allowUnsandboxed, env: store.env });
    const ran = await runGates(gates, { cwd: ws.path, network: ws.config.network, allowUnsandboxed: request.allowUnsandboxed });
    const verdict = { passed: ran.passed && !scopeResults.length, results: [...scopeResults, ...ran.results] };
    log(`verify (clean checkout of ${build.sha.slice(0, 8)}): ${verdict.results.map((g) => `${g.name} ${g.status}`).join(' · ')}`);
    await releaseWorkspace(ws, { keep: !verdict.passed });
    // A failure keeps this clean checkout, where it failed, for a human to look at.
    return { costUsd: 0, gates: verdict, passed: verdict.passed, scope, changed, checkedSha: build.sha, workspace: verdict.passed ? null : ws.path };
  } catch (error) {
    await releaseWorkspace(ws, { keep: true }).catch(() => {});
    throw error;
  }
}
