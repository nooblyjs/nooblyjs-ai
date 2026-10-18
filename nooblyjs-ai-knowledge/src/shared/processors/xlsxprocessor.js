/**
 * @fileoverview XLSX to Markdown converter
 * Converts Microsoft Excel spreadsheets to markdown format
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 */

'use strict';

const XLSX = require('xlsx');
const path = require('node:path');

/**
 * Convert an XLSX file to markdown
 * @param {string} filePath - Absolute path to the XLSX file
 * @returns {Promise<string>} Markdown content
 */
async function convertToMarkdown(filePath) {
    try {
        const workbook = XLSX.readFile(filePath);
        let markdown = '';

        // Process each sheet
        workbook.SheetNames.forEach((sheetName, index) => {
            const sheet = workbook.Sheets[sheetName];

            // Add sheet heading
            if (workbook.SheetNames.length > 1) {
                markdown += `## ${sheetName}\n\n`;
            }

            // Convert sheet to array of arrays
            const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

            if (data.length === 0) {
                markdown += '*Empty sheet*\n\n';
                return;
            }

            // Find the maximum width of each column for proper alignment
            const columnWidths = [];
            data.forEach(row => {
                row.forEach((cell, colIndex) => {
                    const cellStr = String(cell);
                    if (!columnWidths[colIndex] || cellStr.length > columnWidths[colIndex]) {
                        columnWidths[colIndex] = cellStr.length;
                    }
                });
            });

            // Create markdown table
            data.forEach((row, rowIndex) => {
                // Create table row
                const cells = row.map((cell, colIndex) => {
                    const cellStr = String(cell);
                    return cellStr.padEnd(columnWidths[colIndex], ' ');
                });
                markdown += '| ' + cells.join(' | ') + ' |\n';

                // Add header separator after first row
                if (rowIndex === 0) {
                    const separators = columnWidths.map(width => '-'.repeat(width));
                    markdown += '| ' + separators.join(' | ') + ' |\n';
                }
            });

            markdown += '\n';
        });

        return markdown;
    } catch (error) {
        throw new Error(`Failed to convert XLSX to markdown: ${error.message}`);
    }
}

/**
 * Check if a file is an XLSX file
 * @param {string} filePath - Path to check
 * @returns {boolean} True if file is XLSX
 */
function isXlsxFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.xlsx' || ext === '.xls';
}

module.exports = {
    convertToMarkdown,
    isXlsxFile
};
