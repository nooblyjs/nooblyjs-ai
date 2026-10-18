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

// Shared step helpers (ARIS credentials). This step builds content from cached
// data and does not call ARIS, so it does not authenticate.
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

    // Add required settings to the data object for authentication
    data.settings = authenticateStep.arisCredentials();
    data.settings.contentfolder = data.contentfolder || process.env.design_solution_contentfolder;
    data.settings.datafolder = process.env.design_solution_datafolder;
    if (data.filter ==null){
        data.filter = {};
    }

    // Instantiate the classes we need
    const businessSolutions = new BusinessSolutionsClass(data.settings);
    
    // Generate the Solution Folders
    try {
        var businessSolutionsContent = await businessSolutions.createBusinessSolutionsContent(data.filter)
    }catch (error) {
        console.error(error);
        throw new Error('Error generating Business Solutions content: ' + error.message);
    }
    
    // return our solutions that were built
    const result = {
        'response': businessSolutionsContent,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };
    return result;
}

module.exports = {
  run,
};
