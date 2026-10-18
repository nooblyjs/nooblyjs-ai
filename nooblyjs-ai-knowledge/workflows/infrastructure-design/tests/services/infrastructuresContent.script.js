/**
 * @fileoverview Build Infrastructure Content
 * This script builds the infrastructure wiki content directly via the service
 * (no worker/step): it fetches the inventory, then for every referenced model
 * writes a .home.md (title + graphic + attribute/object tables) under
 * <contentfolder>, reading cached model/graphic data from <datafolder>.
 *
 * NOTE: run the data script first (infrastructureData.script.js) so the cache is
 * warm, or leave useCache=false below to refetch from ARIS during the build.
 *
 * Run from infrastructure-design/tests/services so the relative folder paths
 * below resolve to C:/work/.application/...:
 *   node infrastructuresContent.script.js
 *
 * @author NooblyJS Team
 * @version 0.1.0
 */

'use strict';

// Dependancies
const path = require('node:path');

// Load our settings (ARIS credentials come from the sibling repo's .env)
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

// Import some libraries
const AuthenticateClass = require('../../../common/architecture/authentication/Authenticate');

// Import the Infrastructure inventory service
const InfrastructuresClass = require('../../services/infrastructures');

// Load settings data. The folder paths are relative to the CWD you launch node
// from; run this from infrastructure-design/tests/services so they resolve to
// C:/work/.application/spaces/working/design-infrastructure.
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

// The service does not filter yet; pass an empty filter.
settings.filter = {};

// Build the infrastructure content when authenticated
const authenticate = new AuthenticateClass(settings);
const infrastructures = new InfrastructuresClass(settings);

// Build the content after authenticating
authenticate.authenticate(settings.useCache).then((response) => {
    settings.token = response.token;
    infrastructures.buildInfrastructuresContent(settings.filter, settings.useCache)
    .then((data) => {
        console.log('Infrastructure Content built');
    })
    .catch((error) => {
        console.error('Infrastructure Content error:', error);
    });
});
