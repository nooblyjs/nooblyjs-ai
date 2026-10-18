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

    // Add required settings to the data object for authentication
    data.settings = {};
    data.settings.server = process.env.aris_server;
    data.settings.username = process.env.aris_username;
    data.settings.password = process.env.aris_password;
    data.settings.database = encodeURIComponent("Acme Architecture Modeling");
    data.settings.datafolder = process.env.design_process_datafolder;

    // Call the authentication utility to get the auth token or use cached token if valid.
    const AuthenticateClass = require('../../common/architecture/authentication/Authenticate');
    const authenticate = new AuthenticateClass(data.settings);
    let response = await authenticate.authenticate();
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
