/**
 * @fileoverview Document Cleaner Service Test
 * End-to-end test of the design-documents pipeline:
 *   1. Convert a DOCX file to structured markdown (docxToJson + jsonToMarkdown)
 *   2. Write the markdown to the example folder
 *   3. Clean the markdown with the DocumentCleaner service.
 *
 * The cleaner runs through a configured AI agent resolved from the Agents
 * registry — exactly as it does inside the running app. An agent tagged with
 * the "Document Processing" usage must exist in the Agents configuration.
 *
 * @author NooblyJS Team
 * @version 6.0.0
 */

'use strict';

// Imports and setup
const path = require('node:path');
const fs = require('node:fs').promises;
const express = require('express');

// Load environment variables from the repository-root .env file.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Core service registry + the datasources AI-instance bootstrap.
const serviceRegistry = require('nooblyjs-core');
const { initializeAIInstances } = require('../../../../src/datasources/lib/aiInstances');

// The DOCX converters, the agent resolver, and the cleaner service.
const docxToJson = require('../../services/docxToJson');
const jsonToMarkdown = require('../../services/jsonToMarkdown');
const DocumentCleaner = require('../../services/documentCleaner');
const { resolveExpert } = require('../../../../src/shared/ai/expertResolver');

// Base data directory — defaults to <repo-root>/.application (matches app.js).
const APP_BASE_DIR = process.env.APP_BASE_DIR
  ? path.resolve(process.env.APP_BASE_DIR)
  : path.join(__dirname, '../../../../../../.application');

/**
 * Convert a DOCX file to markdown using the design-documents services.
 * @param {string} docxPath - Path to the source DOCX file
 * @param {string} markdownPath - Path to write the markdown file
 * @returns {Promise<void>}
 */
async function convertDocxToMarkdown(docxPath, markdownPath) {
    const doc = await docxToJson.convertToJson(docxPath);
    const { markdown } = jsonToMarkdown.convertWithStats(doc);
    await fs.writeFile(markdownPath, markdown, 'utf-8');
}

/**
 * Run the end-to-end test of the document cleaning workflow.
 * Steps:
 *   1. Bootstrap the service registry + configured AI agents
 *   2. Convert the example DOCX to markdown
 *   3. Back up the markdown file
 *   4. Clean the markdown with the DocumentCleaner service
 *   5. If cleaning fails, restore the original markdown from backup
 */
async function runTest() {
    try {
        // Bootstrap the service registry + configured AI agents, so the
        // cleaner can resolve an expert exactly as it does inside the app.
        const app = express();
        serviceRegistry.initialize(app);
        const log = serviceRegistry.logger();
        await initializeAIInstances({ serviceRegistry, app, log, appBaseDir: APP_BASE_DIR });

        // Set up file paths
        const exampleDir = path.join(__dirname, '../example');
        const docxFile = path.join(exampleDir, 'Solution Vision - Yard Management WR11704 pdf.docx');
        const testFile = path.join(exampleDir, 'BUSINESS SOLUTION PROPOSAL for Network Visibility and Assurance.md');
        const backupFile = testFile + '.backup';

        // Step 1: Convert DOCX to markdown
        await convertDocxToMarkdown(docxFile, testFile);

        // Create a backup of the freshly converted markdown
        const originalContent = await fs.readFile(testFile, 'utf-8');
        await fs.writeFile(backupFile, originalContent, 'utf-8');

        // Step 2: Clean the markdown with the DocumentCleaner service, using a
        // configured agent (usage tag "Document Processing").
        const expert = resolveExpert({
            usage: 'Document Processing',
            logger: log,
            label: 'Document Processing'
        });
        const cleaner = new DocumentCleaner({
            expert,
            provider: expert.provider,
            deployment: expert.modelName || expert.provider,
            maxChunkSize: 4000
        });
        const result = await cleaner.process(testFile);

        if (result.success) {
            process.exit(0);
        }

        // Cleaning failed — report the error and restore from backup
        console.error(`Document cleaner failed: ${result.error}`);
        try {
            const backupContent = await fs.readFile(backupFile, 'utf-8');
            await fs.writeFile(testFile, backupContent, 'utf-8');
        } catch (restoreError) {
            console.error(`Could not restore from backup: ${restoreError.message}`);
        }
        process.exit(1);

    } catch (error) {
        console.error(`Test execution error: ${error.message}`);
        process.exit(1);
    }
}

// Run the test
runTest().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
