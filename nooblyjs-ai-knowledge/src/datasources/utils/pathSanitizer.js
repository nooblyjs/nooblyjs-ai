/**
 * @fileoverview Path Sanitization Utilities
 * Provides consistent directory name and path validation across datasources module
 * Prevents path traversal attacks and ensures cross-platform compatibility
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

/**
 * Sanitize directory name to prevent path traversal
 * Removes dangerous characters and patterns
 * @param {string} name - Directory name to sanitize
 * @returns {string} Sanitized directory name
 * @throws {Error} If name is invalid or becomes empty after sanitization
 */
function sanitizeDirectoryName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Invalid directory name');
  }

  // Remove all path separators and dangerous characters
  let sanitized = name
    .toLowerCase()
    .replace(/[\/\\.]/g, '') // Remove path separators and dots
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/[^a-z0-9-]/g, '') // Only allow alphanumeric and hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  // Block dangerous names (Windows reserved words and special cases)
  const blacklist = ['con', 'prn', 'aux', 'nul', 'com1', 'com2', 'com3', 'com4',
                     'lpt1', 'lpt2', 'lpt3', '..', '.'];
  if (blacklist.includes(sanitized)) {
    throw new Error('Invalid directory name (reserved word)');
  }

  // Ensure minimum length
  if (sanitized.length < 1) {
    throw new Error('Directory name too short after sanitization');
  }

  // Ensure maximum length
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  return sanitized;
}

/**
 * Validate that workflow path is within the workflows directory
 * Prevents path traversal attacks
 * @param {string} workflowPath - Path to validate
 * @param {string} baseDir - Base directory to validate against
 * @returns {string} Validated path
 * @throws {Error} If path traversal attempt is detected
 */
function validateWorkflowPath(workflowPath, baseDir) {
  const normalizedPath = path.normalize(workflowPath);
  const normalizedBase = path.normalize(baseDir);

  // Ensure the path is within the base directory
  if (!normalizedPath.startsWith(normalizedBase)) {
    throw new Error('Path traversal attempt detected');
  }

  // Ensure no .. sequences
  if (normalizedPath.includes('..')) {
    throw new Error('Invalid path: contains parent directory references');
  }

  return normalizedPath;
}

module.exports = {
  sanitizeDirectoryName,
  validateWorkflowPath
};
