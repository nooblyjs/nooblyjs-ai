/**
 * @fileoverview Tests for WorkflowBridge.listWorkflowExecutions — one
 * workflow's history read across the per-day execution files.
 *
 * The bug this guards: GET /api/executions answers from TODAY only and pages
 * 100 records across every workflow, so a workflow running on a tight cadence
 * buries the rest and their history reads as lost. This method walks the day
 * files newest-first for a single workflow instead.
 */

'use strict';

const WorkflowBridge = require('../../../src/datasources/lib/workflowBridge');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const os = require('node:os');

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const dayKey = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.toISOString().slice(0, 10);
};

describe('WorkflowBridge.listWorkflowExecutions', () => {
  let bridge;
  let tmpRoot;
  let executionsDir;

  /** Seed a day with execution records, written into the per-day/per-workflow
   *  layout the bridge now uses: executions/<day>/<workflowId>.json. Records are
   *  grouped by their sanitized workflow id so each lands in the right file. */
  const seedDay = async (key, records) => {
    const dayDir = path.join(executionsDir, key);
    await fs.mkdir(dayDir, { recursive: true });
    const byKey = new Map();
    for (const rec of records) {
      const raw = String(rec.workflowId || rec.workflowName || rec.name || '');
      const fileKey = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || '_unassigned';
      if (!byKey.has(fileKey)) byKey.set(fileKey, []);
      byKey.get(fileKey).push(rec);
    }
    for (const [fileKey, recs] of byKey) {
      await fs.writeFile(path.join(dayDir, `${fileKey}.json`), JSON.stringify(recs, null, 2));
    }
  };

  /** Seed a LEGACY flat per-day file (executions/<day>.json) for migration tests. */
  const seedFlatDay = async (key, records) => {
    await fs.mkdir(executionsDir, { recursive: true });
    await fs.writeFile(path.join(executionsDir, `${key}.json`), JSON.stringify(records, null, 2));
  };

  /** A completed run of `workflowId`, `minute` minutes past midnight of `day`. */
  const run = (workflowId, day, minute, overrides = {}) => ({
    id: `${workflowId}-${day}-${minute}`,
    workflowId,
    name: workflowId,
    startedAt: `${day}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00.000Z`,
    completedAt: `${day}T00:00:05.000Z`,
    status: 'completed',
    outcome: 'success',
    duration: 5000,
    result: { rows: 'x'.repeat(64) },
    steps: [{ stepName: 'one', status: 'completed' }],
    ...overrides,
  });

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-exec-'));
    bridge = new WorkflowBridge({ logger: silentLogger, appBaseDir: path.join(tmpRoot, '.application') });
    bridge.workflowsPath = path.join(tmpRoot, 'workflows');
    executionsDir = bridge.executionsDir;
  });

  afterEach(async () => {
    try {
      if (fsSync.existsSync(tmpRoot)) await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  test('finds a quiet workflow\'s runs behind a noisy neighbour, across days', async () => {
    // Today is dominated by a high-cadence workflow; the one we want ran twice,
    // days ago — exactly the history the shared today-only page loses.
    const today = Array.from({ length: 300 }, (_, i) => run('busy-flow', dayKey(0), i));
    today.splice(150, 0, run('quiet-flow', dayKey(0), 150));
    await seedDay(dayKey(0), today);
    await seedDay(dayKey(3), [run('quiet-flow', dayKey(3), 10), run('busy-flow', dayKey(3), 11)]);
    await seedDay(dayKey(9), [run('quiet-flow', dayKey(9), 12)]);

    const res = await bridge.listWorkflowExecutions('quiet-flow', { days: 30 });

    expect(res.executions).toHaveLength(3);
    expect(res.executions.every(e => e.workflowId === 'quiet-flow')).toBe(true);
    expect(res.stats.total).toBe(3);
    expect(res.stats.succeeded).toBe(3);
    expect(res.stats.successRate).toBe(100);
  });

  test('returns rows newest first', async () => {
    await seedDay(dayKey(0), [run('flow', dayKey(0), 60)]);
    await seedDay(dayKey(2), [run('flow', dayKey(2), 30), run('flow', dayKey(2), 90)]);

    const res = await bridge.listWorkflowExecutions('flow', { days: 30 });
    const stamps = res.executions.map(e => e.startedAt);

    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  test('caps rows at `limit` while stats still count the whole window', async () => {
    await seedDay(dayKey(0), Array.from({ length: 40 }, (_, i) => run('flow', dayKey(0), i)));
    await seedDay(dayKey(1), Array.from({ length: 40 }, (_, i) => run('flow', dayKey(1), i)));

    const res = await bridge.listWorkflowExecutions('flow', { days: 30, limit: 10 });

    expect(res.executions).toHaveLength(10);
    expect(res.stats.total).toBe(80);
    expect(res.window.matched).toBe(80);
    expect(res.window.truncated).toBe(true);
    // The newest ten, not the oldest ten of the newest day.
    expect(res.executions[0].startedAt).toBe(run('flow', dayKey(0), 39).startedAt);
  });

  test('the `days` window excludes older day files', async () => {
    await seedDay(dayKey(1), [run('flow', dayKey(1), 1)]);
    await seedDay(dayKey(20), [run('flow', dayKey(20), 1)]);

    const recent = await bridge.listWorkflowExecutions('flow', { days: 7 });
    const all = await bridge.listWorkflowExecutions('flow', { days: 0 });

    expect(recent.stats.total).toBe(1);
    expect(recent.window.days).toBe(7);
    expect(all.stats.total).toBe(2);
    expect(all.window.days).toBeNull();
  });

  test('status filter selects rows but leaves the stats whole-window', async () => {
    await seedDay(dayKey(0), [
      run('flow', dayKey(0), 1),
      run('flow', dayKey(0), 2, { status: 'failed', outcome: 'failed', error: 'boom' }),
      run('flow', dayKey(0), 3, { status: 'running', outcome: null, duration: null }),
    ]);

    const failed = await bridge.listWorkflowExecutions('flow', { days: 30, status: 'failed' });

    expect(failed.executions).toHaveLength(1);
    expect(failed.executions[0].status).toBe('failed');
    expect(failed.stats).toMatchObject({ total: 3, succeeded: 1, failed: 1, running: 1 });
  });

  test('rows are summaries — the fat result payload never rides along', async () => {
    await seedDay(dayKey(0), [run('flow', dayKey(0), 1)]);

    const res = await bridge.listWorkflowExecutions('flow', { days: 30 });

    expect(res.executions[0].result).toBeUndefined();
    expect(res.executions[0].steps).toBeUndefined();
    expect(res.executions[0].hasResult).toBe(true);
  });

  test('matches records stamped with the sanitized name of a known workflow', async () => {
    bridge.workflows.set('my-flow', { id: 'my-flow', name: 'My Flow', group: 'design', steps: [] });
    await seedDay(dayKey(0), [
      run('my-flow', dayKey(0), 1),
      { ...run('x', dayKey(0), 2), workflowId: undefined, name: 'My Flow' },
      run('other-flow', dayKey(0), 3),
    ]);

    const res = await bridge.listWorkflowExecutions('My Flow', { days: 30 });

    expect(res.stats.total).toBe(2);
    expect(res.workflow).toMatchObject({ id: 'my-flow', name: 'My Flow', group: 'design' });
  });

  test('includes today\'s in-memory runs that are not on disk yet', async () => {
    await seedDay(dayKey(2), [run('flow', dayKey(2), 1)]);
    bridge.executions = [run('flow', dayKey(0), 5)];

    const res = await bridge.listWorkflowExecutions('flow', { days: 30 });

    expect(res.stats.total).toBe(2);
  });

  test('an unknown workflow answers empty rather than throwing', async () => {
    const res = await bridge.listWorkflowExecutions('nothing-here', { days: 30 });

    expect(res.executions).toEqual([]);
    expect(res.stats).toMatchObject({ total: 0, successRate: 0 });
  });
});

describe('WorkflowBridge per-day/per-workflow persistence', () => {
  let bridge;
  let tmpRoot;
  let executionsDir;

  const rec = (workflowId, overrides = {}) => ({
    id: `${workflowId}-${Math.random().toString(36).slice(2)}`,
    workflowId,
    name: workflowId,
    startedAt: `${dayKey(0)}T10:00:00.000Z`,
    completedAt: `${dayKey(0)}T10:00:05.000Z`,
    status: 'completed',
    outcome: 'success',
    duration: 5000,
    result: { ok: true },
    steps: [],
    ...overrides,
  });

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-persist-'));
    bridge = new WorkflowBridge({ logger: silentLogger, appBaseDir: path.join(tmpRoot, '.application') });
    bridge.workflowsPath = path.join(tmpRoot, 'workflows');
    executionsDir = bridge.executionsDir;
    await bridge.loadTodayExecutions(); // primes _loadedDay + _dirtyWorkflowKeys
  });

  afterEach(async () => {
    try {
      if (fsSync.existsSync(tmpRoot)) await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  test('addExecution writes a separate file per workflow under a day directory', async () => {
    await bridge.addExecution(rec('alpha'));
    await bridge.addExecution(rec('beta'));

    const dayDir = path.join(executionsDir, dayKey(0));
    const files = (await fs.readdir(dayDir)).filter(f => f.endsWith('.json')).sort();

    expect(files).toEqual(['alpha.json', 'beta.json']);
    // Each file holds only its own workflow's runs.
    const alpha = JSON.parse(await fs.readFile(path.join(dayDir, 'alpha.json'), 'utf8'));
    expect(alpha.every(e => e.workflowId === 'alpha')).toBe(true);
  });

  test('a busy workflow does not grow another workflow\'s file', async () => {
    for (let i = 0; i < 50; i++) await bridge.addExecution(rec('busy'));
    await bridge.addExecution(rec('quiet'));

    const dayDir = path.join(executionsDir, dayKey(0));
    const busy = JSON.parse(await fs.readFile(path.join(dayDir, 'busy.json'), 'utf8'));
    const quiet = JSON.parse(await fs.readFile(path.join(dayDir, 'quiet.json'), 'utf8'));

    expect(busy).toHaveLength(50);
    expect(quiet).toHaveLength(1);
  });

  test('addExecution upserts a running placeholder into its final record', async () => {
    const id = 'run-1';
    await bridge.addExecution(rec('flow', { id, status: 'running', outcome: null, completedAt: null }));
    await bridge.addExecution(rec('flow', { id, status: 'completed', outcome: 'success' }));

    const file = path.join(executionsDir, dayKey(0), 'flow.json');
    const records = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('completed');
  });

  test('a write leaves no leftover .tmp files (atomic rename)', async () => {
    await bridge.addExecution(rec('flow'));
    const dayDir = path.join(executionsDir, dayKey(0));
    const leftover = (await fs.readdir(dayDir)).filter(f => f.includes('.tmp'));
    expect(leftover).toEqual([]);
  });

  test('a corrupt per-workflow file is quarantined and does not sink the day read', async () => {
    const dayDir = path.join(executionsDir, dayKey(0));
    await fs.mkdir(dayDir, { recursive: true });
    // Simulate an interrupted write: valid file + a truncated one.
    await fs.writeFile(path.join(dayDir, 'good.json'), JSON.stringify([rec('good')], null, 2));
    await fs.writeFile(path.join(dayDir, 'bad.json'), '[{"id":"x","result":"unterminated');

    const all = await bridge._loadDayFile(dayKey(0));

    expect(all.every(e => e.workflowId === 'good')).toBe(true);
    // The bad file was renamed aside for inspection, not left to fail again.
    const names = await fs.readdir(dayDir);
    expect(names.some(n => n.startsWith('bad.json.corrupt-'))).toBe(true);
    expect(names).not.toContain('bad.json');
  });

  test('listExecutions with a date range reads across the new layout', async () => {
    const seedInto = async (day, workflowId) => {
      const dir = path.join(executionsDir, day);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${workflowId}.json`),
        JSON.stringify([rec(workflowId, { startedAt: `${day}T09:00:00.000Z` })], null, 2)
      );
    };
    await seedInto(dayKey(1), 'a');
    await seedInto(dayKey(1), 'b');
    await seedInto(dayKey(2), 'a');

    const res = await bridge.listExecutions({ dateFrom: dayKey(2), dateTo: dayKey(1) });
    expect(res).toHaveLength(3);
  });

  test('clearExecutions by date removes the whole day directory', async () => {
    const day = dayKey(1);
    const dir = path.join(executionsDir, day);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'flow.json'), JSON.stringify([rec('flow')], null, 2));

    const deleted = await bridge.clearExecutions({ date: day });

    expect(deleted).toBe(1);
    expect(fsSync.existsSync(dir)).toBe(false);
  });

  test('deleteExecution finds and removes a record from a historical per-workflow file', async () => {
    const day = dayKey(3);
    const dir = path.join(executionsDir, day);
    await fs.mkdir(dir, { recursive: true });
    const target = rec('flow', { id: 'target', startedAt: `${day}T08:00:00.000Z` });
    await fs.writeFile(path.join(dir, 'flow.json'), JSON.stringify([target, rec('flow')], null, 2));

    const ok = await bridge.deleteExecution('target');

    expect(ok).toBe(true);
    const remaining = JSON.parse(await fs.readFile(path.join(dir, 'flow.json'), 'utf8'));
    expect(remaining.some(e => e.id === 'target')).toBe(false);
  });
});

describe('WorkflowBridge.migrateOldExecutions', () => {
  let bridge;
  let tmpRoot;
  let executionsDir;
  let workflowDir;

  const rec = (workflowId, day, overrides = {}) => ({
    id: `${workflowId}-${day}-${Math.random().toString(36).slice(2)}`,
    workflowId,
    name: workflowId,
    startedAt: `${day}T10:00:00.000Z`,
    completedAt: `${day}T10:00:05.000Z`,
    status: 'completed',
    outcome: 'success',
    duration: 1000,
    ...overrides,
  });

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-migrate-'));
    bridge = new WorkflowBridge({ logger: silentLogger, appBaseDir: path.join(tmpRoot, '.application') });
    bridge.workflowsPath = path.join(tmpRoot, 'workflows');
    executionsDir = bridge.executionsDir;
    workflowDir = path.dirname(executionsDir); // .application/workflow
    await fs.mkdir(executionsDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      if (fsSync.existsSync(tmpRoot)) await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  test('migrates the monolithic file into per-day/per-workflow files', async () => {
    const monolithic = [
      rec('alpha', dayKey(0)),
      rec('beta', dayKey(0)),
      rec('alpha', dayKey(2)),
    ];
    await fs.writeFile(path.join(workflowDir, 'workflows.executions.json'), JSON.stringify(monolithic));

    await bridge.migrateOldExecutions();

    expect(fsSync.existsSync(path.join(executionsDir, dayKey(0), 'alpha.json'))).toBe(true);
    expect(fsSync.existsSync(path.join(executionsDir, dayKey(0), 'beta.json'))).toBe(true);
    expect(fsSync.existsSync(path.join(executionsDir, dayKey(2), 'alpha.json'))).toBe(true);
    // Original retired, not left to re-migrate.
    expect(fsSync.existsSync(path.join(workflowDir, 'workflows.executions.json'))).toBe(false);
    expect(fsSync.existsSync(path.join(workflowDir, 'workflows.executions.json.migrated'))).toBe(true);
  });

  test('migrates legacy flat per-day files into per-workflow files', async () => {
    const day = dayKey(1);
    await fs.writeFile(
      path.join(executionsDir, `${day}.json`),
      JSON.stringify([rec('alpha', day), rec('beta', day), rec('alpha', day)])
    );

    await bridge.migrateOldExecutions();

    const alpha = JSON.parse(await fs.readFile(path.join(executionsDir, day, 'alpha.json'), 'utf8'));
    const beta = JSON.parse(await fs.readFile(path.join(executionsDir, day, 'beta.json'), 'utf8'));
    expect(alpha).toHaveLength(2);
    expect(beta).toHaveLength(1);
    expect(fsSync.existsSync(path.join(executionsDir, `${day}.json`))).toBe(false);
  });

  test('a corrupt legacy flat file is quarantined, not fatal', async () => {
    const day = dayKey(1);
    // Truncated JSON — the exact production failure shape.
    await fs.writeFile(path.join(executionsDir, `${day}.json`), '[{"id":"x","result":"unterm');

    await expect(bridge.migrateOldExecutions()).resolves.toBeUndefined();

    const names = await fs.readdir(executionsDir);
    expect(names.some(n => n.startsWith(`${day}.json.corrupt-`))).toBe(true);
  });

  test('migration is a no-op when there is nothing to migrate', async () => {
    await expect(bridge.migrateOldExecutions()).resolves.toBeUndefined();
    const names = await fs.readdir(executionsDir);
    expect(names).toEqual([]);
  });

  test('migrated records are readable through listWorkflowExecutions', async () => {
    const day = dayKey(0);
    await fs.writeFile(
      path.join(workflowDir, 'workflows.executions.json'),
      JSON.stringify([rec('alpha', day), rec('alpha', dayKey(3))])
    );

    await bridge.migrateOldExecutions();
    await bridge.loadTodayExecutions();
    const res = await bridge.listWorkflowExecutions('alpha', { days: 30 });

    expect(res.stats.total).toBe(2);
  });
});
