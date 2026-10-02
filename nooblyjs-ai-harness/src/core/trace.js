// Phase 19: TRACING. You can't improve what you can't measure.
//
// Every turn records a small trace:
//   requests: one per model call — which model, time to first token (TTFT),
//             total time, tokens, cost, why it stopped
//   tools:    one per tool call — name, how long it took, whether it failed
//
// It travels on the turn_end event, is saved in the transcript (so resumed
// sessions keep their history of timings), and /stats summarises it.
// Nothing here changes behaviour: it only watches.

export function createTrace() {
  return { requests: [], tools: [] };
}

/** Summary numbers for /stats (and the eval runner). */
export function summarizeTraces(traces) {
  const requests = traces.flatMap((t) => t.requests ?? []);
  const tools = traces.flatMap((t) => t.tools ?? []);
  const sum = (values) => values.reduce((a, b) => a + b, 0);
  const tokens = (key) => sum(requests.map((r) => r.usage?.[key] ?? 0));
  const input = tokens('input_tokens');
  const cacheRead = tokens('cache_read_input_tokens');
  const cacheWrite = tokens('cache_creation_input_tokens');

  const byTool = new Map();
  for (const call of tools) {
    const row = byTool.get(call.name) ?? { name: call.name, calls: 0, errors: 0, totalMs: 0 };
    row.calls += 1;
    row.errors += call.isError ? 1 : 0;
    row.totalMs += call.durationMs;
    byTool.set(call.name, row);
  }

  return {
    turns: traces.length,
    requests: requests.length,
    ttftMs: percentiles(requests.map((r) => r.ttftMs).filter((v) => v != null)),
    requestMs: percentiles(requests.map((r) => r.durationMs)),
    tokens: { input, output: tokens('output_tokens'), cacheRead, cacheWrite },
    cacheHitRate: input + cacheRead + cacheWrite ? cacheRead / (input + cacheRead + cacheWrite) : 0,
    cost: sum(requests.map((r) => r.cost ?? 0)) + sum(tools.map((t) => t.cost ?? 0)),
    restarts: sum(requests.map((r) => r.restarts ?? 0)),
    tools: [...byTool.values()].sort((a, b) => b.totalMs - a.totalMs),
  };
}

/** { p50, p90, max } of a list of numbers, or null if empty. */
export function percentiles(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  return { p50: at(50), p90: at(90), max: sorted.at(-1) };
}

/** The /stats text. */
export function formatStats(summary) {
  if (!summary.requests) return 'No model requests yet in this session.';
  const ms = (v) => (v == null ? '–' : v < 1000 ? `${Math.round(v)}ms` : `${(v / 1000).toFixed(1)}s`);
  const pct = (p) => (p ? `p50 ${ms(p.p50)} · p90 ${ms(p.p90)} · max ${ms(p.max)}` : '–');
  const { tokens: t } = summary;
  const lines = [
    `Turns: ${summary.turns} · model requests: ${summary.requests}${summary.restarts ? ` · restarted mid-reply: ${summary.restarts}` : ''}`,
    `Time to first token:  ${pct(summary.ttftMs)}`,
    `Model request time:   ${pct(summary.requestMs)}`,
    `Tokens: in ${t.input.toLocaleString()} · out ${t.output.toLocaleString()} · cache read ${t.cacheRead.toLocaleString()} · cache write ${t.cacheWrite.toLocaleString()}`,
    `Cache hit rate: ${(summary.cacheHitRate * 100).toFixed(0)}% of input tokens · cost $${summary.cost.toFixed(4)}`,
  ];
  if (summary.tools.length) {
    lines.push('', 'Tools             calls  errors   total    avg');
    for (const row of summary.tools) {
      lines.push(`${row.name.padEnd(17)} ${String(row.calls).padStart(5)}  ${String(row.errors).padStart(6)}  ${ms(row.totalMs).padStart(6)}  ${ms(row.totalMs / row.calls).padStart(5)}`);
    }
  }
  return lines.join('\n');
}
