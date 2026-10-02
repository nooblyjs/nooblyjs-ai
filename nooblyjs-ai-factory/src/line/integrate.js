// @ts-check
// Phase F10: FAN-IN. Merge the task branches of one wave into the integration branch.
//
//   integration ──●──────────────●──────────────●    (starts at the spec commit)
//                  \            / \            /
//   T1              ●──●───────┘   \          /     wave 1: built in parallel from the same commit
//   T2              ●─────────────●┘         /
//   T3 (wave 2)                    ●──●──────┘      wave 2 starts from wave 1's merge
//
// The CONTROL PLANE merges (git merge --no-ff, one branch at a time). Most
// merges are clean, because the waves kept overlapping Paths apart. When git
// can't merge a file (a task touched something it didn't declare), the
// INTEGRATOR role gets the worktree mid-merge, with the conflicted files and
// every task's goal, and resolves the conflict. Then a deterministic check (no conflict
// markers left, nothing still unmerged) and the factory commits the merge.
//
// Declared Paths are a promise. A conflict means one was broken: worth knowing
// (F14's scope guard will check them), but not a reason to throw the work away.
import fs from 'node:fs';
import path from 'node:path';
import { createDriver } from '../exec/harness/driver.js';
import { git, identityArgs } from '../exec/workspace/git.js';
import { writeHarnessHome } from '../exec/workspace/harness-settings.js';
import { acquireWorkspace, releaseWorkspace } from '../exec/workspace/worktree.js';
import { createAgentRecorder } from '../job/record.js';
import { agentFor } from './stations/common.js';

const MARKER = /^(<{7} |={7}$|>{7} )/m;

/**
 * @param {import('./stations/common.js').StationContext} ctx
 * @param {{ baseSha: string, branches: { task: import('../specs/schema.js').Task, branch: string }[], wave: number }} args
 * @returns {Promise<{ sha: string, branch: string, conflicts: string[], costUsd: number }>}
 */
export async function integrateWave(ctx, { baseSha, branches, wave }) {
  const { store, request, itemKey, log } = ctx;
  const ws = await acquireWorkspace({ repo: request.repo, base: baseSha, name: `${itemKey}-integrate-${wave}`, env: store.env });
  const who = await identityArgs(ws.path);
  const conflicts = [];
  let costUsd = 0;
  try {
    for (const { task, branch } of branches) {
      const merged = await git([...who, 'merge', '--no-ff', '--no-edit', '-m', `Merge ${task.id}: ${task.title}`, `refs/heads/${branch}`], { cwd: ws.path }).then(() => true, () => false);
      if (merged) continue;

      const files = (await git(['diff', '--name-only', '--diff-filter=U'], { cwd: ws.path })).split('\n').filter(Boolean);
      if (!files.length) throw new Error(`merging ${task.id} failed, and not because of conflicts`);
      conflicts.push(...files.map((f) => `${task.id}: ${f}`));
      log(`integrate: ${task.id} conflicts in ${files.join(', ')}; asking the integrator`);
      costUsd += await resolve(ctx, ws, { task, files, branches });

      // The check: nothing still unmerged, no markers left in the files that conflicted.
      const left = files.filter((f) => MARKER.test(fs.readFileSync(path.join(ws.path, f), 'utf8')));
      if (left.length) throw new Error(`the integrator left conflict markers in ${left.join(', ')}`);
      await git(['add', '-A'], { cwd: ws.path });
      await git([...who, 'commit', '--no-verify', '--no-edit'], { cwd: ws.path });
    }
    const sha = await git(['rev-parse', 'HEAD'], { cwd: ws.path });
    await releaseWorkspace(ws);
    return { sha, branch: ws.branch, conflicts, costUsd };
  } catch (error) {
    await git(['merge', '--abort'], { cwd: ws.path }).catch(() => {});
    await releaseWorkspace(ws, { keep: true }).catch(() => {});
    throw error;
  }
}

/** Run the integrator role in the workspace (mid-merge). Returns what it cost. */
async function resolve(ctx, ws, { task, files, branches }) {
  const recorder = createAgentRecorder(ctx.store, { runId: ctx.runId, step: `${ctx.station.id}:integrate` });
  const goals = branches.map((b) => `- ${b.task.id}: ${b.task.title} (paths: ${b.task.paths.join(', ')}; requirements: ${b.task.requirements.join(', ') || 'none'})`).join('\n');
  const { agent, driver } = agentFor(ctx, 'integrator', {
    providerKey: 'integrate',
    vars: { conflicts: files.map((f) => `- ${f}`).join('\n'), task: task.id, goals },
    onEvent: (e) => recorder.observe(e),
  });
  // No Stop hook here (the role says so): the gates run on the whole result, at verify.
  const { hooks, ...settings } = ws.harnessSettings;
  writeHarnessHome(ws.harnessHome, settings);
  const run = await (await createDriver(driver ?? 'subprocess')).run({ ...agent, prompt: await agent.prompt(ws), cwd: ws.path, settings, harnessHome: ws.harnessHome });
  recorder.flush();
  if (run.outcome !== 'success') throw new Error(`the integrator did not finish (${run.outcome})`);
  return run.costUsd;
}
