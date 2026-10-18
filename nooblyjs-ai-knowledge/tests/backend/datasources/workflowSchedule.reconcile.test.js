/**
 * @fileoverview Tests for WorkflowBridge schedule reconciliation.
 *
 * Regression cover for "the next run is in the past and the schedule never
 * runs". Cron firing is edge-triggered: a workflow runs only if the backend is
 * alive and responsive during the exact minute its expression matches. A fire
 * missed because the backend was restarting, deploying or stalled was lost,
 * and `nextRun` — only ever advanced by a COMPLETED run — stayed frozen in the
 * past forever. For a nightly schedule one miss costs a day, and a restart
 * that recurs around that hour costs every day.
 *
 * reconcileSchedules() repairs the stale nextRun and replays the missed fire.
 */

'use strict';

const WorkflowBridge = require('../../../src/datasources/lib/workflowBridge');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const os = require('node:os');

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/** ISO timestamp offset from now. */
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

describe('WorkflowBridge schedule reconciliation', () => {
  let bridge;
  let tmpRoot;
  let schedulingService;
  let ranNow;

  /** Adds a schedule in both the bridge and the fake core scheduler. */
  const addSchedule = (id, overrides = {}) => {
    const schedule = {
      id,
      workflowId: 'demo',
      name: id,
      cronExpression: '0 1 * * *',
      interval: null,
      input: {},
      enabled: true,
      lastRun: null,
      nextRun: null,
      executionCount: 0,
      ...overrides
    };
    bridge.schedules.push(schedule);
    bridge.activeSchedules.set(id, { type: 'coreservice' });
    schedulingService.tasks.set(id, { name: id, activeRuns: 0 });
    return schedule;
  };

  beforeEach(async () => {
    ranNow = [];
    schedulingService = {
      tasks: new Map(),
      getSchedule: jest.fn(async (name) => schedulingService.tasks.get(name) || null),
      runNow: jest.fn(async (name) => {
        if (!schedulingService.tasks.has(name)) return false;
        ranNow.push(name);
        return true;
      })
    };

    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-reconcile-'));
    bridge = new WorkflowBridge({
      logger: silentLogger,
      schedulingService,
      appBaseDir: path.join(tmpRoot, '.application')
    });
    bridge.catchUpStaggerMs = 0; // dispatch immediately under test
    bridge.workflows.set('demo', { id: 'demo', name: 'Demo', steps: [] });
  });

  afterEach(async () => {
    bridge.stopScheduleReconciler();
    try {
      if (fsSync.existsSync(tmpRoot)) await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  });

  describe('a fire missed while the backend was down', () => {
    it('moves nextRun back into the future and replays the run', async () => {
      const schedule = addSchedule('overdue', { nextRun: iso(-18 * DAY) });

      const result = await bridge.reconcileSchedules({ startup: true });
      await new Promise(resolve => setImmediate(resolve));

      expect(new Date(schedule.nextRun).getTime()).toBeGreaterThan(Date.now());
      expect(ranNow).toEqual(['overdue']);
      expect(result).toEqual({ repaired: 1, caughtUp: 1 });
    });

    it('persists the new nextRun before running, so a restart loop cannot replay it twice', async () => {
      const schedule = addSchedule('overdue', { nextRun: iso(-1 * DAY) });

      await bridge.reconcileSchedules({ startup: true });
      await new Promise(resolve => setImmediate(resolve));

      const onDisk = JSON.parse(await fs.readFile(bridge.schedulesFile, 'utf8'));
      expect(onDisk.find(s => s.id === 'overdue').nextRun).toBe(schedule.nextRun);

      const second = await bridge.reconcileSchedules();
      expect(second).toEqual({ repaired: 0, caughtUp: 0 });
      expect(ranNow).toHaveLength(1);
    });

    it('repairs nextRun without running anything when catch-up is switched off', async () => {
      bridge.catchUpEnabled = false;
      const schedule = addSchedule('overdue', { nextRun: iso(-1 * DAY) });

      await bridge.reconcileSchedules();
      await new Promise(resolve => setImmediate(resolve));

      expect(new Date(schedule.nextRun).getTime()).toBeGreaterThan(Date.now());
      expect(ranNow).toHaveLength(0);
    });

    it('runs a fallback-activated schedule in process', async () => {
      const schedule = addSchedule('fallback', { nextRun: iso(-1 * DAY) });
      bridge.activeSchedules.set('fallback', { type: 'cron-fallback' });
      bridge.triggerSchedule = jest.fn(async () => ({}));

      await bridge.reconcileSchedules();
      await new Promise(resolve => setImmediate(resolve));

      expect(bridge.triggerSchedule).toHaveBeenCalledWith('fallback');
      expect(schedulingService.runNow).not.toHaveBeenCalled();
      expect(new Date(schedule.nextRun).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('schedules it must leave alone', () => {
    it('does not touch a healthy schedule', async () => {
      const schedule = addSchedule('healthy', { nextRun: iso(60 * MINUTE) });
      const before = schedule.nextRun;

      await bridge.reconcileSchedules();

      expect(schedule.nextRun).toBe(before);
      expect(ranNow).toHaveLength(0);
    });

    it('does not re-run a long workflow that is still in flight', async () => {
      const schedule = addSchedule('running', { nextRun: iso(-40 * MINUTE) });
      schedulingService.tasks.get('running').activeRuns = 1;

      await bridge.reconcileSchedules();

      // nextRun advances when the run completes; jumping in would double-run it.
      expect(new Date(schedule.nextRun).getTime()).toBeLessThan(Date.now());
      expect(ranNow).toHaveLength(0);
    });

    it('ignores disabled schedules', async () => {
      const stale = iso(-1 * DAY);
      const schedule = addSchedule('disabled', { enabled: false, nextRun: stale });

      await bridge.reconcileSchedules();

      expect(schedule.nextRun).toBe(stale);
      expect(ranNow).toHaveLength(0);
    });

    it('ignores a schedule whose cron can never match', async () => {
      addSchedule('broken', { nextRun: iso(-1 * DAY) });
      bridge.activeSchedules.set('broken', { type: 'cron-invalid' });

      await bridge.reconcileSchedules();

      expect(ranNow).toHaveLength(0);
    });

    it('tolerates jitter around nextRun without replaying', async () => {
      addSchedule('just-fired', { nextRun: iso(-5 * 1000) });

      await bridge.reconcileSchedules();

      expect(ranNow).toHaveLength(0);
    });
  });

  describe('a missing nextRun', () => {
    it('is filled in without triggering a run', async () => {
      const schedule = addSchedule('no-next-run', { nextRun: null });

      await bridge.reconcileSchedules();

      expect(new Date(schedule.nextRun).getTime()).toBeGreaterThan(Date.now());
      expect(ranNow).toHaveLength(0);
    });
  });

  describe('enableSchedule', () => {
    it('re-arms nextRun so enabling does not look like a missed run', async () => {
      const schedule = addSchedule('paused', { enabled: false, nextRun: iso(-30 * DAY) });

      await bridge.enableSchedule('paused');
      await bridge.reconcileSchedules();
      await new Promise(resolve => setImmediate(resolve));

      expect(new Date(schedule.nextRun).getTime()).toBeGreaterThan(Date.now());
      expect(ranNow).toHaveLength(0);
    });
  });

  describe('reactivateSchedules', () => {
    it('records an activation failure against the schedule instead of failing silently', async () => {
      const schedule = addSchedule('cannot-activate');
      jest.spyOn(bridge, 'activateSchedule').mockRejectedValue(new Error('scheduler unavailable'));

      await bridge.reactivateSchedules();

      expect(schedule.activationError).toBe('scheduler unavailable');
    });
  });
});
