/**
 * @fileoverview Retieve the Business Solutions Data
 * This worker retrieves the required data
 * @author NooblyJS Team
 * @version 1.0.14
 * @lastupdated 2026-04-30
 */

'use strict';

// Load our settings
require('dotenv').config({path:'../../../.env'});

// Shared step helpers (ARIS credentials + authentication)
const authenticateStep = require('../../common/architecture/authentication/authenticateStep');

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

    // Determine if a filter is being passed
    /*
    if (data.filter == null){
        throw new Error("Error no filter is being passed. This could be determental to the source system. Please add a filter e.g {\"Responsible Technology Executive\": \"Executive Name\"}");
    }
    */    

    // Add required settings to the data object for authentication
    data.settings = authenticateStep.arisCredentials();
    data.settings.contentfolder = data.contentfolder || process.env.design_solution_contentfolder;
    data.settings.datafolder = process.env.design_solution_datafolder;
    // Cache controls (read by the shared model.js / graphic.js via settings):
    //   useCache=false  → always refetch from ARIS (daily catch-all)
    //   useCache=true   → reuse cache for models settled > cacheAgeDays days
    data.settings.useCache = data.useCache ?? true;
    data.settings.cacheAgeDays = data.cacheAgeDays ?? 1;


    // Instantiate the classes we need
    const businessSolutions = new BusinessSolutionsClass(data.settings);

    // Authenticate the user
    await authenticateStep.authenticate(data.settings);
    
    // Retrieve the Business Solutions Data
    try {
        var businessSolutionsData = await businessSolutions.retrieveBusinessSolutionsData(data.filter, data.settings.useCache);
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
