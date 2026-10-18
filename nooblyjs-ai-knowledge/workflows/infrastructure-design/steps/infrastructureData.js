/**
 * @fileoverview Retrieve the infrastructure data from ARIS and cache it (model
 * JSON + graphics) ready for the content build. Mirrors
 * business-processes/steps/businessProcessesData.js.
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
 * Retrieve and cache the infrastructure data from ARIS.
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
    // Cache controls (read by the shared model.js / graphic.js via settings):
    //   useCache=false  → always refetch from ARIS (daily catch-all)
    //   useCache=true   → reuse cache for models settled > cacheAgeDays days
    data.settings.useCache = data.useCache ?? true;
    data.settings.cacheAgeDays = data.cacheAgeDays ?? 1;

    // Instantiate the classes we need
    const infrastructures = new InfrastructuresClass(data.settings);

    // Authenticate the user
    await authenticateStep.authenticate(data.settings);

    // Retrieve the Infrastructure data
    let infrastructuresData;
    try {
        infrastructuresData = await infrastructures.retrieveInfrastructuresData(data.filter, data.settings.useCache);
    } catch (error) {
        console.log(error);
    }

    const result = {
        'response': infrastructuresData,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };
    return result;
}

module.exports = {
  run,
};
