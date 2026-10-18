/**
 * @fileoverview Run the full architecture solution workflow
 *
 * @author Digital Technologies Team
 * @version 2.0.0
 */
'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });
console.log(process.env.aris_server);

const express = require('express');
const app = express();
app.use(express.json());

const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app);

const settings = {};
settings.server = process.env.aris_server;
settings.username = process.env.aris_username;
settings.password = process.env.aris_password;
settings.database = encodeURIComponent("Acme Architecture Modeling");
settings.contentfolder = process.env.design_process_contentfolder;
settings.datafolder = process.env.design_process_datafolder;

const cache = serviceRegistry.cache();
const logger = serviceRegistry.logger();
const queue = serviceRegistry.queue('memory');

const worker = serviceRegistry.working('default', {
    maxThreads: 1,
    activitiesFolder: path.join(__dirname, '../../steps/'),
    dependencies: { queue, logger }
});

const workflow = serviceRegistry.workflow();

workflow.defineWorkflow('design-business-processes', [
    'authToken.js',
    "steps/businessProcessesData.js",
    "steps/businessProcessesContent.js"
]);

workflow.runWorkflow('design-business-processes', { settings: settings, useCache: true, cacheAgeDays: 1 }, (status) => {
    logger.info(`Workflow status: ${status.status}`, status);
});
