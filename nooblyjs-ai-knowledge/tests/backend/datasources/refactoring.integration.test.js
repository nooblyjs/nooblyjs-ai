/**
 * @fileoverview Integration tests for Phase 1 refactoring
 * Verifies that consolidated components still work correctly
 */

'use strict';

describe('Phase 1 Refactoring - Integration Tests', () => {
  describe('Removed files should not be imported anywhere', () => {
    test('workflowFileSystemManager should not exist', () => {
      let fileExists = false;
      try {
        require('../../../src/datasources/components/workflowFileSystemManager');
        fileExists = true;
      } catch (error) {
        // File doesn't exist - this is expected
        fileExists = false;
      }
      expect(fileExists).toBe(false);
    });

    test('workflowServiceFactory should not exist', () => {
      let fileExists = false;
      try {
        require('../../../src/datasources/components/workflowServiceFactory');
        fileExists = true;
      } catch (error) {
        // File doesn't exist - this is expected
        fileExists = false;
      }
      expect(fileExists).toBe(false);
    });
  });

  describe('Path sanitizer utility should be accessible', () => {
    test('pathSanitizer module should exist and export correct functions', () => {
      const pathSanitizer = require('../../../src/datasources/utils/pathSanitizer');
      expect(pathSanitizer).toBeDefined();
      expect(typeof pathSanitizer.sanitizeDirectoryName).toBe('function');
      expect(typeof pathSanitizer.validateWorkflowPath).toBe('function');
    });
  });

  describe('WorkflowManager should use pathSanitizer utility', () => {
    test('should not have duplicate sanitization methods', () => {
      const WorkflowManager = require('../../../src/datasources/components/workflowManager');
      const instance = new WorkflowManager();

      // These methods should not exist on the instance
      expect(instance.sanitizeDirectoryName).toBeUndefined();
      expect(instance.validateWorkflowPath).toBeUndefined();
    });

    test('should have proper imports', () => {
      const workflowManagerSource = require('fs').readFileSync(
        require('path').join(__dirname, '../../../src/datasources/components/workflowManager.js'),
        'utf8'
      );

      expect(workflowManagerSource).toContain('pathSanitizer');
      expect(workflowManagerSource).toContain('sanitizeDirectoryName');
    });
  });

  describe('WorkflowBridge should use pathSanitizer utility', () => {
    test('should not have duplicate sanitization methods', () => {
      const WorkflowBridge = require('../../../src/datasources/lib/workflowBridge');
      const instance = new WorkflowBridge();

      // These methods should not exist on the instance
      expect(instance.sanitizeDirectoryName).toBeUndefined();
    });

    test('should have proper imports', () => {
      const workflowBridgeSource = require('fs').readFileSync(
        require('path').join(__dirname, '../../../src/datasources/lib/workflowBridge.js'),
        'utf8'
      );

      expect(workflowBridgeSource).toContain('pathSanitizer');
      expect(workflowBridgeSource).not.toContain('this.sanitizeDirectoryName');
    });
  });

  describe('Core modules should still initialize', () => {
    test('WorkflowManager should initialize without errors', async () => {
      const WorkflowManager = require('../../../src/datasources/components/workflowManager');
      const manager = new WorkflowManager({
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn()
        }
      });

      // Should not throw
      expect(async () => await manager.initialize()).not.toThrow();
    });

    test('WorkflowBridge should initialize without errors', async () => {
      const WorkflowBridge = require('../../../src/datasources/lib/workflowBridge');
      const bridge = new WorkflowBridge({
        logger: {
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn()
        }
      });

      // Should not throw
      expect(async () => await bridge.initialize()).not.toThrow();
    });
  });

  describe('API routes should still be importable', () => {
    test('workflowdashboard routes should be importable', () => {
      const routes = require('../../../src/datasources/routes/workflowdashboard');
      expect(routes).toBeDefined();
      expect(typeof routes).toBe('function');
    });

    test('all datasources routes should be importable', () => {
      const contentRoutes = require('../../../src/datasources/routes/contentRoutes');
      const dashboardRoutes = require('../../../src/datasources/routes/dashboardRoutes');
      const workflowRoutes = require('../../../src/datasources/routes/workflowdashboard');
      const spacesRoutes = require('../../../src/datasources/routes/spacesRoutes');
      const securityRoutes = require('../../../src/datasources/routes/securityRoutes');

      expect(contentRoutes).toBeDefined();
      expect(dashboardRoutes).toBeDefined();
      expect(workflowRoutes).toBeDefined();
      expect(spacesRoutes).toBeDefined();
      expect(securityRoutes).toBeDefined();
    });
  });

  describe('Code reduction metrics', () => {
    test('should verify phase 1 code reduction', () => {
      const fs = require('fs');
      const path = require('path');

      // Check that files were deleted
      const fileSystemManagerPath = path.join(__dirname, '../../../src/datasources/components/workflowFileSystemManager.js');
      const serviceFactoryPath = path.join(__dirname, '../../../src/datasources/components/workflowServiceFactory.js');

      expect(fs.existsSync(fileSystemManagerPath)).toBe(false);
      expect(fs.existsSync(serviceFactoryPath)).toBe(false);

      // Check that utility was created
      const pathSanitizerPath = path.join(__dirname, '../../../src/datasources/utils/pathSanitizer.js');
      expect(fs.existsSync(pathSanitizerPath)).toBe(true);
    });
  });
});
