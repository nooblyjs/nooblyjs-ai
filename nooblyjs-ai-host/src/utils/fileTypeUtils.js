/**
 * @fileoverview Utility functions for file type detection and categorization
 * Provides helpers for identifying text-based files that should be cached
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-11
 */

'use strict';

const path = require('node:path');

/**
 * Text-based file extensions that should be cached
 */
const TEXT_EXTENSIONS = [
  // Markdown
  '.md', '.markdown',

  // Plain text
  '.txt', '.csv', '.dat', '.log', '.ini', '.cfg', '.conf',

  // Programming languages
  '.js', '.ts', '.jsx', '.tsx', '.vue',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs',
  '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala',
  '.r', '.m', '.mm', '.pl', '.sh', '.bash', '.ps1', '.bat', '.cmd',

  // Web files
  '.html', '.htm', '.css', '.scss', '.sass', '.less',

  // Data/Configuration
  '.json', '.xml', '.yaml', '.yml', '.toml', '.properties'
];

/**
 * Check if a file is text-based by extension
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if file is text-based
 */
function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.includes(ext);
}

/**
 * Generate cache key for a file
 * @param {string} spaceName - Name of the space
 * @param {string} filePath - Relative path to the file
 * @returns {string} - Cache key in format "{space}-{filepath}"
 */
function generateCacheKey(spaceName, filePath) {
  return `${spaceName}-${filePath}`;
}

/**
 * Get all text file extensions
 * @returns {Array<string>} - Array of text file extensions
 */
function getTextExtensions() {
  return [...TEXT_EXTENSIONS];
}

module.exports = {
  isTextFile,
  generateCacheKey,
  getTextExtensions,
  TEXT_EXTENSIONS
};
