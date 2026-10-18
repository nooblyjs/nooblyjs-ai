/**
 * @fileoverview DOCX to Markdown converter
 * Converts Microsoft Word documents to markdown format
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 */

'use strict';

const mammoth = require('mammoth');
const path = require('node:path');
const docxToJson = require('./docxToJson');
const jsonToMarkdown = require('./jsonToMarkdown');

/**
 * Convert a DOCX file to markdown.
 *
 * Uses the structured path (Mammoth → HTML → structured JSON → markdown) which
 * preserves table grids, heading hierarchy, lists and images. Mammoth's own
 * markdown writer flattens tables into loose paragraphs, so it is kept only as
 * a last-resort fallback when the structured path fails or yields nothing.
 *
 * @async
 * @param {string} filePath - Absolute path to the DOCX file
 * @returns {Promise<string>} Markdown formatted content
 * @throws {Error} If DOCX processing fails in both the structured and fallback paths
 */
async function convertToMarkdown(filePath) {
  try {
    const doc = await docxToJson.convertToJson(filePath);
    const markdown = jsonToMarkdown.convert(doc);
    if (markdown && markdown.trim()) {
      return markdown;
    }
    // Empty structured output (e.g. a doc with no recognised blocks) — fall back.
    const result = await mammoth.convertToMarkdown({ path: filePath });
    return result.value;
  } catch (structuredError) {
    // Structured conversion failed; try Mammoth's markdown writer before giving up.
    try {
      const result = await mammoth.convertToMarkdown({ path: filePath });
      return result.value;
    } catch (fallbackError) {
      throw new Error(`Failed to convert DOCX to markdown: ${structuredError.message}`);
    }
  }
}

/**
 * Check if a file is a DOCX file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is DOCX
 */
function isDocxFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.docx';
}

module.exports = {
    convertToMarkdown,
    isDocxFile
};
