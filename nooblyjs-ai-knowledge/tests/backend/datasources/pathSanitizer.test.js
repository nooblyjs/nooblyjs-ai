/**
 * @fileoverview Tests for pathSanitizer utility
 * Tests sanitizeDirectoryName and validateWorkflowPath functions
 */

'use strict';

const { sanitizeDirectoryName, validateWorkflowPath } = require('../../../src/datasources/utils/pathSanitizer');

describe('pathSanitizer', () => {
  describe('sanitizeDirectoryName', () => {
    test('should convert to lowercase', () => {
      expect(sanitizeDirectoryName('MyWorkflow')).toBe('myworkflow');
      expect(sanitizeDirectoryName('UPPERCASE')).toBe('uppercase');
    });

    test('should replace spaces with hyphens', () => {
      expect(sanitizeDirectoryName('my workflow')).toBe('my-workflow');
      expect(sanitizeDirectoryName('test   multiple   spaces')).toBe('test-multiple-spaces');
    });

    test('should remove special characters', () => {
      expect(sanitizeDirectoryName('my@workflow!')).toBe('myworkflow');
      expect(sanitizeDirectoryName('test#$%^&*()')).toBe('test');
    });

    test('should remove path separators', () => {
      expect(sanitizeDirectoryName('path/to/workflow')).toBe('pathtoworkflow');
      expect(sanitizeDirectoryName('path\\to\\workflow')).toBe('pathtoworkflow');
      expect(sanitizeDirectoryName('path-to-workflow')).toBe('path-to-workflow');
    });

    test('should collapse multiple hyphens', () => {
      expect(sanitizeDirectoryName('my---workflow')).toBe('my-workflow');
      expect(sanitizeDirectoryName('test--name')).toBe('test-name');
    });

    test('should remove leading and trailing hyphens', () => {
      expect(sanitizeDirectoryName('-myworkflow-')).toBe('myworkflow');
      expect(sanitizeDirectoryName('--test--')).toBe('test');
    });

    test('should reject reserved Windows names', () => {
      expect(() => sanitizeDirectoryName('con')).toThrow('reserved word');
      expect(() => sanitizeDirectoryName('prn')).toThrow('reserved word');
      expect(() => sanitizeDirectoryName('aux')).toThrow('reserved word');
      expect(() => sanitizeDirectoryName('nul')).toThrow('reserved word');
      expect(() => sanitizeDirectoryName('com1')).toThrow('reserved word');
      expect(() => sanitizeDirectoryName('lpt1')).toThrow('reserved word');
    });

    test('should reject parent directory references', () => {
      expect(() => sanitizeDirectoryName('..')).toThrow();
      expect(() => sanitizeDirectoryName('.')).toThrow();
    });

    test('should reject invalid input', () => {
      expect(() => sanitizeDirectoryName(null)).toThrow('Invalid directory name');
      expect(() => sanitizeDirectoryName(undefined)).toThrow('Invalid directory name');
      expect(() => sanitizeDirectoryName(123)).toThrow('Invalid directory name');
      expect(() => sanitizeDirectoryName('')).toThrow('Invalid directory name');
    });

    test('should truncate names longer than 100 characters', () => {
      const longName = 'a'.repeat(150);
      const result = sanitizeDirectoryName(longName);
      expect(result.length).toBe(100);
      expect(result).toBe('a'.repeat(100));
    });

    test('should handle real-world workflow names', () => {
      expect(sanitizeDirectoryName('Data Import Workflow')).toBe('data-import-workflow');
      expect(sanitizeDirectoryName('ETL Process 2024')).toBe('etl-process-2024');
      expect(sanitizeDirectoryName('My-API-Integration')).toBe('my-api-integration');
    });
  });

  describe('validateWorkflowPath', () => {
    test('should accept valid paths within base directory', () => {
      const baseDir = '/home/user/workflows';
      const validPath = '/home/user/workflows/my-workflow';
      expect(() => validateWorkflowPath(validPath, baseDir)).not.toThrow();
    });

    test('should accept normalized paths', () => {
      const baseDir = '/home/user/workflows';
      const validPath = '/home/user/workflows/my-workflow';
      expect(() => validateWorkflowPath(validPath, baseDir)).not.toThrow();
    });

    test('should reject paths outside base directory', () => {
      const baseDir = '/home/user/workflows';
      const invalidPath = '/home/user/other';
      expect(() => validateWorkflowPath(invalidPath, baseDir)).toThrow('Path traversal');
    });

    test('should reject paths with .. sequences', () => {
      const baseDir = '/home/user/workflows';
      const invalidPath = '/home/user/workflows/../../../etc/passwd';
      expect(() => validateWorkflowPath(invalidPath, baseDir)).toThrow();
    });

    test('should reject obvious path traversal attempts', () => {
      const baseDir = '/home/user/workflows';
      const invalidPath = '/home/user/workflows/../etc/passwd';
      expect(() => validateWorkflowPath(invalidPath, baseDir)).toThrow();
    });

    test('should handle Windows-style paths', () => {
      const baseDir = 'C:\\Users\\workflows';
      const validPath = 'C:\\Users\\workflows\\my-workflow';
      expect(() => validateWorkflowPath(validPath, baseDir)).not.toThrow();
    });
  });
});
