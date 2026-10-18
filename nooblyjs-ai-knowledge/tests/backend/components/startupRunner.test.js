/**
 * @fileoverview Tests for the startup profiler (src/shared/startup/startupRunner.js).
 *
 * The runner is instrumentation only, so the contract these tests protect is
 * mostly about NOT changing behaviour: `track` must run its function
 * synchronously (exactly as the bare async IIFE it replaced did) and must
 * re-throw so existing `.catch()` handlers keep firing.
 */

'use strict';

const { StartupRunner, formatMs } = require('../../../src/shared/startup/startupRunner');

/** Silence the runner's own logging during tests. */
function quietRunner() {
  const runner = new StartupRunner();
  runner.setLogger({ info() {}, warn() {}, error() {} });
  return runner;
}

describe('StartupRunner', () => {
  describe('track()', () => {
    it('runs the task function synchronously, like the IIFE it replaces', () => {
      const runner = quietRunner();
      let ran = false;
      runner.track('sync-prefix', async () => { ran = true; });
      // Not awaited — the sync prefix must already have executed.
      expect(ran).toBe(true);
    });

    it('resolves with the task value and records a ready state', async () => {
      const runner = quietRunner();
      const value = await runner.track('ok', async () => 'result');

      expect(value).toBe('result');
      const [task] = runner.report().tasks;
      expect(task.name).toBe('ok');
      expect(task.state).toBe('ready');
      expect(task.error).toBeNull();
      expect(task.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('re-throws so existing .catch() handlers still fire', async () => {
      const runner = quietRunner();
      const onCatch = jest.fn();

      await runner.track('boom', async () => { throw new Error('nope'); }).catch(onCatch);

      expect(onCatch).toHaveBeenCalledTimes(1);
      expect(onCatch.mock.calls[0][0].message).toBe('nope');
      expect(runner.report().tasks[0]).toMatchObject({ state: 'failed', error: 'nope' });
    });

    it('records a synchronous throw as a failed task and rejects', async () => {
      const runner = quietRunner();

      await expect(runner.track('sync-throw', () => { throw new Error('early'); }))
        .rejects.toThrow('early');
      expect(runner.report().tasks[0]).toMatchObject({ state: 'failed', error: 'early' });
    });

    it('gives a concurrent re-run of the same name its own row', async () => {
      const runner = quietRunner();
      const first = runner.track('dup', () => new Promise((r) => setTimeout(r, 5)));
      const second = runner.track('dup', async () => {});
      await Promise.all([first, second]);

      expect(runner.report().tasks.map((t) => t.name)).toEqual(['dup', 'dup#2']);
    });

    it('reuses the row and bumps runs when a settled task runs again', async () => {
      const runner = quietRunner();
      await runner.track('rebuild', async () => {});
      await runner.track('rebuild', async () => {});

      const tasks = runner.report().tasks;
      expect(tasks).toHaveLength(1);
      expect(tasks[0].runs).toBe(2);
    });
  });

  describe('trackSync()', () => {
    it('returns the value and records the task', () => {
      const runner = quietRunner();
      expect(runner.trackSync('s', () => 42)).toBe(42);
      expect(runner.report().tasks[0].state).toBe('ready');
    });

    it('re-throws so the caller\'s try/catch still runs', () => {
      const runner = quietRunner();
      expect(() => runner.trackSync('s', () => { throw new Error('x'); })).toThrow('x');
      expect(runner.report().tasks[0].state).toBe('failed');
    });
  });

  describe('whenReady()', () => {
    it('resolves for a task registered later', async () => {
      const runner = quietRunner();
      const waiting = runner.whenReady('late');
      runner.track('late', async () => {});
      await expect(waiting).resolves.toMatchObject({ name: 'late', state: 'ready' });
    });

    it('resolves immediately for an already-ready task', async () => {
      const runner = quietRunner();
      await runner.track('done', async () => {});
      await expect(runner.whenReady('done')).resolves.toMatchObject({ state: 'ready' });
    });

    it('rejects when the task failed, before and after the fact', async () => {
      const runner = quietRunner();
      const waiting = runner.whenReady('bad');
      await runner.track('bad', async () => { throw new Error('kaput'); }).catch(() => {});

      await expect(waiting).rejects.toThrow(/kaput/);
      await expect(runner.whenReady('bad')).rejects.toThrow(/kaput/);
    });

    it('times out rather than hanging on a name that never registers', async () => {
      const runner = quietRunner();
      await expect(runner.whenReady('ghost', { timeoutMs: 20 }))
        .rejects.toThrow(/Timed out/);
    });
  });

  describe('report()', () => {
    it('counts states and orders tasks by start time', async () => {
      const runner = quietRunner();
      await runner.track('a', async () => {});
      await runner.track('b', async () => { throw new Error('e'); }).catch(() => {});
      runner.track('c', () => new Promise(() => {}));  // never settles

      const report = runner.report();
      expect(report.counts).toEqual({ ready: 1, failed: 1, running: 1, total: 3 });
      expect(report.settled).toBe(false);
      expect(report.tasks.map((t) => t.name)).toEqual(['a', 'b', 'c']);
      expect(report.tasks[2].durationMs).toBeNull();
    });

    it('exposes checkpoints and the listening mark', () => {
      const runner = quietRunner();
      runner.checkpoint('core services');
      runner.markListening();

      const report = runner.report();
      expect(report.checkpoints).toHaveLength(1);
      expect(report.checkpoints[0].label).toBe('core services');
      expect(report.listeningAtMs).toBeGreaterThan(0);
    });

    it('never leaks a stack trace, only the error message', async () => {
      const runner = quietRunner();
      await runner.track('leaky', async () => { throw new Error('secret path /etc/x'); }).catch(() => {});
      const json = JSON.stringify(runner.report());

      expect(json).toContain('secret path /etc/x');
      expect(json).not.toContain('at Object');
      expect(json).not.toContain('startupRunner.js:');
    });
  });

  describe('summary', () => {
    it('prints once the port is bound and every task has settled', async () => {
      jest.useFakeTimers();
      try {
        const lines = [];
        const runner = new StartupRunner();
        runner.setLogger({ info: (m) => lines.push(m), warn() {}, error() {} });

        runner.track('t', async () => {});
        runner.markListening();
        await Promise.resolve();          // let the task settle
        jest.advanceTimersByTime(1000);   // fire the debounced summary

        expect(lines.some((l) => l.includes('STARTUP PROFILE'))).toBe(true);
        expect(lines.some((l) => l.includes('port bound'))).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('does not print while a task is still running', async () => {
      jest.useFakeTimers();
      try {
        const lines = [];
        const runner = new StartupRunner();
        runner.setLogger({ info: (m) => lines.push(m), warn() {}, error() {} });

        runner.track('hangs', () => new Promise(() => {}));
        runner.markListening();
        jest.advanceTimersByTime(1000);

        expect(lines.some((l) => l.includes('STARTUP PROFILE'))).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('formatMs()', () => {
    it.each([
      [null, '—'],
      [0, '0ms'],
      [412, '412ms'],
      [1240, '1.24s']
    ])('formats %p as %p', (input, expected) => {
      expect(formatMs(input)).toBe(expected);
    });
  });
});
