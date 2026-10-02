// @ts-check
// Phase F03–F05: the BUILDER, in its own workspace, committed by the factory.
// Phase F07: …as a station. The final gate run moved out, to the verify station.
//
// Result: the branch and sha it produced, its diff stat, the agent's outcome.
// Stops the run when there's nothing to deliver:
//   no commits + agent finished  → "no_changes"
//   no commits + agent didn't    → "agent_failed"
// (Commits + agent didn't finish still continue: deliver makes a DRAFT PR of what it left.)
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../exec/workspace/git.js';
import { loadWorkspace, releaseWorkspace } from '../../exec/workspace/worktree.js';
import { createAgentRecorder } from '../../job/record.js';
import { recordArtifact } from '../../store/artifacts.js';
import { agentFor, stepRunnerFor } from './common.js';
import { ensureMirror } from '../../exec/workspace/mirror.js';
import { nextWave, planWaves } from '../fanout.js';
import { integrateWave } from '../integrate.js';

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { store, runId, run: runRow, station, log } = ctx;

  // An earlier attempt died mid-build? Its workspace is still "active": commit what it
  // left to its branch and keep it for inspection, then start clean.
  const earlier = runRow.steps[station.id]?.workspace && loadWorkspace(runRow.steps[station.id].workspace.id, store.env);
  if (earlier?.status === 'active') {
    await releaseWorkspace(earlier, { keep: true, message: `factory: interrupted attempt of ${runId}` }).catch(() => {});
    log(`kept the interrupted attempt's workspace: ${earlier.path}`);
  }

  // Phase F10: a spec with several tasks is built task by task, in parallel waves.
  const result = ctx.specTasks?.length > 1 ? await buildTasks(ctx, ctx.specTasks) : await buildWhole(ctx);
  if (!ctx.live.signal?.aborted) await saveBuildArtifacts(store, runId, result);
  if (!result.commits) {
    const status = result.agent.outcome === 'success' ? 'no_changes' : 'agent_failed';
    return { ...result, stop: { status, reason: status === 'no_changes' ? 'the agent changed nothing' : `the agent did not finish (${result.agent.outcome}) and changed nothing` } };
  }
  return result;
}

/** One builder, the whole issue (or the whole spec when it has a single task). */
async function buildWhole(ctx) {
  const specNote = ctx.specDir
    ? `\nA spec for this work has been written and reviewed: read ${ctx.specDir}/requirements.md, design.md and tasks.md first. Implement ALL the tasks in tasks.md, in order, so that every acceptance criterion in requirements.md holds, and add tests that show it. Do not edit the spec files.\n`
    : '';
  const step = await buildOnce(ctx, { base: ctx.buildBase?.sha ?? ctx.request.base, name: ctx.itemKey, specNote, providerKey: 'build', commitMessage: `${ctx.issue.title}\n\nResolves ${ctx.issue.ref}. Written by a factory agent; committed by the factory.` });
  const ws = step.workspace;
  const sha = step.commits ? await git(['rev-parse', `refs/heads/${step.branch}`], { cwd: ws.mirror }) : null;
  return describeBuild(ctx, { ws, sha, branch: step.branch, agent: step.result, kept: step.kept, setup: step.setup?.status ?? null, fallbackStat: step.stat, commits: step.commits });
}

/**
 * Phase F10: FAN-OUT, FAN-IN. Waves of tasks built in parallel from the same commit;
 * after each wave, the task branches are merged (integrate.js) and the next wave
 * starts from the merge. So a task that depends on another sees its code.
 */
async function buildTasks(ctx, tasks) {
  const { store, runId, log } = ctx;
  const stream = `run:${runId}`;
  const limit = ctx.config?.taskConcurrency ?? 3;
  const specSha = /** @type {string} */ (ctx.buildBase?.sha);
  let baseSha = specSha;
  let branch = null;
  const done = [];
  const failed = [];
  const outcomes = {};
  let costUsd = 0;
  const conflicts = [];
  log(`fan-out: ${tasks.length} tasks, waves ${planWaves(tasks, { limit }).map((w) => `[${w.join(' ')}]`).join(' → ')}`);

  for (let wave = 1; done.length + failed.length < tasks.length && !ctx.live.signal?.aborted; wave++) {
    const next = nextWave(tasks, { done, failed, limit });
    if (!next.length) break; // what's left depends on a task that failed
    store.append(stream, 'wave.started', { runId, wave, tasks: next.map((t) => t.id), base: baseSha });
    // Share what's left of the budget between the agents running at the same time.
    const budgetUsd = ctx.live.budgetUsd !== undefined ? Math.max(0, ctx.live.budgetUsd - costUsd) / next.length : undefined;
    const steps = await Promise.all(
      next.map((task) =>
        buildOnce(ctx, {
          base: baseSha,
          name: `${ctx.itemKey}-${task.id}`,
          providerKey: `build:${task.id}`,
          budgetUsd,
          specNote: `\nA spec for this work has been written and reviewed: read ${ctx.specDir}/requirements.md, design.md and tasks.md first.\n\nYou are building ONE task of it: ${task.id}: ${task.title}\n  Requirements: ${task.requirements.join(', ') || 'none'}\n  Paths: ${task.paths.join(', ')}\n\nOther tasks are being built at the same time by others. Implement ONLY ${task.id}, with its tests, and change only its Paths unless that is truly impossible (then say why in your summary). Do not edit the spec files.\n`,
          commitMessage: `${task.id}: ${task.title}\n\nPart of ${ctx.issue.ref}. Written by a factory agent; committed by the factory.`,
          // No Stop hook for ONE task: the repo's gates check the WHOLE change, and a part can't
          // pass a check of the whole. The gates judge the integrated result, at verify.
          stopHook: false,
        }),
      ),
    );

    const toMerge = [];
    for (const [i, step] of steps.entries()) {
      const task = next[i];
      costUsd += step.result.costUsd;
      outcomes[task.id] = step.result;
      store.append(stream, 'task.finished', { runId, wave, task: task.id, outcome: step.result.outcome, commits: step.commits, costUsd: step.result.costUsd, branch: step.branch });
      // Phase F14: a task that declared Paths and changed NONE of them isn't done, whatever it says.
      // (Found by reading an evidence bundle cold: a task's files were simply missing from the PR.)
      if (step.result.outcome === 'success' && !step.commits) outcomes[task.id] = { ...step.result, outcome: 'no_changes' };
      if (outcomes[task.id].outcome !== 'success') failed.push(task.id);
      else {
        done.push(task.id);
        if (step.commits) toMerge.push({ task, branch: /** @type {string} */ (step.branch) });
      }
    }
    log(`wave ${wave}: ${next.map((t) => `${t.id} ${outcomes[t.id].outcome}`).join(' · ')}`);
    if (toMerge.length && !ctx.live.signal?.aborted) {
      const merged = await integrateWave(ctx, { baseSha, branches: toMerge, wave });
      baseSha = merged.sha;
      branch = merged.branch;
      costUsd += merged.costUsd;
      conflicts.push(...merged.conflicts);
      store.append(stream, 'wave.integrated', { runId, wave, sha: merged.sha, conflicts: merged.conflicts });
    }
  }

  const all = tasks.map((t) => outcomes[t.id]).filter(Boolean);
  const firstBad = failed.length ? outcomes[failed[0]] : null;
  const agent = {
    outcome: firstBad ? firstBad.outcome : done.length === tasks.length ? 'success' : 'error',
    text: tasks.map((t) => (outcomes[t.id] ? `${t.id} (${outcomes[t.id].outcome}): ${outcomes[t.id].text}` : `${t.id}: not built (a task it depends on failed)`)).join('\n\n'),
    costUsd,
    costIsEstimate: all.some((o) => o.costIsEstimate),
    turns: all.reduce((n, o) => n + o.turns, 0),
    toolCalls: all.reduce((n, o) => n + o.toolCalls, 0),
    durationMs: all.reduce((n, o) => Math.max(n, o.durationMs), 0),
    model: all[0]?.model ?? null,
    sessionId: null,
  };
  const mirror = (await ensureMirror(ctx.request.repo, { env: store.env })).dir;
  const sha = baseSha === specSha ? null : baseSha;
  const commits = sha ? Number(await git(['rev-list', '--count', `${specSha}..${sha}`], { cwd: mirror })) : 0;
  return {
    ...(await describeBuild(ctx, { ws: { id: null, path: null, slug: ctx.slug, mirror, baseRef: ctx.buildBase?.baseRef ?? ctx.request.base ?? 'main', baseSha: specSha, harnessHome: null }, sha, branch, agent, kept: false, setup: null, fallbackStat: '', commits })),
    tasks: tasks.map((t) => ({ id: t.id, outcome: outcomes[t.id]?.outcome ?? 'not built', costUsd: outcomes[t.id]?.costUsd ?? 0 })),
    conflicts,
  };
}

/** One builder agent in one workspace (runStep), for the whole issue or one task. */
async function buildOnce(ctx, { base, name, specNote, providerKey, commitMessage, budgetUsd, stopHook: taskStopHook }) {
  const { store, runId, station, request, log } = ctx;
  const recorder = createAgentRecorder(store, { runId, step: providerKey === 'build' ? station.id : `${station.id}:${providerKey.slice(6)}` });
  const live = budgetUsd === undefined ? ctx : { ...ctx, live: { ...ctx.live, budgetUsd } };
  const { agent, driver, stopHook } = agentFor(live, 'builder', { providerKey, vars: { specNote }, steeringSha: ctx.buildBase?.configSha, onEvent: (e) => recorder.observe(e) });
  const step = await stepRunnerFor(ctx)(
    {
      repo: request.repo,
      base, // Phase F08: build on top of the spec's commit; F10: on top of the last wave's merge
      configSha: ctx.buildBase?.configSha,
      name,
      commitMessage,
      driver,
      verify: false,
      stopHook: taskStopHook ?? stopHook,
      allowUnsandboxed: request.allowUnsandboxed,
      log,
      onWorkspace: (ws) => store.append(`run:${runId}`, 'workspace.acquired', { runId, step: station.id, workspace: { id: ws.id, path: ws.path, branch: ws.branch } }),
      agent,
    },
    { env: store.env },
  );
  recorder.flush();
  log(`${name}: ${step.result.outcome} · ${step.result.turns} turn(s) · $${step.result.costUsd.toFixed(4)}`);
  return step;
}

/** The build result every later station reads (verify, deliver, the PR). */
async function describeBuild(ctx, { ws, sha, branch, agent, kept, setup, fallbackStat, commits }) {
  // Phase F08: when building on a spec commit, the PR shows everything since the ORIGINAL base (spec + code).
  const prBaseSha = ctx.buildBase?.configSha ?? ws.baseSha;
  const stat = sha && prBaseSha !== ws.baseSha ? await git(['diff', '--stat', `${prBaseSha}..${sha}`], { cwd: ws.mirror }) : fallbackStat;
  return {
    costUsd: agent.costUsd,
    agent,
    // baseRef: the branch the PR is FOR (main), not the sha the builder started from (the spec commit).
    workspace: { id: ws.id, path: ws.path, slug: ws.slug, mirror: ws.mirror, baseRef: ctx.buildBase?.baseRef ?? ws.baseRef, baseSha: ws.baseSha, harnessHome: ws.harnessHome },
    // The ORIGINAL base (before any spec commit): its config decides which gates run.
    originalBaseSha: prBaseSha,
    prBaseSha,
    branch,
    sha,
    commits,
    stat,
    kept,
    setup,
  };
}

/** The diff and (subprocess runs) the harness transcript, kept by content. */
async function saveBuildArtifacts(store, runId, build) {
  if (build.sha) {
    const diff = await git(['diff', `${build.prBaseSha ?? build.workspace.baseSha}..${build.sha}`], { cwd: build.workspace.mirror }).catch(() => '');
    if (diff) recordArtifact(store, { runId, kind: 'diff', name: 'changes.diff', content: diff });
  }
  const id = build.agent.sessionId;
  if (!id || !build.workspace.harnessHome || !fs.existsSync(build.workspace.harnessHome)) return;
  const found = fs.readdirSync(build.workspace.harnessHome, { recursive: true }).map(String).find((f) => f.endsWith(`${id}.jsonl`) && !f.includes('checkpoints'));
  if (found) recordArtifact(store, { runId, kind: 'transcript', name: `${id}.jsonl`, content: fs.readFileSync(path.join(build.workspace.harnessHome, found)) });
}
