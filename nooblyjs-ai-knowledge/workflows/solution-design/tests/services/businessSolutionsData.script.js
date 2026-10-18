/**
 * @fileoverview Retrieve Business Solutions Data
 * This script retrieves the Business Solutions data for a given filter and processes it to create content for the Business Solutions page.
 * 
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

// Dependancies
const path = require('node:path');

// Load our settings
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Import some libraries
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

// Import the Business Solution Object
const BusinessSolutionsClass = require('../../services/businessSolutions');

// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": process.env.design_solution_contentfolder,
    "datafolder": process.env.design_solution_datafolder
}

// Ignore the cache for testing purposes
settings.useCache = false;
settings.cacheAgeDays = 1;

// Retrieve Business Solutions when authenticated
const authenticate = new AuthenticateClass(settings);
const businessSolutions = new BusinessSolutionsClass(settings);

// Retrieve Business Solutions Data after authenticating
authenticate.authenticate(settings.useCache ).then((response) => {
    settings.token = response.token;
    businessSolutions.retrieve(settings.useCache).then((data) => {
        console.log('Business Solutions Data Created');
    }).catch((error) => {
        console.error('Business Solutions Data error:', error);
    });
});


