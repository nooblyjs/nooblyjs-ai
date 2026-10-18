/**
 * @fileoverview Test the design-documents clean-document workflow step.
 *
 * Converts the example DOCX to markdown, then runs the clean-document step
 * directly (in-process) to clean it into a separate output file.
 *
 * The step resolves its AI expert from the Agents registry (global.aiInstances),
 * so the test must initialize that registry and run the step in this same
 * process — a worker thread would not share the registry.
 *
 * @author Digital Technologies Team
 * @version 2.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs').promises;
const express = require('express');

// Load environment variables from the repository-root .env file.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Core service registry + the datasources AI-instance bootstrap.
const serviceRegistry = require('nooblyjs-core');
const { initializeAIInstances } = require('../../../../src/datasources/lib/aiInstances');

// DOCX converters (to produce the markdown the step cleans) + the step itself.
const docxToJson = require('../../services/docxToJson');
const jsonToMarkdown = require('../../services/jsonToMarkdown');
const cleanDocumentStep = require('../../steps/clean-document');

// Base data directory — defaults to <repo-root>/.application (matches app.js).
const APP_BASE_DIR = process.env.APP_BASE_DIR
  ? path.resolve(process.env.APP_BASE_DIR)
  : path.join(__dirname, '../../../../../../.application');

// Test file paths
const exampleDir = path.join(__dirname, '../example');
const sourceDocx = path.join(exampleDir, 'Solution Vision - Yard Management WR11704.docx');

// Settings passed to the clean-document step. The step resolves its own AI
// agent from the Agents registry (usage tag "Document Processing") — no provider
// is specified here.
const settings = {
    sourceDocument: path.join(exampleDir, 'Solution Vision - Yard Management WR11704.md'),
    outputDocument: path.join(exampleDir, 'Solution Vision - Yard Management WR11704.cleaned.md'),
    maxChunkSize: 4000
};

/**
 * Convert the example DOCX to markdown, then run the clean-document step.
 */
async function runTest() {
    // Bootstrap the service registry + configured AI agents in THIS process.
    // The step resolves its expert from global.aiInstances, so it must run
    // in-process — a worker thread would not see the registry.
    const app = express();
    app.use(express.json());
    serviceRegistry.initialize(app);
    const log = serviceRegistry.logger();
    await initializeAIInstances({ serviceRegistry, app, log, appBaseDir: APP_BASE_DIR });

    // The step expects markdown — convert the example DOCX first.
    const doc = await docxToJson.convertToJson(sourceDocx);
    const { markdown } = jsonToMarkdown.convertWithStats(doc);
    await fs.writeFile(settings.sourceDocument, markdown, 'utf-8');

    // Run the clean-document step directly (in-process).
    const result = await cleanDocumentStep.run({ settings });
    console.log('Step result:', result);

    const succeeded = Boolean(result && result.response && result.response.success);
    process.exit(succeeded ? 0 : 1);
}

runTest().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
