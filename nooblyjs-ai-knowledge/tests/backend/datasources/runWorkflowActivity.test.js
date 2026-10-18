/**
 * @fileoverview The worker-thread activity that executes SCHEDULED workflows must
 * discover exactly the definition files the WorkflowBridge does.
 *
 * Scheduled runs never pass through `executeWorkflow()`. `workflowBridge.startSchedule`
 * hands the core scheduling service `configuration/activities/run-workflow.js` and
 * nothing but `{ workflowId, payload }`; that activity runs in a worker thread with
 * an isolated service registry, so it cannot ask the bridge anything and re-reads
 * the definitions off disk itself.
 *
 * That second reader only ever opened the bare `workflow-definition.json`, while the
 * bridge loads `workflow-definition-<suffix>.json` too. The result was a workflow
 * that listed in the UI, could be scheduled, ran fine from "Run now" (main process)
 * and then failed at every scheduled fire with "not found on disk" — 26 of 49
 * production workflows, including all nine `Refresh Solution: *`, and the whole
 * `system-context` group, which has no bare file at all.
 *
 * The last describe block is the one that matters: it takes the ID the BRIDGE
 * assigned and asserts the ACTIVITY resolves that same ID, so the two readers
 * cannot silently drift apart again.
 */

'use strict';

// Stub the core registry BEFORE the activity is loaded. Importing
// nooblyjs-core constructs a SystemMonitoring singleton at module scope
// whose interval keeps the whole jest run alive after the tests finish, and its
// registry throws "must be initialized" outside a real worker. The activity only
// reaches it for a logger. (No babel transform here, so the mock registers by call
// order, not hoisting — it must stay above the requires below.)
jest.mock('nooblyjs-core', () => ({
  logger: () => ({ info() {}, warn() {}, error() {}, debug() {} })
}));

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const WorkflowBridge = require('../../../src/datasources/lib/workflowBridge');

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('run-workflow activity — definition discovery', () => {
  let tmpRoot;
  let workflowsPath;
  let activity;

  /** Seed a definition file holding an array of workflow definitions. */
  const seed = (folder, fileName, definitions) => {
    const dir = path.join(workflowsPath, folder);
    fs.mkdirSync(dir, { recursive: true });
    const body = typeof definitions === 'string' ? definitions : JSON.stringify(definitions, null, 2);
    fs.writeFileSync(path.join(dir, fileName), body);
  };

  /**
   * Write a step module that records the context it received into a JSON file,
   * so a test can assert the step actually ran and with what input.
   */
  const seedStep = (folder, stepName, output = {}) => {
    const dir = path.join(workflowsPath, folder, 'steps');
    fs.mkdirSync(dir, { recursive: true });
    const receiptFile = path.join(workflowsPath, folder, `${stepName}.receipt.json`);
    fs.writeFileSync(
      path.join(dir, `${stepName}.js`),
      `'use strict';
       const fs = require('node:fs');
       module.exports.run = async (context) => {
         fs.writeFileSync(${JSON.stringify(receiptFile)}, JSON.stringify(context));
         return ${JSON.stringify(output)};
       };`
    );
    return {
      ranWith: () => JSON.parse(fs.readFileSync(receiptFile, 'utf-8')),
      didRun: () => fs.existsSync(receiptFile)
    };
  };

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'run-wf-'));
    workflowsPath = path.join(tmpRoot, 'workflows');
    fs.mkdirSync(workflowsPath, { recursive: true });

    // WORKFLOWS_BASE is captured at module load, so the env var must be set
    // before the activity is required — and the module cache reset per test.
    jest.resetModules();
    process.env.WORKFLOWS_PATH = workflowsPath;
    activity = require('../../../src/configuration/activities/run-workflow');
  });

  afterEach(() => {
    delete process.env.WORKFLOWS_PATH;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('suffixed definition files', () => {
    test('resolves and runs a workflow defined in workflow-definition-<suffix>.json', async () => {
      // The exact production shape: solution-design/workflow-definition-maintenance.json.
      const step = seedStep('solution-design', 'refresh', { refreshed: true });
      seed('solution-design', 'workflow-definition-maintenance.json', [
        {
          name: 'Refresh Solution: Distribution',
          steps: ['steps/refresh.js'],
          defaultInput: { useCache: false }
        }
      ]);

      const result = await activity.run({ workflowId: 'refresh-solution-distribution' });

      expect(result.success).toBe(true);
      expect(result.stepsExecuted).toBe(1);
      expect(step.didRun()).toBe(true);
    });

    test('still resolves a workflow in the bare workflow-definition.json', async () => {
      seedStep('solution-design', 'build');
      seed('solution-design', 'workflow-definition.json', [
        { name: 'Design Solution: Build Distribution', steps: ['steps/build.js'] }
      ]);

      const result = await activity.run({ workflowId: 'design-solution-build-distribution' });

      expect(result.success).toBe(true);
    });

    test('resolves a group that has no bare definition file at all', async () => {
      // system-context ships only suffixed files — under the old scan the entire
      // group was invisible to the scheduler.
      seedStep('system-context', 'context');
      seed('system-context', 'workflow-definition-ondemand.json', [
        { name: 'Context: Overwrite Context (On-Demand)', steps: ['steps/context.js'] }
      ]);

      await expect(
        activity.run({ workflowId: 'context-overwrite-context-on-demand' })
      ).resolves.toMatchObject({ success: true });
    });

    test('accepts the workflow NAME as well as the sanitized id', async () => {
      seedStep('solution-design', 'refresh');
      seed('solution-design', 'workflow-definition-maintenance.json', [
        { name: 'Refresh Solution: Distribution', steps: ['steps/refresh.js'] }
      ]);

      await expect(
        activity.run({ workflowId: 'Refresh Solution: Distribution' })
      ).resolves.toMatchObject({ resolvedId: 'refresh-solution-distribution' });
    });
  });

  describe('input resolution', () => {
    test('falls back to the definition defaultInput when no payload is supplied', async () => {
      const step = seedStep('solution-design', 'refresh');
      seed('solution-design', 'workflow-definition-maintenance.json', [
        { name: 'Refresh Flow', steps: ['steps/refresh.js'], defaultInput: { useCache: false, cacheAgeDays: 1 } }
      ]);

      await activity.run({ workflowId: 'refresh-flow' });

      expect(step.ranWith()).toEqual({ useCache: false, cacheAgeDays: 1 });
    });

    test('a supplied payload wins over defaultInput', async () => {
      const step = seedStep('solution-design', 'refresh');
      seed('solution-design', 'workflow-definition-maintenance.json', [
        { name: 'Refresh Flow', steps: ['steps/refresh.js'], defaultInput: { useCache: false } }
      ]);

      await activity.run({ workflowId: 'refresh-flow', payload: { useCache: true } });

      expect(step.ranWith()).toEqual({ useCache: true });
    });
  });

  describe('resilience', () => {
    test('a malformed definition file does not hide its readable siblings', async () => {
      // One bad edit must not make every workflow unschedulable.
      seedStep('solution-design', 'refresh');
      seed('solution-design', 'workflow-definition.json', '{ this is not json');
      seed('solution-design', 'workflow-definition-maintenance.json', [
        { name: 'Refresh Flow', steps: ['steps/refresh.js'] }
      ]);

      await expect(activity.run({ workflowId: 'refresh-flow' })).resolves.toMatchObject({ success: true });
    });

    test('ignores files that only look like definition files', async () => {
      seed('solution-design', 'workflow-definition.json.bak', [
        { name: 'Backup Flow', steps: [] }
      ]);
      seed('solution-design', 'my-workflow-definition.json', [
        { name: 'Not A Definition', steps: [] }
      ]);

      await expect(activity.run({ workflowId: 'backup-flow' })).rejects.toThrow(/not found on disk/);
      await expect(activity.run({ workflowId: 'not-a-definition' })).rejects.toThrow(/not found on disk/);
    });

    test('a genuine miss reports how many definitions were scanned', async () => {
      seed('solution-design', 'workflow-definition-maintenance.json', [
        { name: 'Refresh Flow', steps: [] },
        { name: 'Other Flow', steps: [] }
      ]);

      await expect(activity.run({ workflowId: 'no-such-workflow' }))
        .rejects.toThrow(/Scanned 2 definition\(s\)/);
    });

    test('rejects a workflow with no runnable steps rather than reporting success', async () => {
      seed('solution-design', 'workflow-definition-maintenance.json', [
        { name: 'Empty Flow', steps: [] }
      ]);

      await expect(activity.run({ workflowId: 'empty-flow' })).rejects.toThrow(/no steps defined/);
    });

    test('requires a workflowId', async () => {
      await expect(activity.run({})).rejects.toThrow(/Missing required parameter/);
    });
  });

  describe('parity with WorkflowBridge (the drift this bug was)', () => {
    test('every ID the bridge assigns is resolvable by the activity', async () => {
      seedStep('solution-design', 'bare');
      seedStep('solution-design', 'maintenance');
      seedStep('system-context', 'ondemand');

      seed('solution-design', 'workflow-definition.json', [
        { name: 'Design Solution: Build Distribution', steps: ['steps/bare.js'] }
      ]);
      seed('solution-design', 'workflow-definition-maintenance.json', [
        { name: 'Refresh Solution: Distribution', steps: ['steps/maintenance.js'] },
        { name: 'Refresh Solution: Engineering Technologies', steps: ['steps/maintenance.js'] }
      ]);
      seed('system-context', 'workflow-definition-ondemand.json', [
        { name: 'Context: Overwrite Context (On-Demand)', steps: ['steps/ondemand.js'] }
      ]);

      const bridge = new WorkflowBridge({ logger: silentLogger, appBaseDir: path.join(tmpRoot, '.application') });
      bridge.workflowsPath = workflowsPath;
      const loaded = await bridge.loadWorkflows();

      expect(loaded.length).toBe(4);

      // Whatever the bridge lists — and therefore whatever a schedule can be
      // created against — the scheduled run must be able to find.
      for (const workflow of loaded) {
        await expect(activity.run({ workflowId: workflow.id })).resolves.toMatchObject({ success: true });
      }
    });
  });
});
