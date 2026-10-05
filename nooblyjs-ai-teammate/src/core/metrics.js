// Operational metrics (tasks, webhook deliveries, API requests), recorded in core's measuring service so they show
// on /services/measuring/. Lifetime totals are kept here too, because only the newest measures are retained.
const KEEP = 1000;
const HOUR = 3600000;

export class Metrics {
  constructor(measuring, { keep = KEEP } = {}) {
    this.measuring = measuring;
    this.keep = keep;
    this.totals = new Map(); // name -> { count, sum, last, at }
  }

  /** Records one measure. Counters use the default value of 1. Never throws. */
  record(name, value = 1) {
    if (!Number.isFinite(value)) return;
    const t = this.totals.get(name) ?? { count: 0, sum: 0 };
    this.totals.set(name, { count: t.count + 1, sum: t.sum + value, last: value, at: new Date().toISOString() });
    try {
      this.measuring.add(name, value);
      // The memory provider keeps every measure; trim to the newest so a long-running server stays bounded.
      const series = this.measuring.metrics?.get?.(name);
      if (Array.isArray(series) && series.length > this.keep * 1.1) series.splice(0, series.length - this.keep);
    } catch { /* metrics must never fail the work they measure */ }
  }

  /** Lifetime count/sum/average per metric, plus the last hour from the measuring service. */
  summary(now = Date.now()) {
    const out = {};
    for (const [name, t] of [...this.totals].sort(([a], [b]) => a.localeCompare(b))) {
      let recent = [];
      try {
        recent = this.measuring.list(name, new Date(now - HOUR), new Date(now)) ?? [];
      } catch { /* provider without history */ }
      const recentSum = recent.reduce((s, m) => s + (Number(m.value) || 0), 0);
      out[name] = {
        count: t.count, sum: round(t.sum), avg: round(t.sum / t.count), last: round(t.last), at: t.at,
        lastHour: { count: recent.length, sum: round(recentSum), avg: recent.length ? round(recentSum / recent.length) : 0 },
      };
    }
    return out;
  }
}

const round = (v) => Math.round(v * 100) / 100;
