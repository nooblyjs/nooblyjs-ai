// @ts-check
// Phase F03: delivering a build: push the PR branch, write the PR.
// Phase F05: …as two IDEMPOTENT side effects, safe to retry after a crash.
//
//   push  key "push:<run>:<sha>"   check: does origin's factory/<item>/main already point at <sha>?
//   pr    key "pr:<run>:<sha>"     check: is there a PR for this head that already says sha: <sha>?
//
// The sha is part of each key: re-delivering the same commit is the same
// effect (done once), while a new build (a new commit) is a new one.
import { formatGates } from '../exec/gates/runner.js';
import { formatReview } from '../review/findings.js';
import { git } from '../exec/workspace/git.js';
import { recordArtifact } from '../store/artifacts.js';
import { performEffect } from '../store/effects.js';
import { renderPrBody } from './pr.js';

/**
 * @param {import('../store/events.js').Store} store
 * @param {{ runId: string, item: string, issue: any, repo: string, build: any, forge: any, log: (l: string) => void, guard?: () => void, extraSections?: string, reviews?: any[], escalated?: any,
 *           render?: (verdict: { status: 'draft' | 'ready', problems: string[], final: string }) => { md: string, json?: object } }} args
 *   render (Phase F14): builds the PR body (the evidence bundle) from the verdict
 */
export async function deliver(store, { runId, item, issue, repo, build, forge, log, guard = () => {}, extraSections, reviews = [], escalated = null, render }) {
  const { agent, workspace: ws, sha } = build;
  const head = `factory/${item}/main`;

  const push = await performEffect(store, {
    key: `push:${runId}:${sha}`,
    kind: 'push',
    runId,
    data: { head, sha },
    // Phase F06: check we still hold the run's lease right before touching the world.
    perform: async () => (guard(), { head, sha: await forge.pushBranch(ws.mirror, build.branch, head) }),
    check: async () => {
      const remote = await git(['ls-remote', 'origin', `refs/heads/${head}`], { cwd: ws.mirror }).catch(() => '');
      return remote.startsWith(sha) ? { head, sha } : null;
    },
  });
  log(`push ${head}: ${push.how}`);

  const problems = [];
  if (agent.outcome !== 'success') problems.push(`The agent did not finish (${agent.outcome}); this is what it left.`);
  else if (build.gates?.passed === false) problems.push("The checks fail (see Checks below). The agent's summary may say otherwise: the checks decide.");
  // Phase F11: a blocking review finding keeps the PR a draft, whatever the checks said.
  const blocking = reviews.reduce((n, r) => n + r.blocking, 0);
  if (agent.outcome === 'success' && blocking) problems.push(`The review found ${blocking} blocking problem(s) (see Review below).`);
  if (escalated) problems.push(`The factory tried to repair this and escalated: ${escalated.reason}.`);
  const status = problems.length ? 'draft' : 'ready';
  const final = agent.outcome !== 'success' ? 'agent_failed' : build.gates?.passed === false ? 'gate_failed' : blocking ? 'changes_requested' : 'delivered';
  // Phase F14: the body is the EVIDENCE BUNDLE when the caller renders one; the F03 layout otherwise.
  const rendered = render?.({ status, problems, final });
  const checks = [agent.outcome === 'success' ? formatGates(build.gates?.results ?? []) : undefined, reviews.length ? formatReview(reviews) : undefined, extraSections].filter(Boolean).join('\n\n') || undefined;
  const body = rendered?.md ?? renderPrBody({ issue, head, base: ws.baseRef, baseSha: build.prBaseSha ?? ws.baseSha, repo, stat: build.stat, result: agent, status, problems, checks });

  const pr = await performEffect(store, {
    key: `pr:${runId}:${sha}`,
    kind: 'pr',
    runId,
    data: { head },
    perform: async () => (guard(), forge.openOrUpdatePR(ws.slug, { title: issue.title, head, base: ws.baseRef, status, body, meta: { issue: issue.number, run: runId, sha } })),
    check: async () => {
      const existing = await forge.findPR(ws.slug, head); // Phase F15: a forge may be remote (async)
      return existing?.sha === sha ? { path: existing.path, action: 'unchanged' } : null;
    },
  });
  log(`PR ${pr.result.action} (${pr.how}): ${pr.result.path}`);

  // Phase F15: a commit status "factory" on the head, where the forge has them (GitHub).
  // An effect like the others: set once per run and commit, reconciled after a crash.
  if (forge.setStatus) {
    const state = final === 'delivered' ? 'success' : 'failure';
    await performEffect(store, {
      key: `status:${runId}:${sha}:${final}`,
      kind: 'status',
      runId,
      data: { state },
      perform: async () => (guard(), await forge.setStatus(sha, { state, description: `factory: ${final}${problems.length ? ` · ${problems[0]}` : ''}`, targetUrl: pr.result.path }), { state }),
      check: async () => null, // setting the same status twice is harmless: just do it again
    });
  }
  recordArtifact(store, { runId, kind: 'pr', name: 'PR.md', content: body });
  if (rendered?.json) recordArtifact(store, { runId, kind: 'evidence', name: 'evidence.json', content: JSON.stringify(rendered.json, null, 2) });
  return { status: final, head, pr: pr.result, pushHow: push.how, prHow: pr.how };
}
