// @ts-check
// Phase F11: REVIEW. Judgment after the facts: a different role, read-only, against the spec.
//
//   deterministic gates (F04, verify)  →  "does it pass the checks we could write down?"
//   review (this station)              →  "does it do what was ASKED? what did the checks miss?"
//   a human (F12)                      →  "do we want this?"
//
// Two roles use this station (the line says which, per station):
//   reviewer            every change: the diff against the spec's acceptance criteria and the issue
//   security-reviewer   only when the change touches "sensitive" paths or dependencies
//                       (the repo's .factory/config.json → review.sensitive, review.dependencies)
//
// Before any model is asked, the TAMPERING check runs (deterministic): deleted
// tests, removed assertions, new .skip/.only become blocking findings by themselves.
//
// The reviewer is READ-ONLY (plan mode, by its role; the loader keeps it that way): a
// reviewer that could edit what it reviews would be reviewing its own work.
import { git } from '../../exec/workspace/git.js';
import { runStep } from '../../exec/step-runner.js';
import { loadRepoConfig } from '../../exec/workspace/repo-config.js';
import { createAgentRecorder } from '../../job/record.js';
import { parseReview } from '../../review/findings.js';
import { detectTampering } from '../../review/tampering.js';
import { matchesAny } from '../../util/glob.js';
import { agentFor, headOf } from './common.js';

const DEPENDENCY_FILES = ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'requirements.txt', 'poetry.lock', 'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile.lock'];
const MAX_DIFF = 60_000; // characters of diff in the prompt; the reviewer can Read the rest

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { store, runId, station, request, itemKey, log } = ctx;
  const roleName = station.role ?? 'reviewer';
  const build = headOf(ctx); // Phase F13: the build plus any repairs
  if (!build?.sha) throw new Error('review needs a build with a commit');
  const mirror = build.workspace.mirror;
  const base = build.prBaseSha;

  const changed = (await git(['diff', '--name-only', `${base}..${build.sha}`], { cwd: mirror })).split('\n').filter(Boolean);
  const config = await loadRepoConfig(mirror, build.originalBaseSha); // the ORIGINAL base: the change can't unmark itself
  const sensitiveFiles = changed.filter((f) => matchesAny(f, config.review.sensitive) || (config.review.dependencies && DEPENDENCY_FILES.includes(f.split('/').pop() ?? '')));
  const tampering = roleName === 'reviewer' ? await detectTampering(mirror, base, build.sha) : [];

  const spec = ctx.results.spec;
  const requirementIds = spec ? spec.requirements.flatMap((r) => [r.id, ...r.criteria.map((c) => c.id)]) : undefined;
  let diff = await git(['diff', `${base}..${build.sha}`, '--', '.', ':(exclude).factory/specs'], { cwd: mirror });
  if (diff.length > MAX_DIFF) diff = `${diff.slice(0, MAX_DIFF)}\n… (diff cut at ${MAX_DIFF} characters: Read the files for the rest)`;
  const gates = ctx.results.verify?.gates?.results;

  const context = [
    spec
      ? `The spec this change implements (${spec.specDir}/requirements.md), with its acceptance criteria:\n\n${spec.requirements.map((r) => `${r.id}: ${r.title}\n${r.criteria.map((c) => `  ${c.id} ${c.text}`).join('\n')}`).join('\n')}`
      : 'There is no spec for this change: review it against the issue below.',
    gates ? `The gates on a clean checkout of this change: ${gates.map((g) => `${g.name} ${g.status}`).join(', ')}.` : 'No gates are configured for this repository: nothing has been checked automatically.',
    tampering.length ? `The factory's tampering check already found (you don't need to repeat these):\n${tampering.map((f) => `- ${f.rationale}`).join('\n')}` : '',
    roleName === 'security-reviewer' ? `Sensitive files in this change: ${sensitiveFiles.join(', ')}` : '',
    `The change (git diff, spec files excluded):\n\n\`\`\`diff\n${diff}\n\`\`\``,
  ];

  const recorder = createAgentRecorder(store, { runId, step: station.id });
  const { agent, driver, stopHook } = agentFor(ctx, roleName, { providerKey: station.id, context, onEvent: (e) => recorder.observe(e) });
  let review = null;
  const step = await runStep(
    {
      repo: request.repo,
      base: build.sha,
      configSha: build.originalBaseSha,
      name: `${itemKey}-${station.id}`,
      driver,
      verify: false,
      stopHook, // read-only: false
      allowUnsandboxed: request.allowUnsandboxed,
      log,
      // The answer must fit the schema; if not, ask again (the check → fix loop, F08).
      check: async (_ws, result) => {
        const parsed = parseReview(result.text, { requirementIds });
        review = parsed.review;
        return { ok: Boolean(parsed.review), problems: parsed.problems };
      },
      fixPrompt: (problems) => `Your review could not be used:\n\n${problems.map((p) => `- ${p}`).join('\n')}\n\nThis is a new session. Review the change again (it is checked out here; the diff is below the issue in your first instructions, or use git diff), and answer with ONE JSON object in a \`\`\`json block, in the format you were given.`,
      agent,
    },
    { env: store.env },
  );
  recorder.flush();
  if (step.result.outcome !== 'success') throw new Error(`the ${roleName} did not finish (${step.result.outcome})`);
  const answer = /** @type {import('../../review/findings.js').Review | null} */ (review);
  if (!answer) throw new Error(`the ${roleName}'s answer never fit the schema: ${step.check?.problems.join('; ')}`);

  const findings = [...tampering, ...answer.findings];
  const blocking = findings.filter((f) => f.severity === 'blocking').length;
  log(`${station.id}: ${blocking ? `${blocking} blocking finding(s)` : 'no blocking findings'}${findings.length - blocking ? `, ${findings.length - blocking} other` : ''}`);
  return {
    costUsd: step.result.costUsd,
    by: roleName,
    verdict: blocking ? 'changes_requested' : answer.verdict,
    summary: answer.summary,
    findings,
    blocking,
    sensitive: sensitiveFiles.length > 0,
    sensitiveFiles,
  };
}
