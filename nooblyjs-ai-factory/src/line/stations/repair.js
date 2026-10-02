// @ts-check
// Phase F13: REPAIR. Failure is information: feed it back, a bounded number of times.
//
// Until now a failing check or a blocking review finding ended the run with a
// draft PR, for a person to fix. Most of those failures are precise ("R1.2:
// divide(1, 0) returns Infinity"; "test/add.test.js:5 expected 2, got 8"), so
// an agent can fix them, if it's told exactly what's wrong:
//
//   verify ✗ / review ⛔ ──► repair: the FIXER gets the failure, fixes on top of the current head
//                                     │
//                                     └─► rewind to verify: checks and review run AGAIN on the fix
//
// Bounded, because a loop that can't converge must stop and ask a person:
//   - at most `repairAttempts` repairs per run (operator config, default 2)
//   - LOOP DETECTION: every failure gets a SIGNATURE (which check or finding, and its first line).
//     The same signature right after a repair means the fix didn't work: escalate now,
//     don't pay for the same attempt again
//   - a fixer that changes nothing: escalate
// Escalating opens an inbox entry; the run still delivers a DRAFT PR that says what's left.
//
// Repairs are recorded as events (repair.attempted), outside the stations' results,
// so a rewind doesn't forget them; a NEW build does (its repairs no longer apply).
// Later stations read the run's current head (build + repairs) through headOf().
import crypto from 'node:crypto';
import { git } from '../../exec/workspace/git.js';
import { openEntry } from '../../humans/inbox.js';
import { createAgentRecorder } from '../../job/record.js';
import { agentFor, headOf, stepRunnerFor } from './common.js';

/** @param {import('./common.js').StationContext} ctx */
export async function run(ctx) {
  const { store, runId, station, issue, itemKey, request, log } = ctx;
  const head = headOf(ctx);
  const repairs = ctx.run.repairs ?? [];
  const failure = describeFailure(ctx);
  if (!failure) return { repaired: false, reason: 'nothing to repair', costUsd: 0 };
  const limit = ctx.config?.repairAttempts ?? 2;
  const attempt = repairs.length + 1;

  const escalate = (reason) => {
    log(`repair: escalating (${reason})`);
    const inboxId = openEntry(store, { runId, kind: 'escalation', title: `${issue.ref} needs a person: ${failure.title}`, body: `${reason}.\n\n${failure.brief}`, detail: { attempts: repairs.length, signature: failure.signature } });
    return { escalated: true, reason, attempts: repairs.length, inboxId, failure: failure.title, costUsd: 0 };
  };
  if (repairs.length >= limit) return escalate(`the factory already tried ${repairs.length} repair(s)${limit ? '' : ' (repairAttempts is 0)'}`);
  if (repairs.at(-1)?.signature === failure.signature) return escalate(`the same failure came back after repair ${repairs.length}: the fix didn't work`);

  log(`repair ${attempt}/${limit}: ${failure.title}`);
  const recorder = createAgentRecorder(store, { runId, step: `${station.id}:${attempt}` });
  const { agent, driver, stopHook } = agentFor(ctx, 'fixer', {
    providerKey: `fix#${attempt}`,
    context: [failure.brief, specCriteria(ctx)],
    onEvent: (e) => recorder.observe(e),
    steeringSha: head.originalBaseSha,
  });
  const step = await stepRunnerFor(ctx)(
    {
      repo: request.repo,
      base: head.sha, // on top of the current head: the fix is a new commit, the history keeps what happened
      configSha: head.originalBaseSha,
      name: `${itemKey}-fix-${attempt}`,
      commitMessage: `Fix (repair ${attempt}): ${failure.title}\n\n${failure.kind === 'human' ? 'A person asked for this on the PR' : `The factory's ${failure.kind === 'gates' ? 'checks' : 'review'} found this`}; a fixer agent fixed it; the factory committed it.`,
      driver,
      verify: false,
      stopHook, // the fixer gets the gates' Stop hook, like a builder
      allowUnsandboxed: request.allowUnsandboxed,
      log,
      agent,
    },
    { env: store.env },
  );
  recorder.flush();
  if (ctx.live.signal?.aborted) return { repaired: false, costUsd: step.result.costUsd };
  if (step.result.outcome !== 'success' || !step.commits) {
    store.append(`run:${runId}`, 'repair.attempted', { runId, attempt, signature: failure.signature, trigger: failure.kind, title: failure.title, outcome: step.result.outcome, sha: null, costUsd: step.result.costUsd });
    return { ...escalate(step.commits ? `the fixer did not finish (${step.result.outcome})` : 'the fixer changed nothing'), costUsd: step.result.costUsd };
  }

  const sha = await git(['rev-parse', `refs/heads/${step.branch}`], { cwd: step.workspace.mirror });
  const stat = await git(['diff', '--stat', `${head.prBaseSha}..${sha}`], { cwd: step.workspace.mirror });
  store.append(`run:${runId}`, 'repair.attempted', { runId, attempt, signature: failure.signature, trigger: failure.kind, title: failure.title, outcome: 'success', sha, branch: step.branch, stat, summary: step.result.text, costUsd: step.result.costUsd });
  log(`repair ${attempt}: committed ${sha.slice(0, 8)}; checking again`);
  // Everything from verify on runs again, on the repaired code.
  const again = ctx.lineStations.find((s) => s.kind === 'verify')?.id ?? 'verify';
  return { repaired: true, attempt, sha, costUsd: step.result.costUsd, rewind: { from: again } };
}

/**
 * What's wrong, as a title, a brief for the fixer, and a SIGNATURE: the same failure
 * gives the same signature, so "it came back" can be detected.
 * @returns {{ kind: 'gates' | 'review' | 'human', title: string, brief: string, signature: string } | null}
 */
export function describeFailure(ctx) {
  // Phase F15: a PERSON asked for changes on the PR. Their words come first.
  const human = ctx.run.humanReview;
  if (human) {
    const brief = `A person reviewed the pull request and REQUESTED CHANGES (${human.by}):\n\n${human.body || '(no text: see the review comments on the PR)'}`;
    return { kind: 'human', title: `changes requested by ${human.by}`, brief, signature: sign([`human:${human.by}:${human.body}`]) };
  }
  const verify = ctx.results.verify;
  if (verify?.passed === false) {
    const bad = verify.gates.results.filter((g) => g.status !== 'passed' && g.status !== 'skipped');
    const first = bad[0];
    const brief = `The factory's checks FAILED on a clean checkout of this change:\n\n${bad.map((g) => `Check "${g.name}" (\`${g.command}\`) ${g.status}:\n\`\`\`\n${g.excerpt}\n\`\`\``).join('\n\n')}`;
    return { kind: 'gates', title: `check "${first.name}" ${first.status}`, brief, signature: sign(bad.map((g) => `${g.name}:${g.status}:${keyLine(g.excerpt)}`)) };
  }
  const blocking = Object.values(ctx.results).flatMap((r) => (r?.by && Array.isArray(r.findings) ? r.findings.filter((f) => f.severity === 'blocking').map((f) => ({ ...f, by: r.by })) : []));
  if (blocking.length) {
    const brief = `The review found ${blocking.length} BLOCKING problem(s) in this change:\n\n${blocking.map((f, i) => `${i + 1}. ${f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : '(no file)'}${f.requirementId ? ` [${f.requirementId}]` : ''} (by ${f.source === 'tampering-check' ? 'the tampering check' : f.by}): ${f.rationale}${f.suggestion ? `\n   Suggested: ${f.suggestion}` : ''}`).join('\n')}`;
    return { kind: 'review', title: `${blocking.length} blocking finding(s)${blocking[0].requirementId ? ` (${blocking[0].requirementId})` : ''}`, brief, signature: sign(blocking.map((f) => `${f.file ?? ''}|${f.requirementId ?? ''}|${f.rationale.slice(0, 80)}`)) };
  }
  return null;
}

/** The most telling line of a failure: the first one that says what went wrong, digits normalised. */
function keyLine(excerpt) {
  const lines = String(excerpt).split('\n').map((l) => l.trim()).filter(Boolean);
  const telling = lines.find((l) => /error|expected|assert|fail|✖|not ok/i.test(l)) ?? lines[0] ?? '';
  return telling.replace(/\d+(\.\d+)?ms/g, '').replace(/0x[0-9a-f]+/gi, '');
}

const sign = (parts) => crypto.createHash('sha256').update(parts.sort().join('\n')).digest('hex').slice(0, 12);

function specCriteria(ctx) {
  const spec = ctx.results.spec;
  if (!spec) return '';
  return `The acceptance criteria this change must meet (${spec.specDir}/requirements.md):\n${spec.requirements.flatMap((r) => r.criteria.map((c) => `  ${c.id} ${c.text}`)).join('\n')}`;
}
