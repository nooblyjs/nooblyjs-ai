/**
 * @fileoverview Manual test harness for the infrastructure-design
 * infrastructureContent step. Boots nooblyjs-core and runs
 * steps/infrastructureContent.js to build the wiki content from the cached
 * infrastructure data.
 *
 * NOTE: run the data step first so the cache is warm. The `filter` is a
 * placeholder — the service does not filter yet.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

// Dependancies
const path = require('node:path');
const express = require('express');

// Load our settings
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// User dependancies
const app = express();
app.use(express.json());

// Initialize registry (no public folder needed!)
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app);

// The settings for testing
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "datafolder": process.env.design_infrastructure_datafolder
}

// Create a worker
const queueing = serviceRegistry.queue();
const logger = serviceRegistry.logger();
const worker = serviceRegistry.working('default', {
    maxThreads: 4,
    activitiesFolder: path.join(__dirname, '../../steps/'),
    dependencies: {
       queueing,
       logger
    }
});

// Start the worker
worker.start(
    'infrastructureContent.js',
     {
        settings: settings,
        filter: {},
        useCache: true,
        cacheAgeDays: 1
     },
    function (status, result) {
        console.log('Worker completed with status:', status);
        console.log('Worker result:', result);
    }
).then((taskId) => {
    logger.info('Design Infrastructure Content Task with ID:', taskId);
}).catch((err) => {
    logger.error('Failed to queue Design Infrastructure Content Task:', err);
});
