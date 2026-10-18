// @ts-check
// Phase F20: what ONE run's history says, as numbers. A pure function of its events.
//
//   lead time        queued → PR delivered, and queued → merged
//   stations         time and cost at each station (all tries added up), tries, failures
//   first-pass gates did verify pass the FIRST time (before any repair)?
//   repairs, escalated, human reviews ("changes requested"), cost, final status
//   human edit       lines a person changed after the factory, before merging (when measured, see merges.js)
//
// No store, no git, no clock: events in, numbers out. So tests can feed it a synthetic
// history, and a rebuilt log gives the same numbers.

const ms = (a, b) => (a && b ? Date.parse(b) - Date.parse(a) : null);

/** @param {Array<{ type: string, at: string, data: any }>} events  one run's events, in order */
export function runMetrics(events) {
  const r = {
    runId: null, title: null, slug: null, status: 'queued', queuedAt: null, deliveredAt: null, mergedAt: null, endedAt: null,
    leadToPrMs: null, leadToMergeMs: null, costUsd: 0, stations: /** @type {Record<string, { durationMs: number, costUsd: number, tries: number, failures: number }>} */ ({}),
    firstPassGates: /** @type {boolean | null} */ (null), repairs: 0, escalated: false, humanReviews: 0, parkedMs: 0,
    humanEdit: /** @type {{ factoryLines: number, editedLines: number } | null} */ (null),
    routes: /** @type {Array<{ station: string, tier: string | null, costUsd: number, ok: boolean }>} */ ([]), // Phase F22: each routed step and how it went
  };
  const open = {};
  const routed = {}; // station → the tier route.decided picked for its next step
  let parkedAt = null;
  for (const e of events) {
    const d = e.data ?? {};
    const st = (id) => (r.stations[id] ??= { durationMs: 0, costUsd: 0, tries: 0, failures: 0 });
    switch (e.type) {
      case 'run.queued':
      case 'run.started':
        r.runId = d.runId;
        r.title = d.title ?? null;
        r.slug = d.slug ?? null;
        r.queuedAt ??= e.at;
        break;
      case 'step.started':
        open[d.step] = e.at;
        st(d.step).tries++;
        break;
      case 'step.finished':
      case 'step.failed': {
        const s = st(d.step);
        s.durationMs += ms(open[d.step], e.at) ?? 0;
        delete open[d.step];
        if (e.type === 'step.failed') s.failures++;
        const cost = d.result?.costUsd ?? 0;
        s.costUsd += cost;
        r.costUsd += cost;
        if (routed[d.step] && d.step !== 'repair') {
          const outcome = d.result?.agent?.outcome ?? d.result?.outcome ?? (e.type === 'step.failed' ? 'error' : 'success');
          r.routes.push({ station: d.step, tier: routed[d.step], costUsd: cost, ok: e.type === 'step.finished' && outcome === 'success' });
          delete routed[d.step];
        }
        // First pass: the first verify result decides it (null = no gates configured: not counted).
        if (d.step === 'verify' && r.firstPassGates === null && d.result && d.result.passed !== null && d.result.passed !== undefined) r.firstPassGates = d.result.passed === true;
        break;
      }
      case 'route.decided':
        routed[d.step] = d.tier ?? 'pinned';
        break;
      case 'repair.attempted':
        if (routed.repair) r.routes.push({ station: 'repair', tier: routed.repair, costUsd: d.costUsd ?? 0, ok: d.outcome === 'success' && Boolean(d.sha) });
        delete routed.repair;
        r.repairs++;
        r.costUsd += d.costUsd ?? 0;
        st('repair').costUsd += d.costUsd ?? 0;
        break;
      case 'inbox.opened':
        if (d.kind === 'escalation') r.escalated = true;
        break;
      case 'run.parked':
        parkedAt = e.at;
        break;
      case 'run.resumed':
        r.parkedMs += ms(parkedAt, e.at) ?? 0;
        parkedAt = null;
        break;
      case 'pr.changes_requested':
        r.humanReviews++;
        break;
      case 'run.finished':
        r.status = d.status;
        r.endedAt = e.at;
        if (d.status === 'delivered') r.deliveredAt ??= e.at;
        break;
      case 'run.merged':
        r.status = 'merged';
        r.mergedAt ??= e.at;
        if (d.humanEdit) r.humanEdit = d.humanEdit;
        break;
      default:
        break;
    }
  }
  r.leadToPrMs = ms(r.queuedAt, r.deliveredAt);
  r.leadToMergeMs = ms(r.queuedAt, r.mergedAt);
  return r;
}
