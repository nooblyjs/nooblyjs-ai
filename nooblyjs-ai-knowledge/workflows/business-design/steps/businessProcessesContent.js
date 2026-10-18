/**
 * @fileoverview Retieve the Business Processes Content
 * This worker builds the wiki content folders/pages from the retrieved data
 * @author NooblyJS Team
 * @version 1.0.14
 * @lastupdated 2026-04-30
 */

'use strict';

// Load our settings
require('dotenv').config({path:'../../../.env'});

// Shared step helpers (ARIS credentials + authentication)
const authenticateStep = require('../../common/architecture/authentication/authenticateStep');

// The business processes class is used to retrieve and publish a Business Processes
const BusinessProcessesClass = require('../services/businessProcesses')

/**
 * Build the Business Processes content from the ARIS system.
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @param {Object} data.server - The ARIS server to call
 * @param {Object} data.username - The ARIS usermane
 * @param {Object} data.password - The ARIS password
 * @param {Object} data.contentfolder - The folder path to store content
 * @param {Object} data.tempfolder - The folder path to store temporary files
 * @returns {Promise<Object>} A promise that resolves with a completion message object
 */
async function run(data) {

    // Add required settings to the data object for authentication
    data.settings = authenticateStep.arisCredentials();
    data.settings.contentfolder = process.env.design_process_contentfolder;
    data.settings.datafolder = process.env.design_process_datafolder;
    data.settings.useCache = data.useCache ?? true;
    data.settings.cacheAgeDays = data.cacheAgeDays ?? 1;

    // Instantiate the classes we need
    const businessProcesses = new BusinessProcessesClass(data.settings);

    // Authenticate the user
    await authenticateStep.authenticate(data.settings);

    // Build the Business Processes content
    try {
        var businessProcessesContent = await businessProcesses.buildBusinessProcessesContent(data.filter, data.settings.useCache);
    } catch (error) {
        console.log(error);
    }

    // return our content that was built
    const result = {
        'response': businessProcessesContent,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };
    return result;
}

module.exports = {
  run,
};
