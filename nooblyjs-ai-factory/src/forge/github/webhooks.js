// @ts-check
// Phase F15: WEBHOOKS. GitHub tells the factory what happened; the factory decides what that means.
//
//   POST /webhooks/github
//   X-GitHub-Event: issues | pull_request | pull_request_review
//   X-GitHub-Delivery: <a unique id per delivery>
//   X-Hub-Signature-256: sha256=<HMAC of the raw body with the shared secret>
//
// 1. VERIFY. Anyone can POST to a public URL. Only GitHub knows the secret, so only
//    GitHub can sign. Compare in constant time (timingSafeEqual): a normal string
//    compare leaks, through timing, how many leading characters matched.
// 2. PARSE into one of a few commands (anything else is ignored, politely):
//      issue labelled "factory"                  → submit a run
//      a factory PR merged                        → the run is "merged"
//      "changes requested" by an allowed person   → the run goes back to the FIXER with their review
// 3. HANDLE idempotently. GitHub REDELIVERS webhooks (timeouts, manual redelivery), so
//    a submission is keyed by the delivery id: the same delivery never makes two runs.
import crypto from 'node:crypto';
import { submitJob } from '../../job/run-job.js';
import { loadLine } from '../../line/line.js';
import { KINDS } from '../../line/executor.js';

/** Is this body really from GitHub (signed with our secret)? */
export function verifySignature(secret, rawBody, header) {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const got = Buffer.from(header);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

/**
 * An event → a factory command, or null (not for us).
 * @param {string} event   X-GitHub-Event
 * @param {any} payload
 * @param {{ label: string, allowedUsers: string[] }} settings
 */
export function parseWebhook(event, payload, settings) {
  const repo = payload.repository;
  const where = repo && { owner: repo.owner?.login, name: repo.name, cloneUrl: repo.clone_url };
  if (event === 'issues' && ['labeled', 'opened', 'reopened'].includes(payload.action)) {
    const labels = (payload.issue?.labels ?? []).map((l) => l.name);
    const labelled = payload.action === 'labeled' ? payload.label?.name === settings.label : labels.includes(settings.label);
    if (!labelled) return null;
    const i = payload.issue;
    return { type: 'submit', ...where, issue: { number: i.number, ref: `${where.owner}/${where.name}#${i.number}`, title: i.title, body: i.body ?? '', labels }, by: payload.sender?.login };
  }
  const head = payload.pull_request?.head?.ref;
  if (!head?.startsWith('factory/')) return null;
  if (event === 'pull_request' && payload.action === 'closed' && payload.pull_request.merged) {
    return { type: 'merged', ...where, head, sha: payload.pull_request.merge_commit_sha, by: payload.sender?.login };
  }
  if (event === 'pull_request_review' && payload.action === 'submitted' && payload.review?.state === 'changes_requested') {
    const by = payload.review.user?.login;
    if (settings.allowedUsers.length && !settings.allowedUsers.includes(by)) return { type: 'ignored', reason: `${by} is not in github.allowedUsers` };
    return { type: 'changes_requested', ...where, head, body: payload.review.body ?? '', by };
  }
  return null;
}

/**
 * Do what a command says. Returns what happened, for the HTTP response and the log.
 * @param {import('../../store/events.js').Store} store
 * @param {any} cmd
 * @param {{ delivery: string, repoPath?: (owner: string, name: string) => string | undefined, apiUrl?: string, line?: string }} ctx
 */
export function handleWebhook(store, cmd, ctx) {
  if (!cmd) return { handled: false, reason: 'not an event the factory acts on' };
  if (cmd.type === 'ignored') return { handled: false, reason: cmd.reason };

  if (cmd.type === 'submit') {
    if (ctx.line) loadLine(ctx.line, KINDS());
    // The repo to clone: a configured local path (a mirror source you control), or GitHub's clone URL.
    const repo = ctx.repoPath?.(cmd.owner, cmd.name) ?? cmd.cloneUrl;
    const runId = submitJob(store, { repo, forge: { kind: 'github', owner: cmd.owner, name: cmd.name, ...(ctx.apiUrl && { apiUrl: ctx.apiUrl }) }, issue: cmd.issue, line: ctx.line }, { key: `github:delivery:${ctx.delivery}` });
    return runId ? { handled: true, runId } : { handled: false, reason: 'already handled (a redelivery)' };
  }

  // Which run does this PR belong to? The newest one that delivered this head branch.
  const run = store.list('runs').filter((r) => r.head === cmd.head).sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  if (!run) return { handled: false, reason: `no run delivered ${cmd.head}` };
  const stream = `run:${run.id}`;

  if (cmd.type === 'merged') {
    store.append(stream, 'run.merged', { runId: run.id, itemId: run.itemId, sha: cmd.sha, by: cmd.by }, { key: `github:delivery:${ctx.delivery}` });
    return { handled: true, runId: run.id };
  }
  if (cmd.type === 'changes_requested') {
    if (run.status === 'running' || run.status === 'queued') return { handled: false, reason: `run ${run.id} is ${run.status}: its next delivery will be reviewed again` };
    const first = store.append(stream, 'pr.changes_requested', { runId: run.id, body: cmd.body, by: cmd.by }, { key: `github:delivery:${ctx.delivery}` });
    if (!first) return { handled: false, reason: 'already handled (a redelivery)' };
    // Back to the fixer (F13): repair, deliver and merge run again, with the person's review as the failure.
    const ids = loadLine(run.request.line ?? 'default', KINDS()).stations.map((s) => s.id);
    const from = ids.includes('repair') ? 'repair' : 'build';
    store.append(stream, 'run.rewound', { runId: run.id, from, reset: ids.slice(ids.indexOf(from)), feedback: cmd.body });
    store.append(stream, 'run.requeued', { runId: run.id, reason: `changes requested by ${cmd.by}` });
    return { handled: true, runId: run.id };
  }
  return { handled: false, reason: `unknown command ${cmd.type}` };
}
