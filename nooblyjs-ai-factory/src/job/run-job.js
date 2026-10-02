// @ts-check
// Phase F03: THE FIRST JOB. An issue goes in; a branch and a PR come out.
// Phase F05: …every step RECORDED, so it survives a crash and can be retried.
// Phase F06: …QUEUED (submitJob) and always executed while holding a LEASE.
// Phase F07: …through a LINE of stations (triage → build → verify → deliver), driven
//            by the pure line engine. This file now only creates, queues and starts
//            runs; what a run DOES is src/line/.
//
// How a run ends (the run's status):
//   delivered     all stations done, the gates pass: a ready PR
//   gate_failed   the gates fail: a draft PR with the failure (F04)
//   agent_failed  the builder didn't finish; a draft PR if it changed anything
//   no_changes    the builder finished but changed nothing: no PR
//   needs_info    triage: the issue isn't clear; questions posted on it (F07)
//   rejected      triage: not a change to this repo (F07)
//   error         something broke, and the station's retries ran out
//   interrupted   stopped from outside or its worker died: retry it
//   cancelled · paused
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadFactoryConfig } from '../config/factory-config.js';
import { forgeFor } from '../forge/index.js';
import { normalizeRepo } from '../exec/workspace/mirror.js';
import { executeLine, KINDS } from '../line/executor.js';
import { loadLine } from '../line/line.js';
import { acquireLease, getLease, workerName } from '../scheduler/leases.js';
import { holdRun } from '../scheduler/worker.js';
import { openStore } from '../store/events.js';
import { recoverRuns } from '../store/recovery.js';
import { newId } from '../util/ids.js';
import { repoSlug } from '../util/paths.js';
import { parseIssue } from './issue.js';

/**
 * What the run needs to (re)start: plain data, saved with the run so any process can
 * pick it up. Live things (provider objects, callbacks, a signal) are passed separately.
 * @typedef {Object} JobRequest
 * @property {string} issueFile
 * @property {string} repo
 * @property {string} [base]
 * @property {string} [line]                'default' | 'quick' | a .json file (Phase F07)
 * @property {string} [autonomy]            'L0'…'L3' (Phase F12; default: the operator's config)
 * @property {{ kind: 'github', owner: string, name: string, apiUrl?: string }} [forge]   Phase F15
 * @property {{ number: number, ref: string, title: string, body: string, labels: string[] }} [issue]   Phase F15: an issue read from GitHub
 * @property {string} [driver]
 * @property {boolean} [allowUnsandboxed]
 * @property {{ model?: string, provider?: string, script?: string, permissionMode?: string,
 *              allowedTools?: string[], disallowedTools?: string[], limits?: object }} [agent]
 */

/**
 * @typedef {Object} Live
 * @property {object} [provider]            the BUILDER's provider object (tests); never saved
 * @property {Record<string, object>} [providers]   Phase F07: provider objects per station kind
 * @property {(e: object) => void} [onEvent]
 * @property {AbortSignal} [signal]
 * @property {(line: string) => void} [log]
 * @property {() => void} [guard]           Phase F06: throws if our lease is gone; called before side effects
 * @property {number} [budgetUsd]           Phase F06: the most this attempt may spend
 */

/** Create the item (once per issue) and return what a run needs. */
function prepare(store, request, forge) {
  loadLine(request.line ?? 'default', KINDS()); // a bad line fails NOW, not when the run starts
  const repo = normalizeRepo(request.repo); // a path, or (Phase F15) a clone URL
  // Phase F15: a GitHub issue already exists (read by the webhook or the poller); a local one is filed from its file.
  const gh = request.forge?.kind === 'github' ? request.forge : null;
  const slug = gh ? `github-${gh.owner}-${gh.name}` : repoSlug(repo);
  const parsed = request.issue ?? parseIssue(fs.readFileSync(request.issueFile, 'utf8'));
  // The forge is only needed to FILE a local issue: don't build one (a GitHub client needs a token) otherwise.
  const issue = request.issue ?? (forge ?? forgeFor(request, { env: store.env })).fileIssue(slug, { ...parsed, source: path.resolve(request.issueFile) });
  // One item per issue: the key makes a second "item.created" for the same issue a no-op.
  const itemId = `${slug}#${issue.number}`;
  store.append(`item:${itemId}`, 'item.created', { itemId, ref: issue.ref, slug, repo, title: issue.title, number: issue.number }, { key: `item:${itemId}` });
  const saved = { ...savableRequest(request), repo, issueFile: request.issueFile && path.resolve(request.issueFile) };
  return { issue, itemId, slug, saved, priority: parsed.priority };
}

/**
 * Start a new run for an issue file, right here, right now (`factory run`).
 * @param {import('../store/events.js').Store} store
 * @param {JobRequest} request
 * @param {{ live?: Live, forge?: any }} [deps]
 */
export async function startJob(store, request, { live = {}, forge } = {}) {
  const { issue, itemId, saved } = prepare(store, request, forge);
  const runId = newId('run');
  store.append(`run:${runId}`, 'run.started', { runId, itemId, title: issue.title, pid: process.pid, host: os.hostname(), request: saved });
  return executeHeld(store, runId, { live, forge, worker: workerName('cli') }); // no forge given → the run's own (executeRun)
}

/**
 * Phase F06: put a run in the QUEUE (`factory submit`); `factory serve` will run it.
 * @param {import('../store/events.js').Store} store
 * @param {JobRequest} request
 * @param {{ forge?: any, priority?: number }} [deps]
 */
export function submitJob(store, request, { forge, priority, key } = {}) {
  // Phase F15: `key` (e.g. a webhook's delivery id) makes a redelivery a no-op. Returns null then.
  if (key && store.hasKey(key)) return null;
  const { issue, itemId, slug, saved, priority: fromIssue } = prepare(store, request, forge);
  const runId = newId('run');
  store.append(`run:${runId}`, 'run.queued', { runId, itemId, slug, title: issue.title, priority: priority ?? priorityOf(fromIssue), request: saved }, key ? { key } : undefined);
  return runId;
}

/** "high" / "low" / a number, from the issue's frontmatter. */
export function priorityOf(value) {
  if (value === undefined || value === '') return 0;
  const named = { urgent: 20, high: 10, normal: 0, low: -10 }[String(value).toLowerCase()];
  return named ?? (Number(value) || 0);
}

/**
 * Try a run again. Phase F07: `from` rewinds it to a station (that station and the ones
 * after it start over; earlier results are kept).
 * @param {import('../store/events.js').Store} store
 * @param {string} runId
 * @param {{ live?: Live, forge?: any, from?: string }} [deps]
 */
export async function retryRun(store, runId, { live, forge, from } = {}) {
  recoverRuns(store); // a "running" run whose worker died is interrupted, not running
  const run = store.get('runs', runId);
  if (!run) throw new Error(`No run "${runId}". See: factory runs`);
  if (run.status === 'running') throw new Error(`Run ${runId} is still running (pid ${run.pid}).`);
  if (run.status === 'cancelled') throw new Error(`Run ${runId} was cancelled.`);
  if (run.status === 'queued') throw new Error(`Run ${runId} is queued: \`factory serve\` will run it.`);
  if (run.status === 'delivered' && !from) throw new Error(`Run ${runId} was delivered: nothing to retry. Use --from <station> to redo part of it.`);
  if (from) {
    const ids = loadLine(run.request.line ?? 'default', KINDS()).stations.map((s) => s.id);
    if (!ids.includes(from)) throw new Error(`The line has no station "${from}" (it has: ${ids.join(', ')}).`);
    store.append(`run:${runId}`, 'run.rewound', { runId, from, reset: ids.slice(ids.indexOf(from)) });
  }
  store.append(`run:${runId}`, 'run.retried', { runId, pid: process.pid, host: os.hostname(), attempt: run.attempt + 1 });
  return executeHeld(store, runId, { live, forge: forge ?? forgeFor(run.request, { env: store.env }), worker: workerName('cli') });
}

/**
 * Phase F12: carry on with a run that is back in the queue (after `factory approve`),
 * here and now, instead of waiting for `factory serve`.
 * @param {import('../store/events.js').Store} store
 * @param {string} runId
 * @param {{ live?: Live, forge?: any }} [deps]
 */
export async function continueRun(store, runId, { live, forge } = {}) {
  const run = store.get('runs', runId);
  if (!run) throw new Error(`No run "${runId}".`);
  if (run.status !== 'queued') throw new Error(`Run ${runId} is ${run.status}, not waiting in the queue.`);
  const worker = workerName('cli');
  store.append(`run:${runId}`, 'run.leased', { runId, worker, pid: process.pid, host: os.hostname(), attempt: run.attempt + 1 });
  return executeHeld(store, runId, { live, forge: forge ?? forgeFor(run.request, { env: store.env }), worker });
}

/**
 * Take the lease (as `worker`), hold it while executing, give it back after.
 * Used by `factory run` and `factory run retry`. The scheduler takes its own
 * lease, then calls executeRun (scheduler.js).
 */
async function executeHeld(store, runId, { live = {}, forge, worker }) {
  const config = loadFactoryConfig(store.env);
  const lease = acquireLease(store.db, runId, { worker, ttlMs: config.leaseTtlMs });
  if (!lease) throw new Error(`Run ${runId} is held by ${getLease(store.db, runId)?.worker}.`);
  const held = holdRun(store, lease, { ttlMs: config.leaseTtlMs, heartbeatMs: config.heartbeatMs, signal: live.signal });
  try {
    return await executeRun(store, runId, { live: { ...live, signal: held.signal, guard: held.guard }, forge });
  } finally {
    held.release();
  }
}

/**
 * Carry the run forward through its line, from wherever its events say it is.
 * @param {import('../store/events.js').Store} store
 * @param {string} runId
 * @param {{ live?: Live, forge?: any }} [deps]
 */
export async function executeRun(store, runId, { live = {}, forge } = {}) {
  const run = store.get('runs', runId);
  forge ??= forgeFor(run.request, { env: store.env }); // Phase F15: local, or GitHub
  const item = store.get('items', run.itemId);
  const issue = await forge.getIssue(item.slug, Number(item.ref.split('#')[1]));
  if (!issue) throw new Error(`The issue ${item.ref} is missing from the forge.`);
  (live.log ?? (() => {}))(`run ${runId} (attempt ${run.attempt}, line ${run.request.line ?? 'default'}) · ${issue.ref}: ${issue.title}`);

  const outcome = await executeLine(store, runId, { live, forge, issue });
  if (outcome.status === 'error') throw new Error(outcome.reason ?? 'the run failed');
  return summary(store, runId, issue, outcome.status);
}

/** One object describing how the run went (the shape F03–F06 callers use). */
export function summary(store, runId, issue, status) {
  const run = store.get('runs', runId);
  const build = run.steps.build?.result;
  const verify = run.steps.verify?.status === 'done' ? run.steps.verify.result : null;
  const deliver = run.steps.deliver?.status === 'done' ? run.steps.deliver.result : null;
  const step = build && { result: build.agent, workspace: build.workspace, commits: build.commits, stat: build.stat, branch: build.branch, kept: build.kept, gates: verify?.gates ?? null };
  return { runId, status, issue, item: `issue-${issue.number}`, step, pr: deliver?.pr ?? null, head: deliver?.head ?? null, triage: run.steps.triage?.result ?? null, run };
}

/** Only what can be saved as JSON and reused later: never provider objects, functions or secrets. */
function savableRequest(request) {
  const agent = request.agent ?? {};
  const { model, script, permissionMode, allowedTools, disallowedTools, limits } = agent;
  const provider = typeof agent.provider === 'string' ? agent.provider : undefined;
  return JSON.parse(
    JSON.stringify({
      issueFile: request.issueFile,
      repo: request.repo,
      base: request.base,
      line: request.line,
      forge: request.forge, // Phase F15: { kind: 'github', owner, name }
      autonomy: request.autonomy,
      routing: request.routing, // Phase F22: a routing policy name
      campaign: request.campaign, // Phase F25: the campaign this item belongs to
      driver: request.driver,
      allowUnsandboxed: request.allowUnsandboxed,
      agent: { model, provider, script: script && path.resolve(script), permissionMode, allowedTools, disallowedTools, limits },
    }),
  );
}

/**
 * The simple entry point: open the store, start a run, close the store.
 * @param {JobRequest & { log?: (l: string) => void, agent?: any, providers?: Record<string, object> }} job
 * @param {{ env?: NodeJS.ProcessEnv, forge?: any, store?: import('../store/events.js').Store }} [deps]
 */
export async function runJob(job, { env = process.env, forge, store } = {}) {
  const own = !store;
  const s = store ?? openStore({ env });
  try {
    const { provider, onEvent, signal, ...agent } = job.agent ?? {};
    const live = { provider: typeof provider === 'object' ? provider : undefined, providers: job.providers, onEvent, signal, log: job.log, remote: job.remote }; // remote: Phase F23
    return await startJob(s, { ...job, agent: { ...agent, provider: typeof provider === 'string' ? provider : undefined } }, { live, forge: forge ?? forgeFor(job, { env }) });
  } finally {
    if (own) s.close();
  }
}
