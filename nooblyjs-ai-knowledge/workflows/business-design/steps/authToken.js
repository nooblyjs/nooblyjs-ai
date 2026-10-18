/**
 * @fileoverview Retrieve authentication token from ARIS system.
 * This worker is used to retrieve the auth token required for accessing ARIS APIs. And store it for caching purposes.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @lastupdated 2026-03-06
 */

'use strict';

let path = require('node:path');
const authenticateStep = require('../../common/architecture/authentication/authenticateStep');

/**
 * Retrieve authentication token from ARIS system.
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

    // Add required settings to the data object for authentication. The
    // datafolder is where the token is cached (authtoken.json), so it must be
    // this project's own folder — the later steps look for the token there.
    data.settings = authenticateStep.arisCredentials();
    data.settings.datafolder = process.env.design_process_datafolder;

    // Call the authentication utility to get the auth token or use cached token if valid.
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
