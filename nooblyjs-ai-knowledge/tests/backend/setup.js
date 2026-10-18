/**
 * @fileoverview Jest setup file
 * Initializes test environment
 */

'use strict';

// Set test environment
process.env.NODE_ENV = 'test';

// Suppress console output during tests unless there's an error
const originalError = console.error;
const originalLog = console.log;
const originalWarn = console.warn;

beforeAll(() => {
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  console.error = originalError;
  console.log = originalLog;
  console.warn = originalWarn;
});
