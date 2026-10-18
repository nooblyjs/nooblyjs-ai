/**
 * @fileoverview Manual test harness for the infrastructure-design authToken step.
 * Boots digital-technologies-core and runs steps/authToken.js so the ARIS auth
 * token can be retrieved (and cached) in isolation.
 *
 * @author Digital Technologies Team
 * @version 0.1.0
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
const settings = {};

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
    'authToken.js',
     { settings: settings },
    function (status, result) {
        console.log('Worker completed with status:', status);
        console.log('Worker result:', result);
    }
).then((taskId) => {
    logger.info('Design Infrastructure Auth Token Task with ID:', taskId);
}).catch((err) => {
    logger.error('Failed to queue Design Infrastructure Auth Token Task:', err);
});
