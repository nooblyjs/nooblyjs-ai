/**
 * @fileoverview Retrieve an authentication token from ARIS for the
 * infrastructure-design workflows. Mirrors the authToken step of the other
 * projects; the shared credentials + auth logic lives in
 * common/architecture/authentication/authenticateStep.js.
 *
 * @author Digital Technologies Team
 * @version 0.1.0
 */

'use strict';

const authenticateStep = require('../../common/architecture/authentication/authenticateStep');

/**
 * Retrieve an authentication token from ARIS (cached when still valid).
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @returns {Promise<Object>} A promise that resolves with a completion message object
 */
async function run(data) {

    // Add required settings to the data object for authentication.
    data.settings = authenticateStep.arisCredentials();
    data.settings.datafolder = process.env.design_infrastructure_datafolder;

    // Authenticate (or reuse a cached token).
    const response = await authenticateStep.authenticate(data.settings);
    const result = {
        'response': response,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };
    return result;
}

module.exports = {
  run,
};
