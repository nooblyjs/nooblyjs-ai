// @ts-check
// Phase F19: SCORES, and comparing two benches honestly.
//
// A model is not deterministic, so one run of the bench is one sample. With `--repeat 3`:
//
//   resolve rate   per repeat (e.g. 60%, 70%, 65%) → mean 65%, spread 60–70%, stdev
//   cost / resolve total cost ÷ resolved runs (failures cost money too)
//   median time    per run, whole line
//
// Comparing A and B: a difference smaller than the spread is NOISE, not a result. And the
// headline number hides movement: B can gain two cases and lose two others. So compare
// per case too: a case FLIPS when it's resolved in most of A's repeats and fewer than half
// of B's (lost), or the other way round (gained).

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stdev = (xs) => (xs.length > 1 ? Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)) * (xs.length / (xs.length - 1))) : 0);

/** @param {{ label: string, results: any[] }} bench */
export function summarise(bench) {
  const rs = bench.results;
  const repeats = [...new Set(rs.map((r) => r.repeat))].sort((a, b) => a - b);
  const rates = repeats.map((n) => {
    const these = rs.filter((r) => r.repeat === n);
    return these.filter((r) => r.resolved).length / these.length;
  });
  const resolved = rs.filter((r) => r.resolved).length;
  const cost = rs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const perCase = {};
  for (const r of rs) (perCase[r.case] ??= []).push(r.resolved);
  const statuses = {};
  for (const r of rs) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  return {
    label: bench.label,
    runs: rs.length,
    cases: Object.keys(perCase).length,
    repeats: repeats.length,
    resolveRate: mean(rates),
    spread: { min: Math.min(...rates), max: Math.max(...rates), stdev: stdev(rates) },
    resolved,
    costUsd: cost,
    costPerResolve: resolved ? cost / resolved : null,
    medianMs: median(rs.map((r) => r.durationMs)),
    statuses,
    errors: rs.filter((r) => r.error).length,
    protectedChanged: rs.filter((r) => r.protectedChanged?.length).length,
    perCase: Object.fromEntries(Object.entries(perCase).map(([id, xs]) => [id, xs.filter(Boolean).length / xs.length])),
  };
}

export function compare(a, b) {
  const sa = summarise(a);
  const sb = summarise(b);
  const flips = { gained: [], lost: [] };
  for (const id of new Set([...Object.keys(sa.perCase), ...Object.keys(sb.perCase)])) {
    const x = sa.perCase[id] ?? 0;
    const y = sb.perCase[id] ?? 0;
    if (x > 0.5 && y < 0.5) flips.lost.push(id);
    if (x < 0.5 && y > 0.5) flips.gained.push(id);
  }
  const delta = sb.resolveRate - sa.resolveRate;
  // Overlapping spreads: the difference is within what repeats of ONE setup already vary by.
  const noise = sa.spread.max >= sb.spread.min && sb.spread.max >= sa.spread.min;
  return { a: sa, b: sb, delta, withinNoise: noise, flips };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const usd = (x) => (x == null ? '—' : `$${x.toFixed(x < 0.01 ? 4 : 2)}`);

export function formatSummary(s) {
  return [
    `${s.label}: ${s.cases} cases × ${s.repeats} repeat(s) = ${s.runs} runs`,
    `  resolved     ${pct(s.resolveRate)}${s.repeats > 1 ? ` (spread ${pct(s.spread.min)}–${pct(s.spread.max)}, sd ${pct(s.spread.stdev)})` : ''}   ${s.resolved}/${s.runs}`,
    `  cost         ${usd(s.costUsd)} total · ${usd(s.costPerResolve)} per resolve`,
    `  median time  ${(s.medianMs / 1000).toFixed(1)}s per run`,
    `  outcomes     ${Object.entries(s.statuses).map(([k, v]) => `${v} ${k}`).join(' · ')}${s.errors ? ` · ${s.errors} error(s)` : ''}${s.protectedChanged ? ` · ${s.protectedChanged} touched protected paths` : ''}`,
  ].join('\n');
}

export function formatComparison(c) {
  const sign = c.delta > 0 ? '+' : '';
  return [
    formatSummary(c.a),
    '',
    formatSummary(c.b),
    '',
    `Δ resolved: ${sign}${Math.round(c.delta * 100)} points${c.withinNoise ? '  (within the spread of repeats: probably noise; run more repeats)' : ''}`,
    `  gained: ${c.flips.gained.join(', ') || '—'}`,
    `  lost:   ${c.flips.lost.join(', ') || '—'}`,
  ].join('\n');
}
