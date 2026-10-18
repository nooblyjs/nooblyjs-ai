// @ts-check
// Phase F07: TRIAGE. Before anyone builds anything: is this buildable, and how big is it?
//
// A cheap, read-only agent (permission mode "plan": it can look, not touch)
// reads the issue and the repo, and answers with JSON:
//
//   { "kind": "feature", "size": "small", "clear": true, "outOfScope": false, "questions": [], "reason": "…" }
//
// Three outcomes:
//   out of scope   → the run ends "rejected", with the reason as a comment on the issue
//   unclear        → the run ends "needs_info", with the QUESTIONS as a comment on the issue
//   buildable      → the next stations see triage.kind / triage.size (in `when` conditions, from F08)
//
// Why a separate station? A vague issue sent straight to a builder produces a
// confident guess: a PR nobody asked for, paid for in full. Asking first is
// the cheapest fix there is.
//
// The answer is VALIDATED before anyone trusts it. Invalid JSON, or a missing
// field, is a failure (retried by the line's policy), never a guess.
import { runStep } from '../../exec/step-runner.js';
import { createAgentRecorder } from '../../job/record.js';
import { agentFor, extractJson } from './common.js';

const KINDS = ['bug', 'feature', 'chore', 'question'];
const SIZES = ['small', 'medium', 'large'];

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { store, runId, station, issue, itemKey, request, log } = ctx;
  const recorder = createAgentRecorder(store, { runId, step: station.id });
  const { agent, driver, stopHook } = agentFor(ctx, 'triager', { providerKey: 'triage', onEvent: (e) => recorder.observe(e) });
  const step = await runStep(
    {
      repo: request.repo,
      base: request.base,
      name: `${itemKey}-triage`,
      driver,
      verify: false,
      stopHook, // read-only role: false
      allowUnsandboxed: request.allowUnsandboxed,
      log,
      agent,
    },
    { env: store.env },
  );
  recorder.flush();
  if (step.result.outcome !== 'success') throw new Error(`the triage agent did not finish (${step.result.outcome})`);

  const triage = parseTriage(step.result.text);
  log(`triage: ${triage.kind} · ${triage.size} · ${triage.outOfScope ? 'out of scope' : triage.clear ? 'clear' : 'UNCLEAR'}`);
  const result = { ...triage, costUsd: step.result.costUsd, agent: { outcome: step.result.outcome, turns: step.result.turns, model: step.result.model } };

  if (triage.outOfScope) {
    await ctx.live.guard?.();
    await ctx.forge.comment(ctx.slug, issue.number, `This isn't something the factory can build as a change to this repository.\n\n${triage.reason}`, { key: `${ctx.runId}:triage:rejected` });
    return { ...result, stop: { status: 'rejected', reason: triage.reason } };
  }
  if (!triage.clear) {
    await ctx.live.guard?.();
    const questions = triage.questions.map((q) => `- ${q}`).join('\n');
    await ctx.forge.comment(ctx.slug, issue.number, `Before this can be built, a few questions:\n\n${questions}\n\n_${triage.reason}_\n\nEdit the issue with the answers and run it again.`, { key: `${ctx.runId}:triage:questions` });
    return { ...result, stop: { status: 'needs_info', reason: `${triage.questions.length} question(s) on the issue` } };
  }
  return result;
}

/** The triager's answer, checked. Throws with what's wrong. */
export function parseTriage(text) {
  let raw;
  try {
    raw = extractJson(text);
  } catch (error) {
    throw new Error(`triage answer is not JSON: ${error instanceof Error ? error.message : error}`);
  }
  const problems = [];
  if (!KINDS.includes(raw?.kind)) problems.push(`kind must be one of ${KINDS.join('/')}`);
  if (!SIZES.includes(raw?.size)) problems.push(`size must be one of ${SIZES.join('/')}`);
  if (typeof raw?.clear !== 'boolean') problems.push('clear must be true or false');
  if (raw?.clear === false && !(Array.isArray(raw?.questions) && raw.questions.length)) problems.push('an unclear issue needs at least one question');
  if (problems.length) throw new Error(`triage answer is invalid: ${problems.join('; ')}`);
  return {
    kind: raw.kind,
    size: raw.size,
    clear: raw.clear,
    outOfScope: Boolean(raw.outOfScope),
    questions: (raw.questions ?? []).map(String),
    reason: String(raw.reason ?? ''),
    // Phase F22: how sure the triager is that a competent engineer could do this as described (0–1).
    // Optional; routing starts a hard or fuzzy item on a stronger model.
    confidence: typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : null,
  };
}
