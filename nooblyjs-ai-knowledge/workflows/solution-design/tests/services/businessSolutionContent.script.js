/**
 * @fileoverview Build Business Solutions Content
 * This script retrieves the Business Solutions data for a given filter and processes it to create content for the Business Solutions page.
 *
 * @author Digital Technologies Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

// Dependancies
const fs = require('node:fs');
const path = require('node:path');

// Load our settings
require('dotenv').config({ path: path.join(__dirname, '../../../../.env'), quiet: true });

// Import some libraries
const fileUtils = require('../../../common/architecture/filesystem/filesystem')
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

const BusinessSolutionsClass = require('../../services/businessSolutions');
const BusinessSolutionClass = require('../../services/businessSolution');

// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": "C:/work-dt/knowledge-content/enterprise/Solution",
    "datafolder": "C:/work-dt/.application/spaces/working/design-solution"
}

// Ignore cache for testing
settings.useCache = true;
settings.cacheAgeDays = 1;


// Retrieve Business Solutions when authenticated
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
//settings.filter = {"Responsible Technology Executive": "Jacques De Waal"}

//settings.filter =  {"Roadmap": "fca6f551-bd57-11f0-00be-005056bd2116" 

/*
if (!settings.filter) {
    console.error('Please provide a filter as the first argument.');
    process.exit(1);
}
*/

if (!settings.contentfolder) {
    console.error('Please provide a content folder as the second argument.');
    process.exit(1);
}

// Retrieve Business Solutions when authenticated
authenticate.authenticate().then((response) => {
    settings.token = response.token;

    // Retrieve the Business Solution data for the filter
    businessSolutions.createBusinessSolutionsContent(settings.filter,settings.useCache).then((data) => {
        console.log("Process data for filter ");
        console.log(settings.filter);
        console.log("Business Solutions Content retrieved successfully.");
    }).catch((error) => {
        console.error('Business Solutions Data error:', error);
    });
});

// ======================================================================
// Enterprise Solutions
// ======================================================================
//settings.contentfolder = ""
//let filter = [{"Responsible Technology Executive": "Debbie Cunningham"}]
//let filter = [{"Responsible Technology Executive": "Jacques De Waal"}]
//let filter = [{"Responsible Technology Executive": "Ferdie Voges"}]
//let filter = [{"Responsible Technology Executive": "Sandra Moumtzis"},{ "Domain": "Finance" },{ "Domain": "Planning and Master Data"},{ "Domain": "Store operations and Non-Supermarkets"}, { "Domain": "Supply Chain"},{ "Domain": "Technology" }, { "Domain": "Unassigned" }]
//let filter = [{"Responsible Technology Executive": "Maciej Kaliszka"}, {"Domain":"Data and Analytics - Data Utilisation"}, { "Domain": "Technology" }, { "Domain": "Unassigned" }]
//let filter = [{"Responsible Technology Executive": "Richard Page"}, { "Domain": "Store operations and Non-Supermarkets" },{ "Domain": "Technology" }, { "Domain": "Unassigned" }]

// ======================================================================
// People  Solutions
// ======================================================================
//settings.contentfolder = ""
//let filter = [{"Responsible Technology Executive": "Maciej Kaliszka"}, { "Domain": "People" }]
//let filter = [{"Responsible Technology Executive": "Sandra Moumtzis"},{ "Domain": "People" }]

// ======================================================================
// Fintech Solutions
// ======================================================================
//settings.contentfolder = ""
//let filter = [{"Responsible Technology Executive": "Richard Page"}, { "Domain": "Financial Services" }]
//let filter = [{"Responsible Technology Executive": "Sandra Moumtzis"},{ "Domain": "Financial Services" }]
//let filter = [{"Responsible Technology Executive": "Adrian Linde"}]

// ======================================================================
// By Roadmap
// ======================================================================
//settings.contentfolder = "
//let filter =  {"Roadmap": "117e4011-7cca-11f0-00be-005056bd2116" }
