// Fixed-window rate limiter held in memory (single process).
export class RateLimiter {
  constructor({ windowMs = 60000 } = {}) {
    this.windowMs = windowMs;
    this.windows = new Map();
  }

  /** Returns { ok, retryAfter (seconds), remaining }. */
  take(key, limit) {
    const now = Date.now();
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    if (w.count >= limit) return { ok: false, retryAfter: Math.ceil((w.start + this.windowMs - now) / 1000), remaining: 0 };
    w.count += 1;
    if (this.windows.size > 10000) this.prune(now);
    return { ok: true, retryAfter: 0, remaining: limit - w.count };
  }

  reset(key) {
    this.windows.delete(key);
  }

  prune(now) {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}
