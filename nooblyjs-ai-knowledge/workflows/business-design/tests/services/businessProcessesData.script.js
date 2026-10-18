/**
 * @fileoverview Retrieve Business Processes Data
 * This script retrieves the Business Processes data for a given filter and processes it to create content for the Business Processes page.
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

// Import the Business Process Object
const BusinessProcessesClass = require('../../services/businessProcesses');

// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": "C:\\work\\knowledge-content\\enterprise\\Process",
    "datafolder": "C:\\work\\.application\\spaces\\working\\design-process"
}

// set our filter
//var filter = {modelId : "d496ce00-1ef4-11de-7d4f-000c29300558" , cacheFile: "businessSolutions.json" }
var filter = {modelId : "fd55dd50-7ba1-11f1-00be-005056bd2116" , cacheFile: "businessSolutions-digital-infrastructure-team.json" }

// Ignore the cache for testing purposes
settings.useCache = false;

// Retrieve Business Processes when authenticated
const authenticate = new AuthenticateClass(settings);
const businessProcesses = new BusinessProcessesClass(settings);

// Retrieve Business Processes Data after authenticating
authenticate.authenticate().then((response) => {
    settings.token = response.token;
    businessProcesses.retrieveBusinessProcessesData(filter, settings.useCache).then((data) => {
        console.log('Business Processes Data retrieved successfully.');
    }).catch((error) => {
        console.error('Error retrieving Business Processes Data:', error);
    })    
});


