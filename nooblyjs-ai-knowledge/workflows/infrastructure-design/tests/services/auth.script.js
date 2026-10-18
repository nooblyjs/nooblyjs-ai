/**
 * @fileoverview Retrieve authentication token test
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

// Import the auth service
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

// The settings for testing
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "datafolder": process.env.design_infrastructure_datafolder
}
console.log(settings);

// Instantiate the class
const authenticate = new AuthenticateClass(settings);

// Authenticate the user
authenticate.authenticate().then((response) => {
    console.log(response.token);
}).catch((error) => {
    console.error('Error with autneticating:', error);
});
