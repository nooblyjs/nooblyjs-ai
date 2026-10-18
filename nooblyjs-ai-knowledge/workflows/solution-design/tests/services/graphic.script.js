/**
 * @fileoverview Model Graphic Tests
 * This file test the ARIS Graphic requests The following tests are performed
 * @method graphic.retrieve: Retrieve a graphic for a passed model
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

// Dependancies
const path = require('node:path');
const fs = require('node:fs');

// Load our settings
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Import some libraries
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

// Import the Graphic Object
const GraphicClass = require('../../../common/architecture/models/graphic.js');

// Load settings data
const settings = {
    "server": process.env.aris_server,
    "username": process.env.aris_username,
    "password": process.env.aris_password,
    "database": encodeURIComponent("Acme Architecture Modeling"),
    "contentfolder": process.env.design_solution_contentfolder,
    "datafolder": process.env.design_solution_datafolder
}

// Retrieve Business Solutions when authenticated
const authenticate = new AuthenticateClass(settings);
const graphic = new GraphicClass(settings);

// If autenticted generate an image
authenticate.authenticate().then((response) => {
    settings.token = response.token;
    graphic.retrievePNGData("117e4011-7cca-11f0-00be-005056bd2116").then((response) => {
        graphic.retrievePNG("117e4011-7cca-11f0-00be-005056bd2116",response).then((imageBuffer) => {
            fs.writeFile('../output_image.png', imageBuffer, function(err) {
                if (err) {
                    console.error('Error saving image:', err);
                } else {
                    console.log('Image saved successfully as output_image.png');
                }
            })
    });

    }).catch((error) => {
       console.log(error);
    });
});
