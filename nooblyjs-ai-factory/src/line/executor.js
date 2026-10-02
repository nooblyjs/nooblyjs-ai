// @ts-check
// Phase F07: the EXECUTOR. Ask the engine what's next, do it, write it down, repeat.
//
//   loop:
//     run  = store.get('runs', id)         ← its state, from its events
//     next = decide(run, line)             ← pure (engine.js)
//     run a station → step.started … step.finished (or step.failed)
//     finish        → run.finished {status}
//     pause         → run.paused (a `factory resume` puts it back in the queue)
//
// Because the loop re-reads the run from the store each time, and decide() only
// looks at that, "carry on after a crash" is not a special case: a fresh
// executor asks the same question and gets the same answer.
//
// Stops from OUTSIDE (stop-all, cancel, a lost lease, Ctrl+C) abort the live
// signal. A station that was running when that happened is NOT marked done
// (a retry must not reuse half a build); the run becomes interrupted or
// cancelled, and a worker that lost its lease writes nothing at all.
import { loadFactoryConfig } from '../config/factory-config.js';
import { ensureMirror, resolveBase } from '../exec/workspace/mirror.js';
import { loadRoles } from '../roles/loader.js';
import { autonomyFor } from '../humans/autonomy.js';
import { LEASE_LOST } from '../scheduler/worker.js';
import { repoSlug } from '../util/paths.js';
import { decide } from './engine.js';
import { loadLine } from './line.js';
import * as build from './stations/build.js';
import * as approval from './stations/approval.js';
import * as merge from './stations/merge.js';
import * as repair from './stations/repair.js';
import * as review from './stations/review.js';
import * as spec from './stations/spec.js';
import { formatCoverage } from '../specs/trace.js';
import * as deliver from './stations/deliver.js';
import * as triage from './stations/triage.js';
import * as verify from './stations/verify.js';

/** Station kinds → code. */
export const STATIONS = { triage, spec, approval, build, verify, review, repair, deliver, merge };
export const KINDS = () => Object.keys(STATIONS);

/**
 * @param {import('../store/events.js').Store} store
 * @param {string} runId
 * @param {{ live?: any, forge: any, issue: any }} deps
 * @returns {Promise<{ status: string, reason?: string }>}
 */
export async function executeLine(store, runId, { live = {}, forge, issue }) {
  const stream = `run:${runId}`;
  const log = live.log ?? (() => {});
  const first = store.get('runs', runId);
  const line = loadLine(first.request.line ?? 'default', KINDS());
  const itemKey = `issue-${issue.number}`;
  const slug = repoSlug(first.request.repo);
  // Phase F09: the run's roles: built-in, then the repo's (.factory/roles at the base commit), then the operator's.
  const config = loadFactoryConfig(store.env);
  const mirror = await ensureMirror(first.request.repo, { env: store.env });
  const { sha } = await resolveBase(mirror.dir, first.request.base);
  const roles = await loadRoles({ mirrorDir: mirror.dir, sha, operator: config.roles });
  for (const role of Object.values(roles)) for (const w of role.warnings) log(`⚠ role ${role.name}: ${w}`);
  // Phase F12: how much may happen without a person? The operator decides; an issue may only lower it.
  const autonomy = autonomyFor({ config, slug, repo: first.request.repo, requested: first.request.autonomy, labels: issue.labels });
  log(`autonomy ${autonomy.level} (${autonomy.why})`);

  for (let guard = 0; guard < 100; guard++) {
    const run = store.get('runs', runId);
    const next = decide(run, line, { autonomy: autonomy.level });

    if (next.action === 'pause') {
      store.append(stream, 'run.paused', { runId }, { key: `run:${runId}:${run.attempt}:paused:${guard}` });
      log('paused (factory resume <run> to carry on)');
      return { status: 'paused' };
    }
    if (next.action === 'finish') {
      const delivered = run.steps.deliver?.status === 'done' ? run.steps.deliver.result : null;
      store.append(stream, 'run.finished', { runId, itemId: run.itemId, status: next.status, reason: next.reason, pr: delivered?.pr?.path, head: delivered?.head });
      log(`finished: ${next.status}${next.reason ? ` (${next.reason})` : ''}`);
      return { status: next.status, reason: next.reason };
    }

    const station = next.station;
    const tries = (run.steps[station.id]?.tries ?? 0) + 1;
    store.append(stream, 'step.started', { runId, step: station.id, kind: station.kind });
    log(`▶ ${station.id}${tries > 1 ? ` (try ${tries})` : ''}`);
    const results = Object.fromEntries(Object.entries(run.steps).filter(([, s]) => s.status === 'done').map(([id, s]) => [id, s.result]));
    const ctx = { store, runId, run, station, issue, itemKey, slug, request: run.request, live, forge, log, results, roles, config, autonomy, lineStations: line.stations, ...stationInputs(results) };

    try {
      const result = await STATIONS[station.kind].run(ctx);
      if (live.signal?.aborted) throw new Error('interrupted');
      // Phase F12: waiting for a person. Stop here: no lease, no slot, no tokens while we wait.
      // (The step stays "running": when the run comes back, decide() runs this station again,
      // and this time it finds the answer.)
      // Phase F16: the agent asked a person something (ask_human) and ended its turn: park on that question.
      const asked = result?.park ? null : store.list('inbox').find((e) => e.runId === runId && e.gate === `ask:${station.id}` && e.status === 'open');
      if (asked) {
        store.append(stream, 'run.parked', { runId, step: station.id, inboxId: asked.id });
        log(`parked: the agent asked "${asked.title}" (factory inbox ${asked.id})`);
        return { status: 'parked' };
      }
      if (result?.park) {
        store.append(stream, 'run.parked', { runId, step: station.id, inboxId: result.park });
        log(`parked: waiting for ${result.park} (factory inbox)`);
        return { status: 'parked' };
      }
      store.append(stream, 'step.finished', { runId, step: station.id, result });
      // Phase F12: a person rejected the work: redo it from that station, with their feedback.
      if (result?.rewind) {
        const ids = line.stations.map((s) => s.id);
        store.append(stream, 'run.rewound', { runId, from: result.rewind.from, reset: ids.slice(ids.indexOf(result.rewind.from)), feedback: result.rewind.feedback });
        log(`rewound to ${result.rewind.from}: "${result.rewind.feedback}"`);
      }
    } catch (error) {
      const reason = live.signal?.aborted ? String(live.signal.reason ?? 'interrupted') : null;
      if (reason === LEASE_LOST) return { status: 'lease_lost' }; // someone else owns the run now: write nothing
      if (reason) {
        store.append(stream, 'step.failed', { runId, step: station.id, error: `interrupted: ${reason}` });
        if (reason === 'cancelled') {
          store.append(stream, 'run.finished', { runId, itemId: run.itemId, status: 'cancelled' });
          return { status: 'cancelled' };
        }
        store.append(stream, 'run.interrupted', { runId, reason, attempt: run.attempt }, { key: `run:${runId}:${run.attempt}:interrupted` });
        return { status: 'interrupted', reason };
      }
      const message = error instanceof Error ? error.message : String(error);
      store.append(stream, 'step.failed', { runId, step: station.id, error: message });
      log(`✖ ${station.id}: ${message}`);
      // …and loop: decide() applies the station's retry policy.
    }
  }
  throw new Error(`Run ${runId}: the line did not finish after 100 steps (a loop in the line?).`);
}

/**
 * Phase F08: what later stations need from earlier ones. With a spec:
 *   build   starts FROM the spec's commit (so it can read it, and the PR contains both),
 *           but its gates come from the original base's config
 *   deliver adds a requirements-coverage table to the PR
 */
function stationInputs(results) {
  const s = results.spec;
  if (!s?.sha) return {};
  return {
    buildBase: { sha: s.sha, configSha: s.originalBaseSha, baseRef: s.baseRef },
    specDir: s.specDir,
    specTasks: s.tasks, // Phase F10: more than one → fan-out
    prSections: formatCoverage(s.trace, s.specDir),
  };
}
