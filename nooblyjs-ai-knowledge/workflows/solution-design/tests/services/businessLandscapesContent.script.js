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

// Import the Business Solution Object
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

// Import the Business Landscapes Object
const BusinessLandscapeClass = require('../../services/businessLandscapes');

// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": process.env.design_solution_contentfolder,
    "datafolder": process.env.design_solution_datafolder
}

// Application Landscapes
settings.landscapefolder = 'Application Landscapes';
settings.model = 'c36892e0-6fe2-11e4-17c9-005056a80022';
settings.inventoryroot = '188f6420-6fe2-11e4-17c9-005056a80022';
settings.modelfile = 'businessLandscapes.json';

//Reference Landscapes
settings.landscapefolder = 'Reference Landscapes';
settings.model = 'f2c34860-a10c-11e2-1234-005056a80022';
settings.inventoryroot = 'd3f8d100-5adc-11f1-00be-005056bd2116';
settings.modelfile = 'referenceLandscapes.json';

// Ignore cache for testing purposes
settings.useCache = false; 
settings.cacheAgeDays = 1;

// Retrieve Business Solutions when authenticated
const authenticate = new AuthenticateClass(settings);
const businessLandscapes = new BusinessLandscapeClass(settings);

// Retrieve Business Solutions Data after authenticating
authenticate.authenticate().then((response) => {
    settings.token = response.token;
    businessLandscapes.createBusinessLandscapesContent(settings.useCache).then((data) => {
        console.log('Business Landscapes Data Created');
    }).catch((error) => {
        console.error('Business Landscapes Data error:', error);
    });
});


