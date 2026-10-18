/**
 * @fileoverview Process a code folder and document it with the CodeProcessor
 * service, using a configured AI agent resolved from the Agents registry.
 *
 * An agent tagged with the "Code Processing" usage must exist in the
 * Agents configuration.
 *
 * @author Digital Technologies Team
 * @version 2.0.0
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');
const express = require('express');

// Load environment variables from the repository-root .env file.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Core service registry + the datasources AI-instance bootstrap.
const serviceRegistry = require('nooblyjs-core');
const { initializeAIInstances } = require('../../../../src/datasources/lib/aiInstances');
const CodeProcessorClass = require('../../services/codeProcessor');
const { resolveExpert } = require('../../../../src/shared/ai/expertResolver');

// Base data directory — defaults to <repo-root>/.application (matches app.js).
const APP_BASE_DIR = process.env.APP_BASE_DIR
  ? path.resolve(process.env.APP_BASE_DIR)
  : path.join(__dirname, '../../../../../../.application');

// Data to pass to the processor
const settings = {
    sourceFolder: '',
    markdownFolder: ''
};

/**
 * Bootstrap the service registry + configured AI agents, then run the
 * CodeProcessor over the source folder.
 * @returns {Promise<number>} Process exit code (0 success, 1 failure)
 */
async function runTest() {
    // Bootstrap so the processor can resolve an expert exactly as it does
    // inside the running app.
    const app = express();
    serviceRegistry.initialize(app);
    const log = serviceRegistry.logger();
    await initializeAIInstances({ serviceRegistry, app, log, appBaseDir: APP_BASE_DIR });

    // Resolve a configured agent (usage tag "Code Processing") and run.
    settings.expert = resolveExpert({
        usage: 'Code Processing',
        logger: log,
        label: 'Code Processing'
    });
    const codeProcessor = new CodeProcessorClass(settings);

    const result = await codeProcessor.process();
    console.log('\nResult:', result);
    return result.success ? 0 : 1;
}

runTest()
    .then((code) => process.exit(code))
    .catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
