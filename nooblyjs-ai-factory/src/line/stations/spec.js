// @ts-check
// Phase F08: SPEC. Requirements → design → tasks, BEFORE any code.
//
// Most agent failures aren't coding failures. They're SPECIFICATION failures:
// the agent built something reasonable that wasn't what was needed, or missed
// the error case nobody mentioned. A spec makes "what was needed" explicit,
// checkable and reviewable, before money is spent on code.
//
//   spec-writer agent  ──►  .factory/specs/issue-3/{requirements,design,tasks}.md
//        ▲                                   │
//        └──── problems (fix, ≤ 2×) ◄── CHECK (deterministic: schema.js + trace.js)
//                                            │ ok
//                                            ▼
//                        committed on its own branch → the builder starts FROM this commit
//
// The spec-writer can only write inside its spec folder: permission mode
// "default" (nobody to ask → no) plus one allow rule, Edit(.factory/specs/issue-3/**).
// A deterministic scope check backs that up: any change outside the folder fails the station.
//
// Runs only for items triage called medium or large (`when` in the line). For a
// small, clear change, a spec costs more than it saves.
import { git } from '../../exec/workspace/git.js';
import { runStep } from '../../exec/step-runner.js';
import { specFixPrompt } from '../../job/prompt.js';
import { createAgentRecorder } from '../../job/record.js';
import { checkSpec } from '../../specs/schema.js';
import fs from 'node:fs';
import path from 'node:path';
import { agentFor } from './common.js';
import { entriesFor } from '../../humans/inbox.js';

export const SPEC_FILES = ['requirements', 'design', 'tasks'];

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { store, runId, station, issue, itemKey, request, log } = ctx;
  const specDir = `.factory/specs/${itemKey}`;
  const recorder = createAgentRecorder(store, { runId, step: station.id });
  const triage = ctx.results.triage;
  // Phase F12: did a person reject an earlier version? Then start FROM it (edit, don't start over),
  // with their feedback, newest first. The gates still come from the original base.
  const rejected = entriesFor(store, runId, 'plan').filter((e) => e.status === 'rejected');
  const previous = rejected[0]?.detail;
  const feedback = rejected.length
    ? `A person reviewed an earlier version of this spec and REJECTED it. That version is in ${specDir}/ now (Read the files before you change them). Their feedback, newest first:\n\n${rejected.map((e) => `- "${e.feedback}" (${e.by})`).join('\n')}\n\nRevise the spec to address the feedback. Keep what was right.`
    : '';
  const { agent, driver, stopHook } = agentFor(ctx, 'spec-writer', {
    providerKey: 'spec',
    vars: { specDir },
    context: [triage ? `Triage said: ${triage.kind}, ${triage.size}. ${triage.reason}` : '', feedback],
    onEvent: (e) => recorder.observe(e),
  });

  const check = async (ws) => {
    const files = Object.fromEntries(SPEC_FILES.map((f) => {
      const file = path.join(ws.path, specDir, `${f}.md`);
      return [f, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null];
    }));
    const verdict = checkSpec(files);
    // Scope: the spec-writer may only have touched its own folder.
    // Changed tracked files, plus every untracked FILE (not folder: a new folder would hide a stray
    // .factory/config.json inside it). Asked as NAMES: parsing `git status --porcelain` columns broke
    // once our git() helper trimmed the leading space of " M file" (found in F12, when a revised spec
    // MODIFIED a file for the first time).
    const tracked = await git(['diff', '--name-only', 'HEAD'], { cwd: ws.path });
    const untracked = await git(['ls-files', '--others', '--exclude-standard'], { cwd: ws.path });
    const changed = `${tracked}\n${untracked}`.split('\n').filter(Boolean);
    const outside = changed.filter((f) => !f.startsWith(`${specDir}/`));
    if (outside.length) verdict.problems.push(`files outside ${specDir}/ were changed: ${outside.join(', ')}`);
    return { ...verdict, ok: verdict.problems.length === 0 };
  };

  const step = await runStep(
    {
      repo: request.repo,
      base: previous?.specSha ?? request.base,
      configSha: previous?.originalBaseSha,
      name: `${itemKey}-spec`,
      commitMessage: `Spec: ${issue.title}\n\nRequirements, design and tasks for ${issue.ref}, written by a factory agent.`,
      driver,
      verify: false,
      stopHook, // it writes documents, not code: the tests are not its business (role: stopHook false)
      allowUnsandboxed: request.allowUnsandboxed,
      log,
      check,
      fixPrompt: (problems) => specFixPrompt(problems, specDir),
      agent, // role spec-writer: permission mode "default" + Edit({{specDir}}/**) only
    },
    { env: store.env },
  );
  recorder.flush();
  if (step.result.outcome !== 'success') throw new Error(`the spec-writer did not finish (${step.result.outcome}${step.result.outcome === 'error' ? `: ${step.result.text}` : ''})`);
  const verdict = /** @type {any} */ (step.check);
  if (!verdict?.ok) throw new Error(`the spec still has ${verdict?.problems.length} problem(s): ${verdict?.problems.slice(0, 3).join('; ')}`);
  if (!step.commits) throw new Error('the spec-writer wrote nothing');

  const ws = step.workspace;
  const sha = await git(['rev-parse', `refs/heads/${step.branch}`], { cwd: ws.mirror });
  log(`spec: ${verdict.requirements.length} requirement(s), ${verdict.trace.criteria.length} criteria, ${verdict.tasks.length} task(s), all covered`);
  return {
    costUsd: step.result.costUsd,
    agent: { outcome: step.result.outcome, turns: step.result.turns, model: step.result.model },
    specDir,
    sha,
    branch: step.branch,
    originalBaseSha: previous?.originalBaseSha ?? ws.baseSha,
    baseRef: previous ? (ctx.request.base ?? (await defaultRef(ws))) : ws.baseRef, // the BRANCH the work is for (e.g. main): the builder starts from a sha, the PR must not
    requirements: verdict.requirements,
    tasks: verdict.tasks,
    trace: verdict.trace,
  };
}

/** The branch name for the PR when the workspace started from a commit (a revised spec). */
async function defaultRef(ws) {
  const out = await git(['ls-remote', '--symref', 'origin', 'HEAD'], { cwd: ws.mirror }).catch(() => '');
  return out.match(/^ref: refs\/heads\/(\S+)\s+HEAD/m)?.[1] ?? 'main';
}
