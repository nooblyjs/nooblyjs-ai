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

// The business solutions class is used to retrieve and publish a Business Processes
const BusinessProcessesClass = require('../services/businessProcesses')

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
    // Cache controls (read by the shared model.js / graphic.js via settings):
    //   useCache=false  → always refetch from ARIS (daily catch-all)
    //   useCache=true   → reuse cache for models settled > cacheAgeDays days
    data.settings.useCache = data.useCache ?? true;
    data.settings.cacheAgeDays = data.cacheAgeDays ?? 1;

    // Instantiate the classes we need
    const authenticate = new AuthenticateClass(data.settings);
    const businessProcesses = new BusinessProcessesClass(data.settings);
    
    // Authenticate the user
    let response = await authenticate.authenticate();
    data.settings.token = response.token;
    
    // Retrieve the Business Processes Data
    try {
        var businessProcessescontent = await buildBusinessProcessesContent(data.filter, data.settings.useCache);  
    } catch (error) {
        console.log(error);   
    }
    
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
