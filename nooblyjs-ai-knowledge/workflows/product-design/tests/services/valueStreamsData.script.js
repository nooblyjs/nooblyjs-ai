/**
 * @fileoverview Standalone test script for the product-design ValueStreamsService
 * (Target Process **ValueStreams**).
 *
 * Builds product-design settings from the knowledge repo's .env, then calls the
 * real service. retrieve() caches valuestreams.json. Value streams nest between
 * an Agile Release Train and its epics / portfolio epics; the tree itself is
 * built by releaseTrainsData.script.js --write, so this is a data-only script.
 *
 * Run from the knowledge repo root:
 *   node product-design/tests/services/valueStreamsData.script.js
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const ValueStreamsService = require('../../services/valueStreamsService');

const settings = {
    server: process.env.product_design_server,
    username: process.env.product_design_username,
    password: process.env.product_design_password,
    token: process.env.product_design_token || null,
    frontdoorPublicKey: process.env.TP_PUBLIC_KEY || null,
    frontdoorPrivateKey: process.env.TP_PRIVATE_KEY || null,
    frontdoorUrl: process.env.TP_FRONTDOOR_URL || 'https://frontdoor.apptio.com/service/apikeylogin',
    contentfolder: process.env.product_design_contentfolder,
    datafolder: process.env.product_design_datafolder,
    tempfolder: process.env.product_design_tempfolder,
    archivefolder: process.env.product_design_archivefolder,
};

function requireSettings() {
    const missing = [];
    if (!settings.server) missing.push('product_design_server');
    if (!(settings.frontdoorPublicKey && settings.frontdoorPrivateKey) && !settings.token && !(settings.username && settings.password)) {
        missing.push('TP_PUBLIC_KEY+TP_PRIVATE_KEY OR product_design_token OR product_design_username+password');
    }
    if (!settings.datafolder) missing.push('product_design_datafolder');
    if (missing.length) {
        console.error('[valueStreamsData] missing required settings in .env: ' + missing.join(', '));
        process.exit(1);
    }
}

async function main() {
    requireSettings();

    const service = new ValueStreamsService(settings);

    console.log('[valueStreamsData] retrieving ValueStreams from Target Process ...');
    const valueStreams = await service.retrieve();
    console.log(`[valueStreamsData] retrieved ${valueStreams.length} value stream(s).`);

    if (valueStreams.length) {
        console.log('\n----- sample value streams (first 5) -----');
        valueStreams.slice(0, 5).forEach((vs) => {
            const project = vs.Project ? vs.Project.Name : '(no project)';
            console.log(`  ${vs.Name} (${vs.Id})  ·  ${project}`);
        });
        console.log('----- end sample -----\n');
    } else {
        console.log('[valueStreamsData] no value streams retrieved — nothing to preview.');
    }
}

main().catch((error) => {
    console.error('[valueStreamsData] error:', error.message);
    if (error.cause) console.error('[valueStreamsData] cause:', error.cause.code || error.cause.message || error.cause);
    process.exit(1);
});
