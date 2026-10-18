/**
 * @fileoverview Test the engineering-code code-processor workflow step.
 *
 * Runs the code-processor step directly (in-process) over a source code
 * folder, producing .home.md documentation files.
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
const express = require('express');

// Load environment variables from the repository-root .env file.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Core service registry + the datasources AI-instance bootstrap.
const serviceRegistry = require('nooblyjs-core');
const { initializeAIInstances } = require('../../../../src/datasources/lib/aiInstances');

// The code-processor step under test.
const codeProcessorStep = require('../../steps/code-processor');

// Base data directory — defaults to <repo-root>/.application (matches app.js).
const APP_BASE_DIR = process.env.APP_BASE_DIR
  ? path.resolve(process.env.APP_BASE_DIR)
  : path.join(__dirname, '../../../../../../.application');

// Input passed to the code-processor step. The step resolves its own AI agent
// from the Agents registry (usage tag "Code Processing") — no provider here.
const input = {
    sourceFolder: 'C:\\work-dt\\.application\\spaces\\working\\engineering-code\\digital-technologies-core',
    markdownFolder: 'C:\\work-dt\\digital-technologies-knowledge-content\\Technology\\Digital Technologies\\Knowledge Repository\\Engineering'
};

/**
 * Bootstrap the service registry + configured AI agents, then run the
 * code-processor step directly (in-process).
 */
async function runTest() {
    // The step resolves its expert from global.aiInstances, so it must run
    // in-process — a worker thread would not see the registry.
    const app = express();
    app.use(express.json());
    serviceRegistry.initialize(app);
    const log = serviceRegistry.logger();
    await initializeAIInstances({ serviceRegistry, app, log, appBaseDir: APP_BASE_DIR });

    // Run the code-processor step directly (in-process).
    const result = await codeProcessorStep.run(input);
    console.log('Step result:', result);

    const succeeded = Boolean(result && result.message && result.message.success);
    process.exit(succeeded ? 0 : 1);
}

runTest().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
