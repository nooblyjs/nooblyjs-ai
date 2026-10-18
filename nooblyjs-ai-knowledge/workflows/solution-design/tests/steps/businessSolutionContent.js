/**
 * @fileoverview Process a code folder and create the readme files
 *
 * @author Digital Technologies Team
 * @version 1.0.14
 * @since 1.0.0
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
    "datafolder": process.env.design_solution_datafolder
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
    'businessSolutionContent.js',
     {
        settings: settings,
        filter:{"Roadmap": "117e4011-7cca-11f0-00be-005056bd2116" },
        useCache: true,
        cacheAgeDays: 1
     },
    function (status, result) {
        console.log('Worker completed with status:', status);
        console.log('Worker result:', result);
    }
).then((taskId) => {
    logger.info('Design Solution Auth Token Task with ID:', taskId);
}).catch((err) => {
    logger.error('Failed to queue Design Solution Auth Token Task:', err);
});
