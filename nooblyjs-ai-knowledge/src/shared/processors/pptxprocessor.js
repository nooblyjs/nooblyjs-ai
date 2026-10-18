/**
 * @fileoverview PPTX to Markdown converter
 * Converts Microsoft PowerPoint presentations to markdown format
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const PPTXParser = require('pptx-parser');

/**
 * Converts a PPTX file to markdown format
 * @async
 * @param {string} pptxFilePath - Absolute path to the PPTX file
 * @param {string} outputMdPath - Path where markdown output will be saved
 * @returns {Promise<string>} Markdown formatted content
 * @throws {Error} If PPTX processing or file operations fail
 */
async function convertToMarkdown(pptxFilePath, outputMdPath) {
  try {
    const parser = new PPTXParser();
    const presentation = await parser.parse(pptxFilePath);

    let markdown = `# ${presentation.title || 'Presentation'}\n\n`;

    presentation.slides.forEach((slide, index) => {
      markdown += `## Slide ${index + 1}\n\n`;

      slide.texts.forEach(text => {
        markdown += `${text}\n\n`;
      });
    });

    await fs.writeFile(outputMdPath, markdown, 'utf8');

    return markdown;
  } catch (error) {
    throw error;
  }
}

/**
 * Check if a file is a PPTX file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is PPTX
 */
function isPptxFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.pptx' || ext === '.ppt';
}

module.exports = {
    convertToMarkdown,
    isPptxFile
};
