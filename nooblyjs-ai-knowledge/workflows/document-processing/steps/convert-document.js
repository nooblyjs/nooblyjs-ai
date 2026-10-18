/**
 * @fileoverview Convert a single document file to markdown.
 * Workflow step that takes one source document (DOCX, PDF, PPTX, XLSX) and
 * renders it as markdown, writing the result to the configured output path.
 *
 * This is the "ingest" half of the design-documents pipeline. On its own it
 * powers the wiki drag-and-drop "Design: Convert File" workflow; followed by
 * clean-document.js it forms the full "Design: Process File" pipeline.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @lastupdated 2026-05-31
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const serviceRegistry = require('nooblyjs-core');

// Converters live in the shared `common` group. Load each one defensively so a
// single missing optional dependency does not break the whole step.
const CONVERTERS = [];

function loadConverter(ext, modulePath) {
    try {
        CONVERTERS.push({ ext, converter: require(modulePath) });
    } catch (err) {
        console.warn(`[convert-document] ${ext} converter failed to load: ${err.message}`);
    }
}

loadConverter('.docx', '../../common/convertors/docxprocessor');
loadConverter('.pdf', '../../common/convertors/pdfprocessor');
loadConverter('.pptx', '../../common/convertors/pptxprocessor');
loadConverter('.xlsx', '../../common/convertors/xlsxprocessor');

// Extensions that share a converter (treated as the primary extension above).
const EXT_ALIASES = { '.ppt': '.pptx', '.xls': '.xlsx' };

/**
 * Resolve the converter registered for a given file extension.
 * @param {string} ext - Lower-cased file extension including the dot
 * @returns {Object|null} The converter entry or null if unsupported
 */
function getConverter(ext) {
    const normalized = EXT_ALIASES[ext] || ext;
    return CONVERTERS.find(c => c.ext === normalized) || null;
}

/**
 * Convert a single document file to markdown.
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @param {Object} data.settings - The step settings
 * @param {string} data.settings.sourceDocument - Absolute path to the file to convert
 * @param {string} data.settings.outputDocument - Absolute path to write the markdown
 * @returns {Promise<Object>} Completion message with the rendered markdown
 */
async function run(data) {
    const logger = serviceRegistry.logger();
    const settings = (data && data.settings) || {};
    const { sourceDocument, outputDocument } = settings;

    if (!sourceDocument || !outputDocument) {
        const error = 'Missing required settings: sourceDocument and outputDocument';
        logger.error(`[convert-document] ${error}`);
        return { success: false, error, receivedData: data, processedAt: new Date().toISOString() };
    }

    const ext = path.extname(sourceDocument).toLowerCase();
    const converter = getConverter(ext);

    if (!converter) {
        const supported = CONVERTERS.map(c => c.ext).join(', ') || 'none';
        const error = `Unsupported file type "${ext}". Supported types: ${supported}`;
        logger.error(`[convert-document] ${error}`);
        return { success: false, error, receivedData: data, processedAt: new Date().toISOString() };
    }

    try {
        logger.info(`[convert-document] Converting ${sourceDocument} (${ext}) -> markdown`);

        // The PPTX converter both writes to and requires an output path; the others
        // return the markdown string for the caller to persist.
        const markdown = (ext === '.pptx' || ext === '.ppt')
            ? await converter.converter.convertToMarkdown(sourceDocument, outputDocument)
            : await converter.converter.convertToMarkdown(sourceDocument);

        // Ensure the output directory exists, then write the markdown.
        await fs.mkdir(path.dirname(outputDocument), { recursive: true });
        await fs.writeFile(outputDocument, markdown, 'utf8');

        logger.info(`[convert-document] Wrote markdown to ${outputDocument} (${markdown.length} chars)`);

        return {
            success: true,
            markdown,
            sourceDocument,
            outputDocument,
            processedAt: new Date().toISOString()
        };
    } catch (error) {
        logger.error(`[convert-document] Conversion failed: ${error.message}`);
        return {
            success: false,
            error: error.message,
            receivedData: data,
            processedAt: new Date().toISOString()
        };
    }
}

module.exports = {
    run
};
