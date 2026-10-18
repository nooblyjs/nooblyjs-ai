/**
 * @fileoverview Tests for WorkflowManager
 * Tests workflow CRUD operations after refactoring
 */

'use strict';

const WorkflowManager = require('../../../src/datasources/components/workflowManager');
const path = require('node:path');
const fs = require('node:fs').promises;
const fsSync = require('node:fs');

describe('WorkflowManager', () => {
  let manager;
  const testDir = path.join(__dirname, '../.application-test/workflows');

  beforeEach(() => {
    // Create test manager with test directory
    manager = new WorkflowManager({
      logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    });
    // Override workflowsPath for testing
    manager.workflowsPath = testDir;
    manager.metadataFile = path.join(__dirname, '../.application-test/workflows-metadata.json');
  });

  afterEach(async () => {
    // Cleanup test files
    try {
      if (fsSync.existsSync(testDir)) {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('initialization', () => {
    test('should initialize successfully', async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
      expect(manager.workflows).toEqual([]);
    });

    test('should create workflows directory if it does not exist', async () => {
      await manager.initialize();
      expect(fsSync.existsSync(manager.workflowsPath)).toBe(true);
    });
  });

  describe('CRUD operations', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should create a workflow', async () => {
      const workflowData = {
        name: 'Test Workflow',
        description: 'A test workflow',
        steps: [
          { id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }
        ],
        tags: ['test']
      };

      const workflow = await manager.createWorkflow(workflowData);

      expect(workflow).toBeDefined();
      expect(workflow.name).toBe('Test Workflow');
      expect(workflow.description).toBe('A test workflow');
      expect(workflow.steps.length).toBe(1);
      expect(workflow.id).toBe('test-workflow');
    });

    test('should list workflows', async () => {
      const workflow1 = await manager.createWorkflow({
        name: 'Workflow 1',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      const workflow2 = await manager.createWorkflow({
        name: 'Workflow 2',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      const workflows = manager.listWorkflows();
      expect(workflows.length).toBe(2);
      expect(workflows.some(w => w.id === 'workflow-1')).toBe(true);
      expect(workflows.some(w => w.id === 'workflow-2')).toBe(true);
    });

    test('should get a workflow by ID', async () => {
      const created = await manager.createWorkflow({
        name: 'Test Workflow',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      const retrieved = manager.getWorkflow('test-workflow');
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.name).toBe(created.name);
    });

    test('should throw error when getting non-existent workflow', () => {
      expect(() => manager.getWorkflow('non-existent')).toThrow('Workflow not found');
    });

    test('should update a workflow', async () => {
      const created = await manager.createWorkflow({
        name: 'Original Name',
        description: 'Original description',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      const updated = await manager.updateWorkflow('original-name', {
        name: 'Updated Name',
        description: 'Updated description'
      });

      expect(updated.name).toBe('Updated Name');
      expect(updated.description).toBe('Updated description');
    });

    test('should delete a workflow', async () => {
      const created = await manager.createWorkflow({
        name: 'To Delete',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      await manager.deleteWorkflow('to-delete');

      expect(() => manager.getWorkflow('to-delete')).toThrow('Workflow not found');
    });

    test('should filter workflows by tags', async () => {
      await manager.createWorkflow({
        name: 'Tagged Workflow',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }],
        tags: ['important']
      });

      await manager.createWorkflow({
        name: 'Untagged Workflow',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }],
        tags: []
      });

      const filtered = manager.listWorkflows({ tags: ['important'] });
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Tagged Workflow');
    });

    test('should filter workflows by starred status', async () => {
      const starred = await manager.createWorkflow({
        name: 'Starred Workflow',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      await manager.updateWorkflow('starred-workflow', { starred: true });

      const unstarred = await manager.createWorkflow({
        name: 'Unstarred Workflow',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      const filtered = manager.listWorkflows({ starred: true });
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('Starred Workflow');
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should reject workflow with no name', async () => {
      expect(async () => {
        await manager.createWorkflow({
          steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
        });
      }).rejects.toThrow();
    });

    test('should reject workflow with no steps', async () => {
      expect(async () => {
        await manager.createWorkflow({
          name: 'No Steps',
          steps: []
        });
      }).rejects.toThrow();
    });

    test('should reject duplicate workflow names', async () => {
      await manager.createWorkflow({
        name: 'Duplicate Test',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      expect(async () => {
        await manager.createWorkflow({
          name: 'Duplicate Test',
          steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
        });
      }).rejects.toThrow();
    });
  });

  describe('persistence', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should persist workflow to filesystem', async () => {
      const created = await manager.createWorkflow({
        name: 'Persistent Workflow',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      const definitionFile = path.join(manager.workflowsPath, 'persistent-workflow', 'workflow-definition.json');
      expect(fsSync.existsSync(definitionFile)).toBe(true);

      const data = await fs.readFile(definitionFile, 'utf8');
      const definition = JSON.parse(data);
      expect(definition.name).toBe('Persistent Workflow');
    });

    test('should load workflows from filesystem on next initialization', async () => {
      const created = await manager.createWorkflow({
        name: 'To Load',
        steps: [{ id: 'step1', name: 'Step 1', type: 'api', url: 'http://example.com' }]
      });

      // Create new manager and initialize
      const newManager = new WorkflowManager({
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn()
        }
      });
      newManager.workflowsPath = testDir;
      newManager.metadataFile = path.join(__dirname, '../.application-test/workflows-metadata.json');

      await newManager.initialize();

      const loaded = newManager.listWorkflows();
      expect(loaded.length).toBe(1);
      expect(loaded[0].name).toBe('To Load');
    });
  });
});
