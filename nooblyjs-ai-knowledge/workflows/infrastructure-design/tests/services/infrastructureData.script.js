/**
 * @fileoverview Retrieve Infrastructure Data
 * This script retrieves the full infrastructure data directly via the service
 * (no worker/step): it fetches the inventory and then caches every referenced
 * infrastructure model's JSON + graphic under <datafolder>.
 *
 * Run: node infrastructure-design/tests/services/infrastructureData.script.js
 *
 * @author Digital Technologies Team
 * @version 0.1.0
 */

'use strict';

// Dependancies
const path = require('node:path');

// Load our settings
require('dotenv').config({ path: path.join(__dirname, '../../../../.env'), quiet: true });

// Import some libraries
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

// Import the Infrastructure inventory service
const InfrastructuresClass = require('../../services/infrastructures');

// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": "../../../../.application/spaces/working/design-infrastructure",
    "datafolder": "../../../../.application/spaces/working/design-infrastructure"
}

// Ignore the cache for testing
settings.useCache = false;
settings.cacheAgeDays = 1;

// The service does not filter yet; pass an empty filter.
settings.filter = {};

// Load the classes
const authenticate = new AuthenticateClass(settings);
const infrastructures = new InfrastructuresClass(settings);

// Retrieve the infrastructure data when authenticated
authenticate.authenticate().then((response) => {
    settings.token = response.token;

    // Fetch the inventory, then cache every referenced model's data + graphic
    infrastructures.retrieveInfrastructuresData(settings.filter, settings.useCache).then((data) => {
        console.log('Infrastructure Data retrieved successfully.');
    }).catch((error) => {
        console.error('Infrastructure Data error:', error);
    });
});
