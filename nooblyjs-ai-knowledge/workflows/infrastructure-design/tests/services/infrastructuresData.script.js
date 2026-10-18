/**
 * @fileoverview Retrieve Infrastructure Inventory Data
 * This script retrieves the infrastructure inventory model directly via the
 * service (no worker/step) and caches it to
 * <datafolder>/cache/infrastructureInventory.json.
 *
 * Run: node infrastructure-design/tests/services/infrastructuresData.script.js
 *
 * @author Digital Technologies Team
 * @version 0.1.0
 */

'use strict';

// Dependancies
const path = require('node:path');

// Load our settings
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

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

// Ignore the cache for testing purposes
settings.useCache = false;
settings.cacheAgeDays = 1;

// Retrieve the infrastructure inventory when authenticated
const authenticate = new AuthenticateClass(settings);
const infrastructures = new InfrastructuresClass(settings);

// Retrieve the inventory data after authenticating
authenticate.authenticate(settings.useCache).then((response) => {
    settings.token = response.token;
    infrastructures.retrieve(settings.useCache).then((data) => {
        console.log('Infrastructure Inventory Data Created');
    }).catch((error) => {
        console.error('Infrastructure Inventory Data error:', error);
    });
});
