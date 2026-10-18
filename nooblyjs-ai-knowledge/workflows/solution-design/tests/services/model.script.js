/**
 * @fileoverview Retrieve model test
 *
 * @author Digital Technologies Team
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

// Import the model service
const ModelClass = require('../../../common/architecture/models/model');

// Load some sample data
// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": process.env.design_solution_contentfolder,
    "datafolder": process.env.design_solution_datafolder
}

const model = new ModelClass(settings);

// Retrieve the Model (useCache=false forces a fresh fetch from ARIS)
model.retrieve("117e4011-7cca-11f0-00be-005056bd2116", false).then((response) => {
    console.log('Retrieved model response:', response);
}).catch((error) => {
    console.error('Error model response:', error);
});
