// @ts-check
// Phase F12: a HUMAN GATE. "May the factory build this plan?"
//
// What happens depends on the run's autonomy level (humans/autonomy.js):
//
//   L0  stop     the spec is the output: pushed for reading, the run ends "suggested"
//   L1  human    ask in the inbox and PARK; carry on when a person answers
//   L2+ auto     go straight on
//   (no spec, i.e. a small item: nothing to approve, go on)
//
// Parking is the point. Waiting for a person must not hold a lease, a slot or a
// model session: the run stops ("parked"), and `factory approve` / `reject` puts
// it back in the queue. When it runs again, the executor asks this station
// again, and this time there's an answer:
//
//   approved  → go on to build
//   rejected  → REWIND to the spec station, with the person's feedback in the
//               spec-writer's prompt; the new spec comes back here for approval
//
// Answers are tied to the exact spec they judged (its commit sha): approving
// version 1 doesn't approve version 2.
import { entriesFor, openEntry } from '../../humans/inbox.js';
import { gateMode } from '../../humans/autonomy.js';
import { ensureMirror } from '../../exec/workspace/mirror.js';

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { store, runId, station, issue, itemKey, log } = ctx;
  const gate = station.gate ?? 'plan';
  const level = ctx.autonomy?.level ?? 'L1';
  const mode = gateMode(gate, level);
  const spec = ctx.results.spec;
  const specBranch = `factory/${itemKey}/spec`;

  if (mode === 'stop') {
    if (spec) await publishSpec(ctx, spec, specBranch);
    await ctx.forge.comment(ctx.slug, issue.number, spec ? `The factory wrote a spec for this issue (autonomy ${level}: it suggests, a person decides).\n\nRead it on the branch \`${specBranch}\`, in \`${spec.specDir}/\`.` : `Triage: ${ctx.results.triage?.kind ?? '?'}, ${ctx.results.triage?.size ?? '?'}. ${ctx.results.triage?.reason ?? ''}\n\n(Autonomy ${level}: the factory suggests, a person decides.)`, { key: `${runId}:suggested` });
    return { decision: 'suggested', level, costUsd: 0, stop: { status: 'suggested', reason: `autonomy ${level}: the factory suggests, a person decides` } };
  }
  if (mode === 'auto' || !spec) return { decision: 'auto', level, costUsd: 0 };

  // A person decides. Is there an answer about THIS version of the spec?
  const latest = entriesFor(store, runId, gate).find((e) => e.detail?.specSha === spec.sha);
  if (latest?.status === 'approved') {
    log(`${gate} approved by ${latest.by}`);
    return { decision: 'approved', by: latest.by, inboxId: latest.id, level, costUsd: 0 };
  }
  if (latest?.status === 'rejected') {
    log(`${gate} rejected by ${latest.by}: ${latest.feedback}`);
    return { decision: 'rejected', by: latest.by, feedback: latest.feedback, inboxId: latest.id, level, costUsd: 0, rewind: { from: 'spec', feedback: latest.feedback } };
  }
  if (latest?.status === 'open') return { park: latest.id };

  await publishSpec(ctx, spec, specBranch);
  const inboxId = openEntry(store, {
    runId,
    kind: 'approval',
    gate,
    title: `Approve the spec for ${issue.ref}: ${issue.title}`,
    body: `${spec.requirements.map((r) => `${r.id}: ${r.title}\n${r.criteria.map((c) => `  ${c.id} ${c.text}`).join('\n')}`).join('\n')}\n\nTasks: ${spec.tasks.map((t) => `${t.id} ${t.title}`).join(' · ')}\n\nRead it: git -C ${ctx.request.repo} show ${specBranch}:${spec.specDir}/requirements.md (also design.md, tasks.md)`,
    detail: { specSha: spec.sha, specDir: spec.specDir, branch: specBranch, originalBaseSha: spec.originalBaseSha },
  });
  log(`${gate}: waiting for a person (factory inbox → ${inboxId})`);
  return { park: inboxId };
}

/** Push the spec as its own branch, so a person can read it in their repo. (A side effect: check the lease first.) */
async function publishSpec(ctx, spec, specBranch) {
  ctx.live.guard?.();
  const { dir } = await ensureMirror(ctx.request.repo, { env: ctx.store.env });
  await ctx.forge.pushBranch(dir, spec.branch, specBranch);
}
