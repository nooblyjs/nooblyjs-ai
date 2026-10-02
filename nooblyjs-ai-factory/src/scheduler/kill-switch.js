// @ts-check
// Phase F06: STOP. The big red button, and the small one.
//
//   factory stop-all      system.stop_all: no new runs start; every worker aborts what it's doing
//   factory resume-all    system.resume_all: the scheduler starts runs again
//   factory cancel <run>  a queued run is cancelled at once; a running one is asked to stop
//
// These are EVENTS, not signals to a process: `factory stop-all` may run in a
// different terminal (or, later, machine) than the workers. Every worker checks
// at each heartbeat whether it should stop, so the button works within one
// heartbeat, wherever the work is running.
//
// Stopped runs end "interrupted (stopped)" and are NOT requeued automatically
// after resume-all: stopping was a human decision, so restarting them is one too
// (factory run retry). Workspaces are kept.

/** @param {import('../store/events.js').Store} store */
export function isStopped(store) {
  return Boolean(store.get('system', 'factory')?.stopped);
}

export function stopAll(store, reason = 'factory stop-all') {
  store.append('system', 'system.stop_all', { reason });
}

export function resumeAll(store) {
  store.append('system', 'system.resume_all', {});
}

/**
 * @returns {'cancelled' | 'requested' | 'finished'}  cancelled now (it was queued), asked to stop (running), or nothing to do
 */
export function cancelRun(store, runId) {
  const run = store.get('runs', runId);
  if (!run) throw new Error(`No run "${runId}".`);
  if (['queued', 'interrupted', 'paused', 'parked'].includes(run.status)) { // Phase F18: parked too (it holds nothing, so it can just end)
    store.append(`run:${runId}`, 'run.finished', { runId, itemId: run.itemId, status: 'cancelled' });
    return 'cancelled';
  }
  if (run.status === 'running') {
    store.append(`run:${runId}`, 'run.cancel_requested', { runId }, { key: `run:${runId}:cancel:${run.attempt}` });
    return 'requested';
  }
  return 'finished';
}

/** Why should the worker holding this run stop, if at all? (checked at every heartbeat) */
export function stopReason(store, runId) {
  if (isStopped(store)) return 'stopped';
  if (store.get('runs', runId)?.cancelRequested) return 'cancelled';
  return null;
}

/**
 * Phase F07: PAUSE between stations. A queued run pauses at once; a running one
 * finishes the station it's on, then stops (its lease is released, nothing is lost).
 * @returns {'paused' | 'requested' | 'finished'}
 */
export function pauseRun(store, runId) {
  const run = store.get('runs', runId);
  if (!run) throw new Error(`No run "${runId}".`);
  if (run.status === 'queued' || run.status === 'interrupted') {
    store.append(`run:${runId}`, 'run.paused', { runId });
    return 'paused';
  }
  if (run.status === 'running') {
    store.append(`run:${runId}`, 'run.pause_requested', { runId });
    return 'requested';
  }
  return 'finished';
}

/**
 * Phase F07: a paused run goes back in the queue (factory serve carries on from its next station).
 * Phase F12: …and so does a PARKED one, once a person has answered.
 */
export function resumeRun(store, runId) {
  const run = store.get('runs', runId);
  if (!run) throw new Error(`No run "${runId}".`);
  if (run.status !== 'paused' && run.status !== 'parked' && !run.pauseRequested) throw new Error(`Run ${runId} isn't paused or parked (it is ${run.status}).`);
  store.append(`run:${runId}`, 'run.resumed', { runId });
}
