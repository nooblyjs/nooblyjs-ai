/**
 * @fileoverview Tests for WorkflowBridge cron-schedule validation.
 *
 * Regression cover for the "scheduler runs once and never again" bug: a
 * malformed cron expression (e.g. "0 0 0 0 0", whose day-of-month and month are
 * out of range) used to be accepted, then silently degraded to a fallback
 * interval that could never match. These tests assert such expressions are now
 * rejected at create/update time, and that valid expressions still pass.
 */

'use strict';

const WorkflowBridge = require('../../../src/datasources/lib/workflowBridge');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const os = require('node:os');

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

describe('WorkflowBridge cron validation', () => {
  let bridge;
  let tmpRoot;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-sched-'));
    bridge = new WorkflowBridge({ logger: silentLogger, appBaseDir: path.join(tmpRoot, '.application') });
    bridge.workflowsPath = path.join(tmpRoot, 'workflows');
    await fs.mkdir(bridge.workflowsPath, { recursive: true });
    // Pretend a workflow exists so createSchedule's lookup is happy.
    bridge.workflows.set('demo', { id: 'demo', name: 'Demo', steps: [] });
  });

  afterEach(async () => {
    try {
      if (fsSync.existsSync(tmpRoot)) await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  });

  describe('validateCronExpression', () => {
    const valid = ['0 9 * * *', '*/2 * * * *', '0 * * * *', '0 9 * * 1-5', '0,30 8-17 * * *'];
    const invalid = [
      '0 0 0 0 0',   // day-of-month and month are 0 (out of range)
      '60 0 * * *',  // minute 60
      '0 24 * * *',  // hour 24
      '0 0 * 13 *',  // month 13
      '0 0 * * 7',   // day-of-week 7
      '* * *',       // wrong field count
      '0 0 */0 * *'  // step 0
    ];

    test.each(valid)('accepts valid expression "%s"', (expr) => {
      expect(() => bridge.validateCronExpression(expr)).not.toThrow();
    });

    test.each(invalid)('rejects invalid expression "%s"', (expr) => {
      expect(() => bridge.validateCronExpression(expr)).toThrow();
    });
  });

  describe('createSchedule', () => {
    test('rejects a malformed cron and does not persist the schedule', async () => {
      await expect(bridge.createSchedule({
        workflowId: 'demo',
        name: 'Bad Schedule',
        cronExpression: '0 0 0 0 0',
        enabled: false
      })).rejects.toThrow(/out of range/i);

      expect(bridge.schedules).toHaveLength(0);
    });

    test('accepts a valid cron and persists the schedule', async () => {
      const schedule = await bridge.createSchedule({
        workflowId: 'demo',
        name: 'Good Schedule',
        cronExpression: '0 9 * * *',
        enabled: false // keep disabled so we don't need the core scheduling service
      });

      expect(schedule.cronExpression).toBe('0 9 * * *');
      expect(bridge.schedules).toHaveLength(1);
    });
  });

  describe('updateSchedule', () => {
    test('rejects a malformed cron on update', async () => {
      const schedule = await bridge.createSchedule({
        workflowId: 'demo',
        name: 'Good Schedule',
        cronExpression: '0 9 * * *',
        enabled: false
      });

      await expect(bridge.updateSchedule(schedule.id, {
        cronExpression: '0 0 0 0 0'
      })).rejects.toThrow(/out of range/i);

      // Original expression is preserved.
      expect(bridge.getSchedule(schedule.id).cronExpression).toBe('0 9 * * *');
    });
  });
});
