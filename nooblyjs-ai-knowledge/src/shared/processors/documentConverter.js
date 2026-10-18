/**
 * @fileoverview Document → Markdown converter dispatcher.
 * Picks the right processor by extension and returns markdown as a string —
 * it never writes to disk, leaving persistence (e.g. the derived sidecar) to
 * the caller.
 *
 * PPTX is intentionally unsupported here: its parser needs a browser `window`
 * and fails under Node, so presentations fall back to download-only.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

/**
 * Convert a supported office/pdf document to markdown.
 * @async
 * @param {string} filePath - Absolute path to the source document.
 * @returns {Promise<string>} Markdown content.
 * @throws {Error} If the extension is not supported or conversion fails.
 */
async function convertToMarkdown(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.docx' || ext === '.doc') {
    return require('./docxprocessor').convertToMarkdown(filePath);
  }
  if (ext === '.pdf') {
    return require('./pdfprocessor').convertToMarkdown(filePath);
  }
  if (ext === '.xlsx' || ext === '.xls') {
    return require('./xlsxprocessor').convertToMarkdown(filePath);
  }

  throw new Error(`Unsupported file type for markdown conversion: ${ext || '(none)'}`);
}

/** Extensions this dispatcher can convert. */
const SUPPORTED_EXTENSIONS = new Set(['.docx', '.doc', '.pdf', '.xlsx', '.xls']);

/**
 * @param {string} filePath
 * @returns {boolean} True if convertToMarkdown can handle this file.
 */
function canConvert(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

module.exports = {
  convertToMarkdown,
  canConvert,
  SUPPORTED_EXTENSIONS
};
