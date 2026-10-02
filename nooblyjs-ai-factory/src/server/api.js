// @ts-check
// Phase F17: the dashboard's JSON API. Every answer comes from the event log and its
// projections, the same functions the CLI uses (status, logs, inbox, cancel…), so the
// page and the terminal can never disagree.
//
//   GET  /api/status                 stopped? spend today, running, queued (and why), the line
//   GET  /api/runs                   recent runs, with the station each is at
//   GET  /api/runs/:id               one run: its steps, its story, agent output, evidence
//   GET  /api/inbox                  what's waiting for a person
//   GET  /api/events                 SSE: the event log, live (sse.js)
//   GET  /api/runs/:id/artifacts/:sha  one artifact's text, to download
//   POST /api/inbox/:id              { decision, answer?, feedback? }
//   POST /api/runs/:id/:action       cancel | pause | resume | retry ({ from })
//   POST /api/stop-all, /api/resume-all
import { loadFactoryConfig } from '../config/factory-config.js';
import { describe } from '../commands/history.js';
import { answerEntry, openEntries } from '../humans/inbox.js';
import { KINDS } from '../line/executor.js';
import { loadLine } from '../line/line.js';
import { spentToday } from '../scheduler/budgets.js';
import { cancelRun, isStopped, pauseRun, resumeAll, resumeRun, stopAll } from '../scheduler/kill-switch.js';
import { pickRuns } from '../scheduler/pick.js';
import { getArtifact } from '../store/artifacts.js';
import { factoryMetrics } from '../metrics/factory-metrics.js';
import { campaignStartsToday, campaignStatus } from '../campaign/campaign.js';
import { streamEvents } from './sse.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (e) => String(describe(e) ?? '').replace(ANSI, '');
const ACTIVE = ['queued', 'running', 'parked', 'paused'];

/** Where a run is on its line: the running station, else the last one that finished. */
export function stationOf(run) {
  const steps = Object.entries(run.steps ?? {});
  const running = steps.find(([, s]) => s.status === 'running');
  if (running) return running[0];
  const done = steps.filter(([, s]) => s.endedAt).sort((a, b) => String(a[1].endedAt).localeCompare(String(b[1].endedAt)));
  return done.at(-1)?.[0] ?? null;
}

/** Who did each station of a run, on which model: the last route.decided per step. */
function routesOf(events) {
  const out = {};
  for (const e of events) if (e.type === 'route.decided') out[e.data.step] = { role: e.data.role, model: e.data.model ?? null, tier: e.data.tier ?? null };
  return out;
}

const brief = (r) => ({ id: r.id, title: r.title, status: r.status, station: stationOf(r), costUsd: r.costUsd ?? 0, queuedAt: r.queuedAt, startedAt: r.startedAt, endedAt: r.endedAt, pr: r.pr, head: r.head, parkedOn: r.parkedOn ?? null, attempt: r.attempt, line: r.request?.line ?? 'default', repairs: (r.repairs ?? []).length });

/**
 * @param {{ store: import('../store/events.js').Store, env?: NodeJS.ProcessEnv, extra?: Array<[string, string, Function]> }} options
 * @returns {Array<[string, string, (ctx: any) => any]>}
 */
export function apiRoutes({ store, env = process.env, extra = [] }) {
  const config = () => loadFactoryConfig(env);
  const runOr404 = (id) => {
    const run = store.get('runs', id);
    if (!run) throw Object.assign(new Error(`No run "${id}".`), { status: 404 });
    return run;
  };
  const lines = {};
  const lineOf = (name) => (lines[name] ??= loadLine(name, KINDS()).stations.map((s) => ({ id: s.id, kind: s.kind })));

  return [
    ['GET', '/api/status', () => {
      const c = config();
      const runs = store.list('runs');
      const running = runs.filter((r) => r.status === 'running');
      // The line's cards show who is at work and what they did last.
      const live = (r) => {
        const events = store.read({ stream: `run:${r.id}` });
        const station = stationOf(r);
        const last = events.findLast((e) => e.type === 'agent.event');
        return { ...brief(r), route: routesOf(events)[station] ?? null, lastLine: last ? plain(last) : null };
      };
      const queued = runs.filter((r) => r.status === 'queued');
      const now = Date.now();
      const stopped = isStopped(store);
      const why = pickRuns({ queued, running, config: c, spentAll: spentToday(store, now), spentBySlug: {}, stopped, campaignToday: campaignStartsToday(store, now) });
      const counts = {};
      for (const r of runs) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return {
        json: {
          stopped,
          spentToday: spentToday(store, now),
          dailyBudgetUsd: c.dailyBudgetUsd,
          maxConcurrent: c.maxConcurrent,
          line: lineOf('default'),
          counts,
          inbox: openEntries(store).length,
          running: running.map(live),
          queued: queued.map((r) => ({ ...brief(r), waiting: why.waiting.find((w) => w.runId === r.id)?.reason ?? 'starts at the next tick (is factory serve running?)' })),
          parked: runs.filter((r) => r.status === 'parked' || r.status === 'paused').map(brief),
          seq: store.read().at(-1)?.seq ?? 0,
        },
      };
    }],

    ['GET', '/api/runs', ({ query }) => {
      const runs = store.list('runs').sort((a, b) => String(b.queuedAt).localeCompare(String(a.queuedAt)) || (a.id < b.id ? 1 : -1));
      return { json: { runs: runs.slice(0, Number(query.limit ?? 50)).map(brief) } };
    }],

    ['GET', '/api/runs/:id', ({ params }) => {
      const run = runOr404(params.id);
      const events = store.read({ stream: `run:${run.id}` });
      const text = (kind) => [...run.artifacts].reverse().find((a) => a.kind === kind);
      const artifact = (kind) => {
        const a = text(kind);
        return a ? getArtifact(a.sha, env)?.toString('utf8') ?? null : null;
      };
      const routes = routesOf(events);
      const steps = lineOf(run.request?.line ?? 'default').map((s) => {
        const st = run.steps?.[s.id] ?? { status: 'pending' };
        return { id: s.id, kind: s.kind, status: st.status, tries: st.tries ?? 0, costUsd: st.result?.costUsd ?? 0, startedAt: st.startedAt ?? null, endedAt: st.endedAt ?? null, error: st.error ?? null, result: summarise(st.result), route: routes[s.id] ?? null };
      });
      return {
        json: {
          run: brief(run),
          steps,
          story: events.filter((e) => e.type !== 'agent.event').map((e) => ({ seq: e.seq, at: e.at, type: e.type, line: plain(e) })),
          agent: events.filter((e) => e.type === 'agent.event').slice(-200).map((e) => ({ seq: e.seq, at: e.at, step: e.data.step, line: plain(e) })),
          inbox: store.list('inbox').filter((e) => e.runId === run.id),
          evidence: artifact('pr'),
          artifacts: run.artifacts.map(({ kind, name, bytes, sha }) => ({ kind, name, bytes, sha: sha.slice(0, 12) })),
        },
      };
    }],

    ['GET', '/api/runs/:id/artifacts/:sha', ({ params }) => {
      const a = runOr404(params.id).artifacts.find((x) => x.sha.startsWith(params.sha));
      const content = a && getArtifact(a.sha, env);
      if (!content) throw Object.assign(new Error(`No artifact "${params.sha}" on this run.`), { status: 404 });
      return { json: { name: a.name, kind: a.kind, text: content.toString('utf8') } };
    }],

    // Phase F20: the metrics page (read-only: it doesn't look for merges in git; `factory metrics` does).
    ['GET', '/api/metrics', ({ query }) => ({ json: factoryMetrics(store.read(), { since: query.since ?? '7d' }) })],

    // Phase F25: campaigns: done / open / failed per repo.
    ['GET', '/api/campaigns', () => ({ json: { campaigns: campaignStatus(store) } })],

    ['GET', '/api/inbox', () => ({ json: { entries: openEntries(store) } })],

    ['POST', '/api/inbox/:id', ({ params, body }) => {
      const decision = body?.decision ?? (body?.answer ? 'answered' : null);
      if (!['approved', 'rejected', 'answered', 'dismissed'].includes(decision)) throw new Error('decision must be approved, rejected, answered or dismissed.');
      const entry = answerEntry(store, params.id, decision, { answer: body.answer, feedback: body.feedback, by: `${env.USER ?? 'operator'} (dashboard)` });
      const run = store.get('runs', entry.runId);
      if (run?.status === 'parked') resumeRun(store, entry.runId);
      return { json: { entry, resumed: run?.status === 'parked' } };
    }],

    ['POST', '/api/runs/:id/:action', ({ params, body }) => {
      const run = runOr404(params.id);
      if (params.action === 'cancel') cancelRun(store, run.id);
      else if (params.action === 'pause') pauseRun(store, run.id);
      else if (params.action === 'resume') resumeRun(store, run.id);
      else if (params.action === 'retry') requeueFrom(store, run, body?.from, lineOf(run.request?.line ?? 'default'));
      else throw Object.assign(new Error(`Unknown action "${params.action}".`), { status: 404 });
      return { json: { run: brief(store.get('runs', run.id)) } };
    }],

    ['POST', '/api/stop-all', () => (stopAll(store, 'dashboard stop-all'), { json: { stopped: true } })],
    ['POST', '/api/resume-all', () => (resumeAll(store), { json: { stopped: false } })],

    ['GET', '/api/events', ({ req, res, query }) => {
      streamEvents(store, req, res, { after: query.after ? Number(query.after) : undefined, map: (e) => ({ seq: e.seq, at: e.at, type: e.type, runId: e.data?.runId ?? null, line: plain(e) }) });
      return { stream: true };
    }],
    ...extra,
  ];
}

/** Retry from the dashboard: rewind to a station and put the run back in the QUEUE (factory serve runs it). */
export function requeueFrom(store, run, from, stations) {
  if (ACTIVE.includes(run.status)) throw new Error(`Run ${run.id} is ${run.status}: only a finished run can be retried.`);
  const ids = stations.map((s) => s.id);
  const start = from ?? ids.find((id) => run.steps?.[id]?.status !== 'done') ?? ids.at(-1);
  if (!ids.includes(start)) throw new Error(`No station "${start}" on this run's line.`);
  store.append(`run:${run.id}`, 'run.rewound', { runId: run.id, from: start, reset: ids.slice(ids.indexOf(start)), feedback: null });
  store.append(`run:${run.id}`, 'run.requeued', { runId: run.id, reason: `retry from ${start} (dashboard)` });
}

/** The interesting parts of a step result, not all of it. */
function summarise(r) {
  if (!r) return null;
  const out = {};
  if (r.outcome) out.outcome = r.outcome;
  if ('passed' in r) out.passed = r.passed;
  if (r.gates) out.gates = (r.gates.results ?? r.gates).map?.((g) => ({ name: g.name, status: g.status, command: g.command ?? null, summary: g.summary ?? null }));
  if (r.verdict) out.verdict = r.verdict;
  if (r.findings) out.findings = r.findings.map((f) => ({ severity: f.severity, title: f.title, file: f.file ?? null }));
  if (r.scope) out.scope = { ok: r.scope.ok, violations: r.scope.violations?.length ?? 0 };
  if (r.status) out.status = r.status;
  if (r.kind) out.kind = r.kind;
  if (r.text) out.text = String(r.text).slice(0, 400);
  return out;
}
