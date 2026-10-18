// @ts-check
// Phase F20: the FACTORY's numbers, over a period. DORA-style flow metrics plus agent-specific ones.
//
//   throughput           runs finished per day; PRs delivered per day
//   lead time            item → PR, item → merge (median and p90: averages hide the long tail)
//   time per station     where the line is SLOW (median, p90) and EXPENSIVE (cost)
//   first-pass gate rate verify passed before any repair: how often the builder gets it right alone
//   PR acceptance rate   merged ÷ delivered: do people want what the factory makes?
//   human-edit rate      lines people changed before merging ÷ lines the factory wrote: how finished was it?
//   escalation rate      runs that needed a person to rescue them
//   cost per merged PR   ALL spend in the period ÷ merged PRs (failures are part of the price)
//
// DORA's four (deployment frequency, lead time, change-failure rate, time to restore) measure a
// delivery pipeline. A factory also has to answer: is the agent's work any good, and what does it cost?
import { runMetrics } from './run-metrics.js';

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const rate = (n, d) => (d ? n / d : null);

/** "7d", "24h", "30m", or an ISO date → a start time (ms). */
export function parseSince(since, now = Date.now()) {
  const m = /^(\d+)([dhm])$/.exec(String(since ?? '7d'));
  if (m) return now - Number(m[1]) * { d: 86_400_000, h: 3_600_000, m: 60_000 }[m[2]];
  const t = Date.parse(String(since));
  if (Number.isNaN(t)) throw new Error(`--since: "${since}" is not like 7d, 24h or 2026-09-01.`);
  return t;
}

/**
 * @param {Array<{ type: string, at: string, data: any, stream?: string }>} events  the whole log (or more than the period)
 * @param {{ since?: string, now?: number }} [options]
 */
export function factoryMetrics(events, { since = '7d', now = Date.now() } = {}) {
  const from = parseSince(since, now);
  const byRun = new Map();
  for (const e of events) {
    const id = e.data?.runId;
    if (!id) continue;
    if (!byRun.has(id)) byRun.set(id, []);
    byRun.get(id).push(e);
  }
  const runs = [...byRun.values()].map(runMetrics).filter((r) => r.queuedAt && Date.parse(r.queuedAt) >= from);
  const days = Math.max(1, (now - from) / 86_400_000);
  const finished = runs.filter((r) => r.endedAt);
  const delivered = runs.filter((r) => r.deliveredAt);
  const merged = runs.filter((r) => r.mergedAt);
  const gated = runs.filter((r) => r.firstPassGates !== null);
  const edited = merged.filter((r) => r.humanEdit);
  const cost = runs.reduce((s, r) => s + r.costUsd, 0);

  const stationIds = [...new Set(runs.flatMap((r) => Object.keys(r.stations)))];
  const stations = stationIds.map((id) => {
    const here = runs.map((r) => r.stations[id]).filter(Boolean);
    const times = here.map((s) => s.durationMs);
    return { id, runs: here.length, p50Ms: pct(times, 50), p90Ms: pct(times, 90), totalMs: times.reduce((a, b) => a + b, 0), costUsd: here.reduce((s, x) => s + x.costUsd, 0), failures: here.reduce((s, x) => s + x.failures, 0), retries: here.reduce((s, x) => s + Math.max(0, x.tries - 1), 0) };
  }).sort((a, b) => b.totalMs - a.totalMs);

  // Phase F22: per station AND tier: what each model tier cost there, and how often its step succeeded.
  const routeRows = {};
  for (const x of runs.flatMap((r) => r.routes)) {
    const row = (routeRows[`${x.station}|${x.tier}`] ??= { station: x.station, tier: x.tier, steps: 0, ok: 0, costUsd: 0 });
    row.steps++;
    row.ok += x.ok ? 1 : 0;
    row.costUsd += x.costUsd;
  }
  const routes = Object.values(routeRows).map((x) => ({ ...x, successRate: x.ok / x.steps, costPerStep: x.costUsd / x.steps })).sort((a, b) => a.station.localeCompare(b.station) || String(a.tier).localeCompare(String(b.tier)));

  const m = {
    routes,
    since: new Date(from).toISOString(),
    runs: runs.length,
    throughputPerDay: finished.length / days,
    deliveredPerDay: delivered.length / days,
    leadTimeToPr: { p50Ms: pct(delivered.map((r) => r.leadToPrMs), 50), p90Ms: pct(delivered.map((r) => r.leadToPrMs), 90) },
    leadTimeToMerge: { p50Ms: pct(merged.map((r) => r.leadToMergeMs), 50), p90Ms: pct(merged.map((r) => r.leadToMergeMs), 90) },
    firstPassGateRate: rate(gated.filter((r) => r.firstPassGates).length, gated.length),
    prAcceptanceRate: rate(merged.length, delivered.length),
    humanEditRate: edited.length ? rate(edited.reduce((s, r) => s + r.humanEdit.editedLines, 0), edited.reduce((s, r) => s + r.humanEdit.factoryLines, 0)) : null,
    humanEditMeasured: edited.length,
    escalationRate: rate(runs.filter((r) => r.escalated).length, runs.length),
    repairRate: rate(runs.filter((r) => r.repairs > 0).length, runs.length),
    costUsd: cost,
    costPerMergedPr: merged.length ? cost / merged.length : null,
    statuses: Object.fromEntries(Object.entries(Object.groupBy(runs, (r) => r.status)).map(([k, v]) => [k, v?.length ?? 0])),
    stations,
    slowest: stations.toSorted((a, b) => (b.p50Ms ?? 0) - (a.p50Ms ?? 0))[0]?.id ?? null,
    mostExpensive: stations.toSorted((a, b) => b.costUsd - a.costUsd)[0]?.id ?? null,
  };
  return { ...m, kpis: kpis(m) };
}

const fmtPct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
export const fmtDur = (x) => (x == null ? '—' : x < 60_000 ? `${(x / 1000).toFixed(1)}s` : x < 3_600_000 ? `${(x / 60_000).toFixed(1)}m` : `${(x / 3_600_000).toFixed(1)}h`);
const fmtUsd = (x) => (x == null ? '—' : `$${x.toFixed(x < 1 ? 4 : 2)}`);

/** Display-ready numbers (the dashboard's metrics page shows these as they are). */
function kpis(m) {
  return [
    { label: 'runs', value: String(m.runs) },
    { label: 'PRs delivered / day', value: m.deliveredPerDay.toFixed(1) },
    { label: 'lead time → PR (median)', value: fmtDur(m.leadTimeToPr.p50Ms), hint: `p90 ${fmtDur(m.leadTimeToPr.p90Ms)}` },
    { label: 'lead time → merge (median)', value: fmtDur(m.leadTimeToMerge.p50Ms), hint: `p90 ${fmtDur(m.leadTimeToMerge.p90Ms)}` },
    { label: 'first-pass gates', value: fmtPct(m.firstPassGateRate), hint: 'verify passed before any repair' },
    { label: 'PR acceptance', value: fmtPct(m.prAcceptanceRate), hint: 'merged ÷ delivered' },
    { label: 'human edits before merge', value: fmtPct(m.humanEditRate), hint: `${m.humanEditMeasured} merge(s) measured: lines people changed ÷ lines the factory wrote` },
    { label: 'escalations', value: fmtPct(m.escalationRate) },
    { label: 'cost per merged PR', value: fmtUsd(m.costPerMergedPr), hint: `all spend ${fmtUsd(m.costUsd)}` },
    { label: 'slowest / priciest station', value: `${m.slowest ?? '—'} / ${m.mostExpensive ?? '—'}` },
  ];
}

export function formatMetrics(m) {
  const lines = [`Since ${m.since.slice(0, 16).replace('T', ' ')}: ${m.runs} runs (${Object.entries(m.statuses).map(([k, v]) => `${v} ${k}`).join(' · ') || 'none'})`, ''];
  for (const k of m.kpis) lines.push(`  ${k.label.padEnd(28)} ${k.value}${k.hint ? `   (${k.hint})` : ''}`);
  lines.push('', '  station      runs   median      p90     total     cost  failures  retries');
  for (const s of m.stations) lines.push(`  ${s.id.padEnd(12)} ${String(s.runs).padStart(4)} ${fmtDur(s.p50Ms).padStart(8)} ${fmtDur(s.p90Ms).padStart(8)} ${fmtDur(s.totalMs).padStart(9)} ${fmtUsd(s.costUsd).padStart(8)} ${String(s.failures).padStart(9)} ${String(s.retries).padStart(8)}`);
  if (m.routes.length) {
    lines.push('', '  station      tier        steps  succeeded   cost/step');
    for (const x of m.routes) lines.push(`  ${x.station.padEnd(12)} ${String(x.tier).padEnd(10)} ${String(x.steps).padStart(6)} ${fmtPct(x.successRate).padStart(10)} ${fmtUsd(x.costPerStep).padStart(11)}`);
  }
  return lines.join('\n');
}
