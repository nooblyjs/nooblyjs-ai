/**
 * @fileoverview Build the infrastructure wiki content (folders + pages) from the
 * retrieved/cached data. Mirrors
 * business-processes/steps/businessProcessesContent.js.
 *
 * @author NooblyJS Team
 * @version 0.1.0
 */

'use strict';

// Load our settings
require('dotenv').config({path:'../../../.env'});

// Shared step helpers (ARIS credentials + authentication)
const authenticateStep = require('../../common/architecture/authentication/authenticateStep');

// The infrastructures inventory service
const InfrastructuresClass = require('../services/infrastructures');

/**
 * Build the infrastructure content from the cached data.
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @returns {Promise<Object>} A promise that resolves with a completion message object
 */
async function run(data) {

    // Add required settings to the data object for authentication.
    data.settings = authenticateStep.arisCredentials();
    data.settings.contentfolder = data.contentfolder || process.env.design_infrastructure_contentfolder;
    data.settings.datafolder = process.env.design_infrastructure_datafolder;
    data.settings.useCache = data.useCache ?? true;
    data.settings.cacheAgeDays = data.cacheAgeDays ?? 1;

    // Instantiate the classes we need
    const infrastructures = new InfrastructuresClass(data.settings);

    // Authenticate the user (graphics may be refetched during the build)
    await authenticateStep.authenticate(data.settings);

    // Build the Infrastructure content
    let infrastructuresContent;
    try {
        infrastructuresContent = await infrastructures.buildInfrastructuresContent(data.filter, data.settings.useCache);
    } catch (error) {
        console.log(error);
    }

    const result = {
        'response': infrastructuresContent,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };
    return result;
}

module.exports = {
  run,
};
