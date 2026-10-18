/**
 * @fileoverview Run the design-process-document workflow.
 * Converts the example DOCX to markdown, then runs the clean-document step
 * through the workflow engine.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs').promises;

// Load our settings
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Instantiate our express server
const express = require('express');
const app = express();
app.use(express.json());

// Initialize registry (no public folder needed!)
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app);

// DOCX converters used to produce the markdown the workflow will clean
const docxToJson = require('../../services/docxToJson');
const jsonToMarkdown = require('../../services/jsonToMarkdown');

// Data to pass to the workflow
const exampleDir = path.join(__dirname, '../example');
const settings = {
      provider: 'ollama',
      sourceDocx: path.join(exampleDir, 'Solution Vision - Yard Management WR11704.docx'),
      sourceDocument: path.join(exampleDir, 'Solution Vision - Yard Management WR11704.md'),
      outputDocument: path.join(exampleDir, 'Solution Vision - Yard Management WR11704.cleaned.md'),
      maxChunkSize: 4000
};

// Get other services
const logger = serviceRegistry.logger();
const queue = serviceRegistry.queue('memory');

// Create a worker
const worker = serviceRegistry.working('default', {
    maxThreads: 4,
    activitiesFolder: path.join(__dirname, '../../steps/'),
    dependencies: {
       queue,
       logger
    }
});

// Create the workflow
const workflow = serviceRegistry.workflow();

// Define the design-process-document workflow — runs the clean-document step
workflow.defineWorkflow('design-process-document', [
    'clean-document.js'
]);

// Convert the DOCX to markdown, then run the workflow
async function runWorkflowTest() {

    // The clean-document step expects markdown — convert the DOCX first
    const doc = await docxToJson.convertToJson(settings.sourceDocx);
    const { markdown } = jsonToMarkdown.convertWithStats(doc);
    await fs.writeFile(settings.sourceDocument, markdown, 'utf-8');

    // Run our workflow
    workflow.runWorkflow('design-process-document', { settings: settings }, (status) => {
        logger.info(`Workflow status: ${status.status}`, status);
    });
}

runWorkflowTest().catch((err) => {
    logger.error('Workflow test failed:', err);
});
