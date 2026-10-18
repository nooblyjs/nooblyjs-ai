/**
 * @fileoverview Retrieve a business solution roadmap object search result
 * This script retrieves a business solution roadmap object and retrieve the occurence models data
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
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Import some libraries
const fileUtils = require('../../../common/architecture/filesystem/filesystem')
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

// Import the Business Solution Object
const BusinessSolutionsSearchClass = require('../../services/businessSolutionSearch');

// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": process.env.design_solution_contentfolder,
    "datafolder": process.env.design_solution_datafolder
}

// Load the classes
const authenticate = new AuthenticateClass(settings);
const businessSolutionSearch = new BusinessSolutionsSearchClass(settings);

// Retrieve Business Solutions when authenticated
authenticate.authenticate().then((response) => {
    settings.token = response.token;

    // The actual SAP Commerce Cloud (B2B Obje)
    let object = "bb4d474b-7cc9-11f0-00be-005056bd2116";

    // Retrieve the Business Solution data for the object (useCache=false forces a fresh fetch)
    businessSolutionSearch.retrieve(object, false).then(data => {
        console.log("Process data for object " + object)       
        businessSolutionSearch.buildBusinessSolutionsContentForSearch(object)
    }).catch((error) => {
        console.error('Business Solutions Search Data error:', error);
    });

});