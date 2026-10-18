/**
 * @fileoverview Tests for WorkflowBridge multi-file / hierarchical grouping
 * Covers loading several workflow-definition[-<suffix>].json files per folder,
 * deriving "<folder> / <suffix>" group labels, and routing writes (create /
 * update / delete) to the correct definition file via the stamped sourceFile.
 */

'use strict';

const WorkflowBridge = require('../../../src/datasources/lib/workflowBridge');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const os = require('node:os');

const silentLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('WorkflowBridge multi-file grouping', () => {
  let bridge;
  let tmpRoot;
  let workflowsPath;

  const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

  // Helper to seed a definition file with an array of workflows.
  const seed = async (folder, fileName, definitions) => {
    const dir = path.join(workflowsPath, folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, fileName), JSON.stringify(definitions, null, 2));
  };

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'wf-bridge-'));
    workflowsPath = path.join(tmpRoot, 'workflows');
    await fs.mkdir(workflowsPath, { recursive: true });

    bridge = new WorkflowBridge({ logger: silentLogger, appBaseDir: path.join(tmpRoot, '.application') });
    bridge.workflowsPath = workflowsPath;
  });

  afterEach(async () => {
    try {
      if (fsSync.existsSync(tmpRoot)) {
        await fs.rm(tmpRoot, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe('loadWorkflows', () => {
    test('derives group from the bare file (folder name) and suffixed files', async () => {
      await seed('design-solution', 'workflow-definition.json', [
        { name: 'Base Flow', steps: [] }
      ]);
      await seed('design-solution', 'workflow-definition-data.json', [
        { name: 'Retrieve Data', steps: [] }
      ]);
      await seed('design-solution', 'workflow-definition-architecture.json', [
        { name: 'Retrieve Architecture', steps: [] }
      ]);

      await bridge.loadWorkflows();

      const byId = (id) => bridge.workflows.get(id);
      expect(byId('base-flow').group).toBe('design-solution');
      expect(byId('retrieve-data').group).toBe('design-solution / data');
      expect(byId('retrieve-architecture').group).toBe('design-solution / architecture');
    });

    test('stamps each workflow with the source file it was loaded from', async () => {
      await seed('design-solution', 'workflow-definition-data.json', [
        { name: 'Retrieve Data', steps: [] }
      ]);

      await bridge.loadWorkflows();

      expect(bridge.workflows.get('retrieve-data').sourceFile).toBe('workflow-definition-data.json');
    });

    test('an explicit group field overrides the suffix-derived label', async () => {
      await seed('design-solution', 'workflow-definition-data.json', [
        { name: 'Custom Grouped', group: 'My Custom Group', steps: [] }
      ]);

      await bridge.loadWorkflows();

      expect(bridge.workflows.get('custom-grouped').group).toBe('My Custom Group');
    });
  });

  describe('updateWorkflow', () => {
    test('writes back only to the originating suffixed file', async () => {
      await seed('design-solution', 'workflow-definition-data.json', [
        { name: 'Retrieve Data', description: 'old', steps: [] }
      ]);
      await seed('design-solution', 'workflow-definition-architecture.json', [
        { name: 'Retrieve Architecture', description: 'untouched', steps: [] }
      ]);
      await bridge.loadWorkflows();

      await bridge.updateWorkflow('retrieve-data', { description: 'new' });

      const dataFile = await readJson(path.join(workflowsPath, 'design-solution', 'workflow-definition-data.json'));
      const archFile = await readJson(path.join(workflowsPath, 'design-solution', 'workflow-definition-architecture.json'));

      expect(dataFile[0].description).toBe('new');
      expect(archFile[0].description).toBe('untouched');
    });
  });

  describe('deleteWorkflow', () => {
    test('removes the emptied file but leaves sibling sub-group files and the folder intact', async () => {
      await seed('design-solution', 'workflow-definition-data.json', [
        { name: 'Retrieve Data', steps: [] }
      ]);
      await seed('design-solution', 'workflow-definition-architecture.json', [
        { name: 'Retrieve Architecture', steps: [] }
      ]);
      await bridge.loadWorkflows();

      await bridge.deleteWorkflow('retrieve-data');

      const folder = path.join(workflowsPath, 'design-solution');
      expect(fsSync.existsSync(path.join(folder, 'workflow-definition-data.json'))).toBe(false);
      expect(fsSync.existsSync(path.join(folder, 'workflow-definition-architecture.json'))).toBe(true);
      expect(fsSync.existsSync(folder)).toBe(true);
    });

    test('removes the whole folder when the last definition file is emptied', async () => {
      await seed('solo-group', 'workflow-definition-only.json', [
        { name: 'Only Flow', steps: [] }
      ]);
      await bridge.loadWorkflows();

      await bridge.deleteWorkflow('only-flow');

      expect(fsSync.existsSync(path.join(workflowsPath, 'solo-group'))).toBe(false);
    });

    test('keeps sibling workflows when one is removed from a multi-workflow file', async () => {
      await seed('design-solution', 'workflow-definition-data.json', [
        { name: 'Retrieve Data', steps: [] },
        { name: 'Retrieve More Data', steps: [] }
      ]);
      await bridge.loadWorkflows();

      await bridge.deleteWorkflow('retrieve-data');

      const dataFile = await readJson(path.join(workflowsPath, 'design-solution', 'workflow-definition-data.json'));
      expect(dataFile).toHaveLength(1);
      expect(dataFile[0].name).toBe('Retrieve More Data');
    });
  });

  describe('createWorkflow', () => {
    const oneStep = [{ name: 'Step 1', config: { type: 'identity' } }];

    test('a hierarchical group writes to the matching suffixed file', async () => {
      const created = await bridge.createWorkflow({
        name: 'New Data Flow',
        group: 'design-solution / data',
        steps: oneStep,
        tags: []
      });

      expect(created.group).toBe('design-solution / data');
      expect(created.sourceFile).toBe('workflow-definition-data.json');

      const file = path.join(workflowsPath, 'design-solution', 'workflow-definition-data.json');
      expect(fsSync.existsSync(file)).toBe(true);
      const contents = await readJson(file);
      expect(contents[0].name).toBe('New Data Flow');
    });

    test('a plain group still writes to the bare workflow-definition.json', async () => {
      const created = await bridge.createWorkflow({
        name: 'Plain Flow',
        group: 'plain-group',
        steps: oneStep,
        tags: []
      });

      expect(created.sourceFile).toBe('workflow-definition.json');
      expect(fsSync.existsSync(path.join(workflowsPath, 'plain-group', 'workflow-definition.json'))).toBe(true);
    });

    test('rejects a duplicate workflow name even in a different sub-group file', async () => {
      await seed('design-solution', 'workflow-definition-data.json', [
        { name: 'Shared Name', steps: [] }
      ]);
      await bridge.loadWorkflows();

      await expect(
        bridge.createWorkflow({ name: 'Shared Name', group: 'design-solution / architecture', steps: oneStep, tags: [] })
      ).rejects.toThrow(/already exists/);
    });
  });
});
