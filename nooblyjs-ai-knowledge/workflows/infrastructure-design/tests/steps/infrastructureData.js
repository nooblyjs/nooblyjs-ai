/**
 * @fileoverview Manual test harness for the infrastructure-design
 * infrastructureData step. Boots nooblyjs-core and runs
 * steps/infrastructureData.js to retrieve and cache the infrastructure model
 * JSON + graphics from ARIS.
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
    'infrastructureData.js',
     { settings: settings, useCache: true, cacheAgeDays: 1 },
    function (status, result) {
        console.log('Worker completed with status:', status);
        console.log('Worker result:', result);
    }
).then((taskId) => {
    logger.info('Design Infrastructure Data Task with ID:', taskId);
}).catch((err) => {
    logger.error('Failed to queue Design Infrastructure Data Task:', err);
});
