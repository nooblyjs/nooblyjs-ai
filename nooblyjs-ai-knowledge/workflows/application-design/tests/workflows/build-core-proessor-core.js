/**
 * @fileoverview Run a workflow
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */
'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });
console.log(process.env.aris_server);

// Instantiate our express server
const express = require('express');
const app = express();
app.use(express.json());

// Initialize registry (no public folder needed!)
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app);

// Data to pass to the processor
// Data to pass to the processor
const settings = {
    sourceFolder : "C:\\work-dt\\.application\\spaces\\working\\engineering-code\\digital-technologies-core",
    markdownFolder :  "C:\\temp\\",
    apikey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    modelName: process.env.AZURE_OPENAI_MODEL || 'gpt-4',
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4',
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview',
    maxcompletiontokens: parseInt(process.env.AZURE_OPENAI_MAX_TOKENS || '2000')
};

// Get other services
const cache = serviceRegistry.cache();
const logger = serviceRegistry.logger();
const queue = serviceRegistry.queue('memory');
const uiservice = serviceRegistry.uiservice('default');
const dataService = serviceRegistry.dataService();

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

workflow.defineWorkflow('workflow', [
    'code-processor.js'
]);

// Run our workflow
workflow.runWorkflow('workflow', { settings: settings }, (status) => {
    logger.info(`Workflow status: ${status.status}`, status);
});
