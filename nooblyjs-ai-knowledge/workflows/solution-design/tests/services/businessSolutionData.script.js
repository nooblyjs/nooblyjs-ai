/**
 * @fileoverview Retrieve Business Solution Data
 * This script retrieves the Business Solutions data for a given filter and processes it to create content for the Business Solutions page.
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

// Dependancies
const fs = require('node:fs');
const path = require('node:path');

// Load our settings
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') , quiet: true });

// Import some libraries
const fileUtils = require('../../../common/architecture/filesystem/filesystem')
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

// Import the Business Solution Object
const BusinessSolutionsClass = require('../../services/businessSolutions');
const BusinessSolutionClass = require('../../services/businessSolution');

// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": "C:/work/knowledge-content/enterprise/Solution",
    "datafolder": "C:/work/.application/spaces/working/design-solution"
}

// Ignore cache for testing
settings.useCache = true;
settings.cacheAgeDays = 1;

// Load the classes
const authenticate = new AuthenticateClass(settings);
const businessSolutions = new BusinessSolutionsClass(settings);
const businessSolution = new BusinessSolutionClass(settings);

// Process command line arguments
const args = process.argv.slice(2);


// filter for Portfolios
//settings.filter = {"Responsible Technology Executive": "Debbie Cunningham"}
//settings.filter = {"Responsible Technology Executive": "Richard Page"}
//settings.filter = {"Responsible Technology Executive": "Ferdie Voges"}
//settings.filter= {"Responsible Technology Executive": "Maciej Kaliszka"}
//settings.filter = {"Responsible Technology Executive": "Adrian Linde"}
//settings.filter = {"Responsible Technology Executive": "Sandra Moumtzis"}
settings.filter = {"Responsible Technology Executive": "Jacques De Waal"}


// filter for Roadmaps
//let filter =  {"Roadmap": "117e4011-7cca-11f0-00be-005056bd2116" }
//settings.filter =  {"Roadmap": "fca6f551-bd57-11f0-00be-005056bd2116" }

if (!settings.filter) {
    console.error('Please provide a filter as the first argument.');
    process.exit(1);
}

// Retrieve Business Solutions when authenticated
authenticate.authenticate().then((response) => {
    settings.token = response.token;

    // Retrieve the Business Solution data for the filter
    businessSolutions.retrieveBusinessSolutionsData(settings.filter, settings.useCache).then(data => {
        console.log("Process data for filter ");
        console.log(settings.filter);
        console.log("Business Solutions Data retrieved successfully.");
    }).catch((error) => {
        console.error('Business Solutions Data error:', error);
    });

});

// filter for Portfolios
//let filter = {"Responsible Technology Executive": "Sandra Moumtzis"}
//let filter = {"Responsible Technology Executive": "Debbie Cunningham"}
//let filter = {"Responsible Technology Executive": "Adrian Linde"}
//let filter = {"Responsible Technology Executive": "Jacques De Waal"}
//let filter = {"Responsible Technology Executive": "Ferdie Voges"}
//let filter = {"Responsible Technology Executive": "Maciej Kaliszka"}
//let filter = {"Responsible Technology Executive": "Richard Page"}

// filter for Roadmaps
//let filter =  {"Roadmap": "117e4011-7cca-11f0-00be-005056bd2116" }
