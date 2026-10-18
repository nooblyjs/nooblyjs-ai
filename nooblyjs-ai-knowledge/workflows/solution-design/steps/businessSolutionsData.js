/**
 * @fileoverview Retieve the Business Solutions Data
 * This worker retrieves the required data
 * @author Digital Technologies Team
 * @version 1.0.14
 * @lastupdated 2026-04-30
 */

'use strict';

// Load our settings
require('dotenv').config({path:'../../../.env'});

// The authentication class is used to retrieve the auth token required for accessing ARIS APIs. And store it for caching purposes.
const AuthenticateClass = require('../../common/architecture/authentication/Authenticate');

// The business solutions class is used to retrieve and publish a Business Solutions (Business Capabilities / Business Processes / Business Applications)
const BusinessSolutionsClass = require('../services/businessSolutions')

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
    data.settings.contentfolder = data.contentfolder || process.env.design_solution_contentfolder;
    data.settings.datafolder = process.env.design_solution_datafolder;

    // Instantiate the classes we need
    const authenticate = new AuthenticateClass(data.settings);
    const businessSolutions = new BusinessSolutionsClass(data.settings);
    
    // Authenticate the user
    let response = await authenticate.authenticate();
    data.settings.token = response.token;
    
    // Retrieve the Business Solutions Data
    var businessSolutionsData = await businessSolutions.retrieve()
    
    // return our solutions that were built
    const result = {
        'response': businessSolutionsData,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };
    return result;
}

module.exports = {
  run,
};
