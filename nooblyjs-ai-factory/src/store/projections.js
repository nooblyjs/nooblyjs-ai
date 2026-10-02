// @ts-check
// Phase F05: PROJECTIONS. Current state, derived from the event log.
//
// The event log says what HAPPENED ("run r1 started", "step build finished",
// "run r1 finished: delivered"). Most questions are about what IS ("which runs
// are still running?"). A projection answers that by folding events into a
// row, one event at a time, with a pure function:
//
//   reduce(row, event) → row          no I/O, no clock, no randomness
//
// Because it's pure and the log is complete, the tables are DISPOSABLE:
// delete them, replay every event through the same reducers, and you get the
// same tables back (`factory db rebuild`). That's how you fix a projection
// bug, or add a new one, without losing history.
//
// Rows are stored as JSON (id, data, seq). Simple to read, easy to rebuild;
// indexes on specific fields can come later if a query gets slow.

/**
 * @typedef {{ seq: number, stream: string, type: string, data: any, at: string, key: string | null }} FactoryEvent
 * @typedef {{ table: string, keyOf: (e: FactoryEvent) => string | null, reduce: (row: any, e: FactoryEvent) => any }} Projection
 */

/** @type {Projection} One row per work item (an issue). */
export const items = {
  table: 'items',
  keyOf: (e) => e.data.itemId ?? null,
  reduce(row, e) {
    switch (e.type) {
      case 'item.created':
        return { id: e.data.itemId, ref: e.data.ref, slug: e.data.slug, repo: e.data.repo, title: e.data.title, createdAt: e.at, runs: [], lastStatus: null };
      case 'run.started':
      case 'run.queued':
        return row && { ...row, runs: [...row.runs, e.data.runId] };
      case 'run.finished':
        return row && { ...row, lastStatus: e.data.status };
      default:
        return row;
    }
  },
};

/** @type {Projection} One row per run: its status, attempts, steps and cost. */
export const runs = {
  table: 'runs',
  keyOf: (e) => (e.type.startsWith('run.') || e.type.startsWith('step.') || ['workspace.acquired', 'artifact.stored', 'repair.attempted', 'scope.granted', 'pr.changes_requested'].includes(e.type) ? (e.data.runId ?? null) : null),
  reduce(row, e) {
    const step = (name, patch) => ({ ...row, steps: { ...row.steps, [name]: { ...row.steps[name], ...patch } } });
    switch (e.type) {
      case 'run.started': // Phase F05: created and running at once (factory run)
        return { ...newRun(e), status: 'running', attempt: 1, pid: e.data.pid, host: e.data.host ?? null, startedAt: e.at };
      case 'run.queued': // Phase F06: created, waiting for the scheduler (factory submit)
        return { ...newRun(e), status: 'queued', attempt: 0, pid: null, host: null, startedAt: null, priority: e.data.priority ?? 0, slug: e.data.slug };
      case 'run.leased': // Phase F06: a worker took it
        return row && { ...row, status: 'running', attempt: row.attempt + 1, pid: e.data.pid, host: e.data.host, worker: e.data.worker, startedAt: row.startedAt ?? e.at, endedAt: null, interruptedReason: undefined };
      case 'run.requeued': // Phase F06: back in the queue (its lease was lost, or it was resumed)
        return row && { ...row, status: 'queued', pid: null, worker: null };
      case 'run.cancel_requested':
        return row && { ...row, cancelRequested: true };
      case 'run.retried':
        return row && { ...row, status: 'running', attempt: row.attempt + 1, pid: e.data.pid, host: e.data.host ?? row.host, endedAt: null, interruptedReason: undefined };
      case 'run.interrupted':
        return row && { ...row, status: 'interrupted', interruptedReason: e.data.reason, endedAt: e.at };
      case 'run.finished':
        return row && { ...row, status: e.data.status, pr: e.data.pr ?? null, head: e.data.head ?? null, endedAt: e.at };
      case 'step.started':
        return row && step(e.data.step, { status: 'running', attempt: row.attempt, tries: (row.steps[e.data.step]?.tries ?? 0) + 1, startedAt: e.at });
      case 'workspace.acquired':
        return row && step(e.data.step, { workspace: e.data.workspace });
      case 'step.finished': {
        if (!row) return row; // an event for a run we don't know: nothing to update
        const next = { ...step(e.data.step, { status: 'done', result: e.data.result, endedAt: e.at }), costUsd: row.costUsd + (e.data.result?.costUsd ?? 0) };
        // Phase F13: a NEW build makes earlier repairs meaningless (they were fixes to the old one).
        return e.data.result && 'commits' in e.data.result && e.data.step === 'build' ? { ...next, repairs: [] } : next;
      }
      case 'run.merged': // Phase F15: a person (or L3) merged the PR on the forge
        return row && { ...row, status: 'merged', mergedSha: e.data.sha, mergedBy: e.data.by };
      case 'pr.changes_requested': // Phase F15: a person's review on the PR, for the fixer
        return row && { ...row, humanReview: { body: e.data.body, by: e.data.by, at: e.at } };
      case 'scope.granted': // Phase F14/F16: a person (or L3) let the run touch more paths
        return row && { ...row, scopeGranted: [...new Set([...(row.scopeGranted ?? []), ...e.data.paths])] };
      case 'repair.attempted': // Phase F13: kept outside step results, so a rewind doesn't forget them
        return row && { ...row, humanReview: e.data.trigger === 'human' ? null : row.humanReview, repairs: [...(row.repairs ?? []), { attempt: e.data.attempt, signature: e.data.signature, trigger: e.data.trigger, title: e.data.title, outcome: e.data.outcome, sha: e.data.sha, branch: e.data.branch, stat: e.data.stat, summary: e.data.summary, costUsd: e.data.costUsd }], costUsd: row.costUsd };
      case 'step.failed': // Phase F07: failures are counted per station, for its retry policy
        return row && step(e.data.step, { status: 'failed', error: e.data.error, failures: (row.steps[e.data.step]?.failures ?? 0) + 1, endedAt: e.at });
      case 'run.rewound': // Phase F07: `factory run retry --from <station>`: these stations start over
        return row && { ...row, steps: Object.fromEntries(Object.entries(row.steps).map(([id, st]) => [id, e.data.reset.includes(id) ? { status: 'pending', tries: st.tries } : st])) };
      case 'run.pause_requested':
        return row && { ...row, pauseRequested: true };
      case 'run.paused':
        return row && { ...row, status: 'paused', pauseRequested: false, pid: null, worker: null };
      case 'run.resumed':
        return row && { ...row, status: 'queued', pauseRequested: false, parkedOn: null };
      case 'run.parked': // Phase F12: waiting for a human; holds no lease, no slot, no tokens
        return row && { ...row, status: 'parked', parkedOn: e.data.inboxId, pid: null, worker: null };
      case 'artifact.stored':
        return row && { ...row, artifacts: [...row.artifacts, { sha: e.data.sha, kind: e.data.kind, name: e.data.name, bytes: e.data.bytes }] };
      default:
        return row;
    }
  },
};

/** A new run row: the fields every run has, whichever way it was created. */
function newRun(e) {
  return { id: e.data.runId, itemId: e.data.itemId, title: e.data.title, request: e.data.request, queuedAt: e.at, endedAt: null, costUsd: 0, steps: {}, artifacts: [], pr: null, head: null, cancelRequested: false };
}

/** @type {Projection} One row per side effect (a push, a PR): intended, then done. */
export const effects = {
  table: 'effects',
  keyOf: (e) => (e.type.startsWith('effect.') ? e.data.key : null),
  reduce(row, e) {
    if (e.type === 'effect.intended') return { key: e.data.key, kind: e.data.kind, runId: e.data.runId, status: 'intended', intendedAt: e.at, result: null };
    if (e.type === 'effect.done') return row && { ...row, status: 'done', result: e.data.result, reconciled: Boolean(e.data.reconciled), doneAt: e.at };
    return row;
  },
};

/** @type {Projection} Phase F12: the human inbox: approvals, questions, policy gaps. */
export const inbox = {
  table: 'inbox',
  keyOf: (e) => (e.type.startsWith('inbox.') ? e.data.inboxId : null),
  reduce(row, e) {
    if (e.type === 'inbox.opened') return { id: e.data.inboxId, runId: e.data.runId, kind: e.data.kind, gate: e.data.gate ?? null, title: e.data.title, body: e.data.body ?? '', detail: e.data.detail ?? null, status: 'open', openedAt: e.at, answer: null };
    if (e.type === 'inbox.answered') return row && { ...row, status: e.data.decision, answer: e.data.answer ?? null, feedback: e.data.feedback ?? null, by: e.data.by ?? null, answeredAt: e.at };
    return row;
  },
};

/** @type {Projection} Phase F06: the factory's own state. One row, id 'factory': is everything stopped? */
export const system = {
  table: 'system',
  keyOf: (e) => (e.type.startsWith('system.') ? 'factory' : null),
  reduce(row, e) {
    if (e.type === 'system.stop_all') return { stopped: true, reason: e.data.reason ?? null, since: e.at };
    if (e.type === 'system.resume_all') return { stopped: false, reason: null, since: e.at };
    return row;
  },
};

export const PROJECTIONS = [items, runs, effects, system, inbox];

/**
 * Apply one event to every projection it concerns. Called INSIDE the append
 * transaction, so an event and its effect on the tables are saved together.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {FactoryEvent} event
 */
export function applyProjections(db, event) {
  for (const p of PROJECTIONS) {
    const id = p.keyOf(event);
    if (!id) continue;
    const current = /** @type {any} */ (db.prepare(`SELECT data FROM ${p.table} WHERE id = ?`).get(id));
    const next = p.reduce(current ? JSON.parse(current.data) : null, event);
    if (next) db.prepare(`INSERT INTO ${p.table} (id, data, seq) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, seq = excluded.seq`).run(id, JSON.stringify(next), event.seq);
  }
}

/** Drop every projection table's rows and replay the whole log. Returns row counts. */
export function rebuildProjections(db, readAll) {
  for (const p of PROJECTIONS) db.exec(`DELETE FROM ${p.table}`);
  for (const event of readAll()) applyProjections(db, event);
  return Object.fromEntries(PROJECTIONS.map((p) => [p.table, /** @type {any} */ (db.prepare(`SELECT COUNT(*) AS n FROM ${p.table}`).get()).n]));
}
