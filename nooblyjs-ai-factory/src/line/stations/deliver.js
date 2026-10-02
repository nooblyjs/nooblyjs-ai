// @ts-check
// Phase F03/F05: push the PR branch and write the PR, as idempotent effects.
// Phase F07: …as a station, reading the build and verify stations' results.
// Phase F14: …with the EVIDENCE BUNDLE as the PR body (src/evidence/bundle.js).
import { scanCommits } from '../../security/secret-scan.js';
import { entriesFor, openEntry } from '../../humans/inbox.js';
import { deliver } from '../../job/deliver.js';
import { headOf } from './common.js';
import { buildEvidence, testLinks } from '../../evidence/bundle.js';

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { verify, repair, spec } = ctx.results;
  const build = headOf(ctx); // Phase F13: the build plus any repairs
  // Phase F11: every review station's result (reviewer, security-reviewer…), in line order.
  const reviews = Object.values(ctx.results).filter((r) => r?.by && Array.isArray(r.findings));
  const head = `factory/${ctx.itemKey}/main`;
  // Phase F14: the facts the evidence bundle needs, gathered before rendering.
  const ids = spec ? spec.trace.criteria.map((c) => c.id) : [];
  const links = build?.sha ? await testLinks(build.workspace.mirror, build.prBaseSha, build.sha, ids) : {};
  const decisions = ctx.store.read({ stream: `run:${ctx.runId}`, types: ['decision.recorded'] }).map((e) => e.data);
  const escalated = repair?.escalated ? repair : null;

  // Phase F24: nothing leaves the factory with a secret (or a risky change) in ANY of its commits.
  // Pushing publishes the history, so this runs before the push, on every commit. A finding PARKS
  // the run for a person: approve (a false positive, for this exact commit) or reject (it ends "blocked").
  if (build?.sha) {
    const held = await securityHold(ctx, build);
    if (held) return held;
  }
  const delivered = await deliver(ctx.store, {
    runId: ctx.runId,
    item: ctx.itemKey,
    issue: ctx.issue,
    repo: ctx.request.repo,
    build: { ...build, gates: verify?.gates ?? null },
    forge: ctx.forge,
    log: ctx.log,
    guard: ctx.live.guard,
    escalated,
    reviews,
    render: (verdict) =>
      buildEvidence({ runId: ctx.runId, run: ctx.run, issue: ctx.issue, head, base: build.workspace.baseRef, repo: ctx.request.repo, build, verify, reviews, repairs: (ctx.run.repairs ?? []), escalated, spec, links, decisions, verdict }),
  });
  return { costUsd: 0, ...delivered };
}

/** Phase F24: scan every commit; park on a finding until a person decides. Returns a station result, or null to go on. */
async function securityHold(ctx, build) {
  const base = build.prBaseSha ?? build.workspace.baseSha;
  const scan = await scanCommits(build.workspace.mirror, base, build.sha);
  if (!scan.blocked) return null;
  const decided = entriesFor(ctx.store, ctx.runId, 'security').find((e) => e.detail?.sha === build.sha && e.status !== 'open');
  if (decided?.status === 'approved') {
    ctx.log(`security: ${scan.findings.length} finding(s), approved by ${decided.by}: delivering`);
    return null;
  }
  if (decided?.status === 'rejected') return { costUsd: 0, security: scan, stop: { status: 'blocked', reason: `security findings; ${decided.by} rejected: ${decided.feedback}` } };
  const open = entriesFor(ctx.store, ctx.runId, 'security').find((e) => e.status === 'open');
  const list = scan.findings.map((f) => `- **${f.kind}** (${f.severity}) in \`${f.file}\`${f.line ? `:${f.line}` : ''}${f.commit ? ` (commit ${f.commit})` : ''}: \`${f.excerpt}\``).join('\n');
  const inboxId = open?.id ?? openEntry(ctx.store, { runId: ctx.runId, kind: 'approval', gate: 'security', title: `Not pushed: ${scan.secrets ? `${scan.secrets} possible secret(s)` : ''}${scan.secrets && scan.risky ? ' and ' : ''}${scan.risky ? `${scan.risky} risky change(s)` : ''} in ${ctx.issue.ref}`, body: `The factory scanned every commit it was about to push and stopped.\n\n${list}\n\nNothing has been pushed. **Approve** only if these are false positives (the commits are then pushed as they are). **Reject** to end the run: if a real secret was ever written, rotate it anyway.`, detail: { sha: build.sha, findings: scan.findings } });
  ctx.store.append(`run:${ctx.runId}`, 'security.blocked', { runId: ctx.runId, sha: build.sha, findings: scan.findings, inboxId });
  ctx.log(`security: ${scan.findings.map((f) => `${f.kind} in ${f.file}`).join(', ')}: NOT pushed; waiting for a person (${inboxId})`);
  return { park: inboxId };
}
