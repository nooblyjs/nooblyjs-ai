// @ts-check
// Phase F12: the PR gate. Who merges?
//
//   L0–L2   a person (this station doesn't run: the line's `when` says L3 only)
//   L3      the factory, but only when ALL of these hold:
//             the run was delivered (gates green, no blocking review findings)
//             the change touches no PROTECTED path (CI config, the factory's own config,
//             harness settings, dependency lockfiles): those always get a person's eyes
//             the repository is in a state where merging is safe (forge.merge decides)
//           otherwise it says why, and the PR waits for a person like at L2.
import { git } from '../../exec/workspace/git.js';
import { gateMode } from '../../humans/autonomy.js';
import { matchesAny } from '../../util/glob.js';
import { headOf } from './common.js';

// Phase F14: the list lives with the scope guard now (one list for both).
import { PROTECTED } from '../../exec/gates/scope-guard.js';
export { PROTECTED };

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { deliver } = ctx.results;
  const build = headOf(ctx);
  const level = ctx.autonomy?.level ?? 'L1';
  const status = deliver?.status ?? 'unknown';
  const no = (reason) => {
    ctx.log(`merge: no (${reason})`);
    return { merged: false, reason, status, costUsd: 0 };
  };
  if (gateMode('merge', level) !== 'auto') return no(`autonomy ${level}: a person merges`);
  if (status !== 'delivered') return no(`the run is "${status}", not delivered`);
  const changed = (await git(['diff', '--name-only', `${build.prBaseSha}..${build.sha}`], { cwd: build.workspace.mirror })).split('\n').filter(Boolean);
  const touched = changed.filter((f) => matchesAny(f, PROTECTED));
  if (touched.length) return no(`it touches protected paths (${touched.join(', ')}): a person merges`);

  ctx.live.guard?.(); // a side effect: only while we hold the run
  const result = await ctx.forge.merge(ctx.request.repo, { head: deliver.head, base: build.workspace.baseRef, message: `Merge ${deliver.head}: ${ctx.issue.title}\n\nMerged by the factory (autonomy ${level}): gates green, no blocking findings, no protected paths.` });
  if (!result.merged) return no(result.reason);
  ctx.log(`merge: merged into ${build.workspace.baseRef} (${result.sha.slice(0, 8)})`);
  return { merged: true, sha: result.sha, status: 'merged', costUsd: 0 };
}
