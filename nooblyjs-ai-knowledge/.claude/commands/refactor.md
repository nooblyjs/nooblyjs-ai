# Refactor Codebase for Modern Standards

  Refactor the selected code or entire codebase to use modern JavaScript best practices and create a safe, clean, well-documented
  application.

  ## Objectives

  1. **Modern JavaScript Syntax**
     - Replace Promise chains with `async/await`
     - Use destructuring for function parameters and object/array assignments
     - Apply arrow functions where appropriate
     - Use `const`/`let` instead of `var`
     - Implement template literals instead of string concatenation

  2. **Code Quality & Safety**
     - Remove all `console.log()` statements (use proper logging service)
     - Add proper error handling with try/catch blocks
     - Validate input parameters at function entry points
     - Remove hardcoded values and magic numbers
     - Use strict mode (`'use strict'`) at module level
     - Prevent SQL injection, XSS, and command injection vulnerabilities
     - Add JSDoc comments for all exported functions and classes

  3. **Documentation Standards (Google JavaScript Style Guide)**
     - Add file header comments with purpose and dependencies
     - Add class/function JSDoc comments with @param, @returns, @throws, @example
     - Document complex logic with inline comments
     - Include usage examples for public APIs
     - Document service dependencies and initialization order

  4. **Code Organization**
     - Group related functions and maintain consistent structure
     - Extract magic numbers/strings to named constants
     - Remove dead code and unused variables
     - Ensure consistent naming conventions (camelCase for variables/functions, PascalCase for classes)
     - Move configuration to config files or environment variables

  5. **Testing & Reliability**
     - Ensure all functions are testable (dependency injection where appropriate)
     - Add error handling for edge cases
     - Validate function return types match documentation
     - Handle async operations properly with timeout considerations

  6. **Service Integration**
     - Use the ServiceRegistry for dependency injection
     - Leverage the logging service instead of console statements
     - Follow the factory pattern for service initialization
     - Use the global EventEmitter for inter-service communication

  ## Refactoring Checklist

  For each file:
  - [ ] Convert Promise chains to async/await
  - [ ] Add/update JSDoc comments
  - [ ] Add file header comment
  - [ ] Remove console.log statements
  - [ ] Apply destructuring
  - [ ] Add input validation
  - [ ] Handle errors properly
  - [ ] Use const/let instead of var
  - [ ] Extract magic numbers to constants
  - [ ] Verify functionality remains unchanged
  - [ ] Run tests to confirm no regressions

  ## Before & After Examples

  ### Promise to Async/Await
  ```javascript
  // Before
  function getData() {
    return fetch('/api/data')
      .then(res => res.json())
      .then(data => processData(data))
      .catch(err => console.error(err));
  }

  // After
  /**
   * Fetches and processes data from the API.
   * @returns {Promise<Object>} The processed data
   * @throws {Error} If the API call fails
   */
  async function getData() {
    try {
      const res = await fetch('/api/data');
      const data = await res.json();
      return processData(data);
    } catch (err) {
      this.logger.error('Failed to fetch data', err);
      throw err;
    }
  }

  Destructuring

  // Before
  function registerService(options) {
    const provider = options.provider;
    const apiKey = options.apiKey;
    const timeout = options.timeout;
  }

  // After
  /**
   * Registers a new service with the given options.
   * @param {Object} options - Configuration options
   * @param {string} options.provider - Provider type
   * @param {string} options.apiKey - API authentication key
   * @param {number} options.timeout - Request timeout in ms
   */
  function registerService({ provider, apiKey, timeout }) {
    // implementation
  }

  File Header & Comments

  /**
   * @fileoverview Queue service factory and management.
   * Provides FIFO queue operations with support for multiple providers
   * (memory, api, redis, etc).
   * 
   * @author nooblyjs-core
   * @version 2.0.0
   */

  'use strict';

  const { validateInput } = require('../utils');
  const logger = require('../logging');

  /**
   * Queue service factory function.
   * Creates and initializes a queue service with the specified provider.
   * 
   * @param {string} providerType - Type of provider ('memory', 'api', 'redis')
   * @param {Object} options - Service configuration
   * @param {Express} options['express-app'] - Express application instance
   * @param {EventEmitter} events - Global event emitter for service communication
   * @returns {Object} Queue service instance with methods: enqueue, dequeue, size, clear
   * @throws {Error} If provider type is unsupported
   * 
   * @example
   * const queueService = require('./queue');
   * const queue = queueService('memory', { 'express-app': app }, events);
   * await queue.enqueue({ task: 'process-data', id: 123 });
   */
  module.exports = function queueServiceFactory(providerType, options, events) {
    // implementation
  };

  Output Requirements

  - Maintain 100% backward compatibility with existing APIs
  - All existing tests must pass
  - Update test files to use modern syntax alongside source files
  - Document any breaking changes (if unavoidable)
  - Provide migration guide for deprecated patterns (if any)

  This command provides a comprehensive refactoring strategy that goes beyond the basics to ensure the codebase becomes safe,
  well-documented, and maintainable while adhering to Google JavaScript standards and the architecture outlined in your CLAUDE.md
  file.
