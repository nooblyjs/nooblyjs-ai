// @ts-check
// Phase F07: THE LINE ENGINE. What should this run do next?
//
//   decide(run, line) → { action: 'run', station }       do this station (again)
//                     | { action: 'finish', status }     the run is over
//                     | { action: 'pause' }              stop between stations; wait for `factory resume`
//
// A PURE function of the run's state (a projection of its events) and the line.
// It never does anything. The executor (executor.js) does what it says, records
// what happened as events, and asks again. That split is the point:
//
//   - every behaviour of every line is a TABLE TEST: "these steps so far → this next action"
//   - after a crash there's nothing to restore: the events say where the run is, decide() says what's next
//   - the same engine will drive any line: default, quick, spec-driven (F08), fan-out (F10)
//
// Rules, station by station, in line order:
//
//   when false                        skip it (and its result doesn't exist)
//   never started / pending           → run it
//   running (no one is: we're deciding) → the last attempt died: run it again
//   failed                            → retry while failures ≤ retries; then optional? skip : finish 'error'
//   done, result says stop            → finish with that status (triage said "unclear", build changed nothing…)
//   done                              → next station
//   all done                          → finish with the last station's status
//
// "Failed" means something BROKE (an exception). A station that worked and
// said "no" (triage: out of scope) is DONE with a stop, not failed. Only
// breakage is retried: asking again won't change a considered "no".

/**
 * The context `when` conditions see: each done station's result, by id, plus the run.
 * @param {any} run
 */
export function contextOf(run, extra = {}) {
  const ctx = { ...extra, run: { attempt: run.attempt, title: run.title, humanReview: run.humanReview ?? null }, request: run.request ?? {} };
  for (const [id, step] of Object.entries(run.steps ?? {})) if (step.status === 'done') ctx[id] = step.result;
  return ctx;
}

/**
 * @param {any} run                                     a row of the runs projection
 * @param {import('./line.js').Line} line
 * @param {object} [extra]  more for `when` conditions to see (Phase F12: { autonomy: 'L2' })
 * @returns {{ action: 'run', station: import('./line.js').Station } | { action: 'finish', status: string, reason?: string } | { action: 'pause' }}
 */
export function decide(run, line, extra = {}) {
  if (run.pauseRequested) return { action: 'pause' };
  const ctx = contextOf(run, extra);
  let last = null;
  for (const station of line.stations) {
    if (!station.applies(ctx)) continue;
    const step = run.steps?.[station.id];
    if (!step || step.status === 'pending' || step.status === 'running') return { action: 'run', station };
    if (step.status === 'failed') {
      if ((step.failures ?? 1) <= station.retries) return { action: 'run', station };
      if (station.optional) continue;
      return { action: 'finish', status: 'error', reason: `${station.id}: ${step.error}` };
    }
    // done
    if (step.result?.stop) return { action: 'finish', status: step.result.stop.status, reason: step.result.stop.reason };
    last = step.result;
    ctx[station.id] = step.result;
  }
  return { action: 'finish', status: last?.status ?? 'done' };
}
