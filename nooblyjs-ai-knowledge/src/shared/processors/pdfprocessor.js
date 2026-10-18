/**
 * @fileoverview PDF File Processor
 * Converts PDF files to markdown format for document management
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2025-08-24
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const { PDFParse } = require('pdf-parse');

/**
 * Converts a PDF file to markdown format
 * @async
 * @param {string} filePath - Absolute path to the PDF file
 * @returns {Promise<string>} Markdown formatted content
 * @throws {Error} If PDF processing or file operations fail
 */
async function convertToMarkdown(filePath) {
  try {
    const dataBuffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: dataBuffer });
    let data;
    try {
      data = await parser.getText();
    } finally {
      await parser.destroy();
    }

    let markdown = data.text;

    // Enhanced formatting
    markdown = markdown
      // Clean up excessive whitespace
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      // Try to detect headings (lines in all caps or with specific patterns)
      .replace(/^([A-Z][A-Z\s]{3,})$/gm, '## $1')
      // Add list formatting for lines starting with bullets or numbers
      .replace(/^[•●○]\s+/gm, '- ')
      .replace(/^\d+\.\s+/gm, (match) => match)
      .trim();

    // Add metadata. Use path.basename, NOT a split on '/': on Windows the caller
    // passes a backslash-separated absolute path, so splitting on '/' finds no
    // separator and yields the whole path — which then became the document's H1
    // and leaked a machine-local filesystem path into search and AI context.
    const title = path.basename(filePath, path.extname(filePath));
    const header = `# ${title}\n\n---\n\n`;
    markdown = header + markdown;

    // Pure converter: return the markdown and let the caller decide where to
    // persist it (e.g. the folder-local `.system/derived/` sidecar). Writing a
    // sibling .md here would pollute the space tree with a duplicate document.
    return markdown;

  } catch (error) {
    throw error;
  }
}

/**
 * Checks if a file is a PDF file by extension
 * @param {string} filePath - File path to check
 * @returns {boolean} True if file has .pdf extension
 */
function isPDFFile(filePath) {
  return path.extname(filePath).toLowerCase() === '.pdf';
}

module.exports = {
    convertToMarkdown,
    isPDFFile
};