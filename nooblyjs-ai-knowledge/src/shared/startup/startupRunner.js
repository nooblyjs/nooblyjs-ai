/**
 * @fileoverview Startup profiler / supervisor.
 *
 * WHY THIS EXISTS
 * ---------------
 * Almost every expensive initializer in this platform already runs off the
 * critical path, as an un-awaited async IIFE:
 *
 *   SecurityManager, SpaceFilingManager, WorkflowBridge, AI instances
 *     → src/datasources/initialize.js
 *   NotificationManager, wiki data, FileWatcher, search index
 *     → src/wiki/initialize.js + src/wiki/routes/searchRoutes.js
 *   Git repository clones
 *     → src/shared/repositories/repositoryManager.js
 *
 * That means the HTTP port binds quickly, but the app is not USABLE until an
 * unknown amount of background work finishes — and today none of it is
 * observable. A failed component looks exactly like a slow one, ordering
 * between them is implicit, and there is no way to answer "what is making
 * startup slow?" on a real dataset.
 *
 * THIS MODULE IS DELIBERATELY INSTRUMENTATION-ONLY.
 * It changes NO ordering and NO concurrency. `track()` invokes its function
 * immediately and synchronously, exactly as the bare IIFE did, and re-throws
 * whatever the function throws so existing `.catch()` handlers still fire.
 * All it adds is a timed, named, queryable record of what ran and how long it
 * took. Once the numbers are in from a production-sized dataset, dependency
 * ordering (`after:`), a critical/background split and worker-thread offload
 * for the CPU-bound tasks can be built on top of the same task table.
 *
 * OUTPUT
 * ------
 *   - one log line per task as it settles,
 *   - a summary table once the port is bound and every task has settled,
 *   - `GET /api/startup` (authenticated) for the live table,
 *   - `startup` counts on `GET /api/health`.
 *
 * Env:
 *   STARTUP_REPORT_QUIET_MS  debounce before printing the summary (default 500)
 *   STARTUP_REPORT_MAX_MS    print anyway after this long (default 120000)
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const { EventEmitter } = require('node:events');

const RUNNING = 'running';
const READY = 'ready';
const FAILED = 'failed';

const QUIET_MS = Number(process.env.STARTUP_REPORT_QUIET_MS) || 500;
const MAX_WAIT_MS = Number(process.env.STARTUP_REPORT_MAX_MS) || 120000;

/**
 * @param {number|null} ms
 * @returns {string} human-readable duration ("412ms", "1.24s")
 */
function formatMs(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** @param {string} value @param {number} width */
function padEnd(value, width) {
  const str = String(value);
  return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

/** @param {string} value @param {number} width */
function padStart(value, width) {
  const str = String(value);
  return str.length >= width ? str : ' '.repeat(width - str.length) + str;
}

class StartupRunner extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} */
    this.tasks = new Map();
    /** @type {Array<{label: string, atMs: number}>} */
    this.checkpoints = [];
    /** ms since process start at which the HTTP server bound its port. */
    this.listeningAtMs = null;

    this.log = null;
    /** @type {Map<string, Array<object>>} name → waiters registered via whenReady() */
    this._waiters = new Map();
    this._summaryTimer = null;
    this._maxTimer = null;
    this._summaryPrinted = false;
  }

  /**
   * Attach the structured logger. Until this is called, output falls back to
   * console so tasks registered before the logger exists are not lost.
   * @param {object} log
   */
  setLogger(log) {
    this.log = log;
    return this;
  }

  /** Milliseconds since process start — the only honest anchor for "startup". */
  _now() {
    return process.uptime() * 1000;
  }

  _info(message) {
    if (this.log && typeof this.log.info === 'function') this.log.info(message);
    else console.log(message);
  }

  _warn(message) {
    if (this.log && typeof this.log.warn === 'function') this.log.warn(message);
    else console.warn(message);
  }

  _error(message) {
    if (this.log && typeof this.log.error === 'function') this.log.error(message);
    else console.error(message);
  }

  /**
   * Record a zero-duration moment in the startup timeline (e.g. "core services
   * constructed"). Useful for telling module-require cost apart from data cost.
   * @param {string} label
   * @returns {number} ms since process start
   */
  checkpoint(label) {
    const atMs = this._now();
    this.checkpoints.push({ label, atMs });
    this.emit('checkpoint', { label, atMs });
    return atMs;
  }

  /**
   * Start (or restart) a task record.
   * @private
   */
  _begin(name, description) {
    let key = name;
    const existing = this.tasks.get(key);

    // A second concurrent start under the same name would corrupt the timing of
    // the first, so give it its own row rather than silently overwriting.
    if (existing && existing.state === RUNNING) {
      let n = 2;
      while (this.tasks.has(`${name}#${n}`)) n += 1;
      key = `${name}#${n}`;
      this._warn(`[Startup] Task "${name}" started again while still running — recording as "${key}"`);
    }

    // Re-running a settled task (e.g. a forced search-index rebuild) reuses the
    // row and bumps `runs`, so the table shows the latest run.
    const record = this.tasks.get(key) || { name: key, runs: 0 };
    record.description = description || record.description || '';
    record.state = RUNNING;
    record.startedAtMs = this._now();
    record.finishedAtMs = null;
    record.durationMs = null;
    record.error = null;
    record.runs += 1;
    this.tasks.set(key, record);

    this.emit('task:start', { ...record });
    return record;
  }

  /**
   * Finish a task record, log it, release waiters, and re-arm the summary.
   * @private
   */
  _settle(record, error) {
    record.finishedAtMs = this._now();
    record.durationMs = record.finishedAtMs - record.startedAtMs;
    record.state = error ? FAILED : READY;
    record.error = error ? (error.message || String(error)) : null;

    if (error) {
      this._error(`[Startup] ✗ ${record.name} FAILED after ${formatMs(record.durationMs)} — ${record.error}`);
    } else {
      this._info(`[Startup] ✓ ${record.name} ready in ${formatMs(record.durationMs)}`);
    }

    this.emit(error ? 'task:failed' : 'task:ready', { ...record });
    this._flushWaiters(record);
    this._scheduleSummary();
  }

  /**
   * Time an asynchronous startup task.
   *
   * Behaviourally identical to calling `fn()` yourself: it runs immediately and
   * synchronously up to its first await, and the returned promise settles
   * exactly as `fn`'s does (rejections are re-thrown, so existing `.catch()`
   * handlers keep working). Attach a `.catch()` as you would have before.
   *
   * @param {string} name
   * @param {() => (Promise<any>|any)} fn
   * @param {{description?: string}} [opts]
   * @returns {Promise<any>}
   */
  track(name, fn, opts = {}) {
    const record = this._begin(name, opts.description);
    let result;
    try {
      result = fn();
    } catch (error) {
      this._settle(record, error);
      return Promise.reject(error);
    }
    return Promise.resolve(result).then(
      (value) => { this._settle(record, null); return value; },
      (error) => { this._settle(record, error); throw error; }
    );
  }

  /**
   * Time a synchronous startup task. Re-throws on failure.
   * @param {string} name
   * @param {() => any} fn
   * @param {{description?: string}} [opts]
   * @returns {any} whatever `fn` returned
   */
  trackSync(name, fn, opts = {}) {
    const record = this._begin(name, opts.description);
    try {
      const value = fn();
      this._settle(record, null);
      return value;
    } catch (error) {
      this._settle(record, error);
      throw error;
    }
  }

  /**
   * Resolve once the named task is ready. Safe to call before the task is
   * registered (it waits for it), and after it has settled (resolves/rejects
   * immediately). Rejects if the task failed.
   *
   * Nothing depends on this yet — it is the hook that lets a route handler
   * await a component instead of racing it, once the profile shows where the
   * real races are.
   *
   * @param {string} name
   * @param {{timeoutMs?: number}} [opts]
   * @returns {Promise<object>} the task record
   */
  whenReady(name, opts = {}) {
    const record = this.tasks.get(name);
    if (record && record.state === READY) return Promise.resolve(record);
    if (record && record.state === FAILED) {
      return Promise.reject(new Error(`Startup task "${name}" failed: ${record.error}`));
    }

    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      if (opts.timeoutMs) {
        waiter.timer = setTimeout(() => {
          const list = this._waiters.get(name);
          if (list) {
            const idx = list.indexOf(waiter);
            if (idx !== -1) list.splice(idx, 1);
          }
          reject(new Error(`Timed out after ${opts.timeoutMs}ms waiting for startup task "${name}"`));
        }, opts.timeoutMs);
        if (typeof waiter.timer.unref === 'function') waiter.timer.unref();
      }
      const list = this._waiters.get(name) || [];
      list.push(waiter);
      this._waiters.set(name, list);
    });
  }

  /** @private */
  _flushWaiters(record) {
    const list = this._waiters.get(record.name);
    if (!list) return;
    this._waiters.delete(record.name);
    for (const waiter of list) {
      if (waiter.timer) clearTimeout(waiter.timer);
      if (record.state === READY) waiter.resolve(record);
      else waiter.reject(new Error(`Startup task "${record.name}" failed: ${record.error}`));
    }
  }

  /** @param {string} name @returns {boolean} */
  isReady(name) {
    const record = this.tasks.get(name);
    return !!record && record.state === READY;
  }

  /** Record that the HTTP server has bound its port. */
  markListening() {
    this.listeningAtMs = this._now();
    this._armMaxTimer();
    this._scheduleSummary();
    return this.listeningAtMs;
  }

  /** @returns {{ready: number, failed: number, running: number, total: number}} */
  counts() {
    let ready = 0, failed = 0, running = 0;
    for (const record of this.tasks.values()) {
      if (record.state === READY) ready += 1;
      else if (record.state === FAILED) failed += 1;
      else running += 1;
    }
    return { ready, failed, running, total: this.tasks.size };
  }

  /**
   * Full machine-readable profile. `error` carries the message only — never a
   * stack — because this is exposed over HTTP.
   * @returns {object}
   */
  report() {
    const tasks = Array.from(this.tasks.values())
      .sort((a, b) => a.startedAtMs - b.startedAtMs)
      .map((record) => ({
        name: record.name,
        description: record.description || undefined,
        state: record.state,
        startedAtMs: Math.round(record.startedAtMs),
        durationMs: record.durationMs === null ? null : Math.round(record.durationMs),
        runs: record.runs,
        error: record.error
      }));

    return {
      uptimeMs: Math.round(this._now()),
      listeningAtMs: this.listeningAtMs === null ? null : Math.round(this.listeningAtMs),
      settled: this.counts().running === 0,
      counts: this.counts(),
      checkpoints: this.checkpoints.map((c) => ({ label: c.label, atMs: Math.round(c.atMs) })),
      tasks
    };
  }

  /** @private Debounced: print once the port is bound and nothing is in flight. */
  _scheduleSummary() {
    if (this._summaryPrinted) return;
    if (this._summaryTimer) clearTimeout(this._summaryTimer);
    this._summaryTimer = setTimeout(() => {
      if (this.listeningAtMs === null) return;      // not serving yet
      if (this.counts().running > 0) return;        // work still in flight
      this.printSummary();
    }, QUIET_MS);
    if (typeof this._summaryTimer.unref === 'function') this._summaryTimer.unref();
  }

  /** @private Backstop so a task that never settles cannot suppress the report. */
  _armMaxTimer() {
    if (this._maxTimer || this._summaryPrinted) return;
    this._maxTimer = setTimeout(() => this.printSummary(), MAX_WAIT_MS);
    if (typeof this._maxTimer.unref === 'function') this._maxTimer.unref();
  }

  /**
   * Print the startup profile table. Prints at most once automatically; call
   * directly to re-print on demand.
   */
  printSummary() {
    this._summaryPrinted = true;
    if (this._summaryTimer) { clearTimeout(this._summaryTimer); this._summaryTimer = null; }
    if (this._maxTimer) { clearTimeout(this._maxTimer); this._maxTimer = null; }

    const bar = '='.repeat(78);
    const rule = '-'.repeat(78);
    const records = Array.from(this.tasks.values()).sort((a, b) => a.startedAtMs - b.startedAtMs);

    this._info(bar);
    this._info('  STARTUP PROFILE');
    this._info(bar);

    for (const checkpoint of this.checkpoints) {
      this._info(`  ${padEnd(checkpoint.label, 40)}${padStart(formatMs(checkpoint.atMs), 12)}`);
    }
    if (this.listeningAtMs !== null) {
      this._info(`  ${padEnd('port bound', 40)}${padStart(formatMs(this.listeningAtMs), 12)}`);
    }

    const settledAt = records.reduce(
      (max, r) => (r.finishedAtMs !== null && r.finishedAtMs > max ? r.finishedAtMs : max),
      0
    );
    if (settledAt > 0) {
      this._info(`  ${padEnd('last startup task settled', 40)}${padStart(formatMs(settledAt), 12)}`);
    }

    this._info(rule);
    this._info(`  ${padEnd('TASK', 40)}${padEnd('STATE', 10)}${padStart('STARTED', 10)}${padStart('DURATION', 12)}`);

    for (const record of records) {
      const glyph = record.state === READY ? '+' : record.state === FAILED ? '!' : '~';
      this._info(
        `${glyph} ${padEnd(record.name, 40)}${padEnd(record.state, 10)}` +
        `${padStart(formatMs(record.startedAtMs), 10)}${padStart(formatMs(record.durationMs), 12)}`
      );
      if (record.error) this._info(`  ${' '.repeat(40)}${record.error}`);
    }

    const slowest = records
      .filter((r) => r.durationMs !== null)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 3)
      .map((r) => `${r.name} ${formatMs(r.durationMs)}`);

    this._info(rule);
    if (slowest.length) this._info(`  Slowest: ${slowest.join('  |  ')}`);
    this._info('  Tasks run concurrently — durations overlap and do NOT sum to total startup time.');
    this._info('  Live profile: GET /api/startup');
    this._info(bar);
  }

  /** Reset all state. Test-support only. */
  reset() {
    if (this._summaryTimer) clearTimeout(this._summaryTimer);
    if (this._maxTimer) clearTimeout(this._maxTimer);
    this.tasks.clear();
    this.checkpoints = [];
    this._waiters.clear();
    this.listeningAtMs = null;
    this._summaryTimer = null;
    this._maxTimer = null;
    this._summaryPrinted = false;
    return this;
  }
}

/**
 * Process-wide singleton. Startup work is registered from the composition root,
 * from both module initializers and from call sites several layers deep
 * (fileWatcher, searchRoutes), and is read back by the health endpoints — the
 * same shape as the logger, so it is shared rather than threaded through every
 * signature. `src/shared/startup/startupRunner` resolves to one module
 * instance for every requirer in this package.
 */
const startup = new StartupRunner();

module.exports = { startup, StartupRunner, formatMs };
