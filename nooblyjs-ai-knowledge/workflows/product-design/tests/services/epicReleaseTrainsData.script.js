/**
 * @fileoverview Standalone test script for the product-design
 * EpicReleaseTrainsService (Target Process **EpicAgileReleaseTrains** —
 * Epic → Agile Release Train map).
 *
 * Builds product-design settings from the knowledge repo's .env, then calls the
 * real service. retrieve() caches epicreleasetrains.json. This is a data-only
 * service (a junction collection consumed by the Release Trains content step),
 * so there is no --write / page-building stage.
 *
 * Run from the knowledge repo root:
 *   node product-design/tests/services/epicReleaseTrainsData.script.js
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

// Load the knowledge repo's .env (six levels up from this script's folder).
// __dirname-relative so it works regardless of the current working directory.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const EpicReleaseTrainsService = require('../../services/epicReleaseTrainsService');

// Build the Product Design settings object from the .env product_design_* keys.
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
        console.error('[epicReleaseTrainsData] missing required settings in .env: ' + missing.join(', '));
        process.exit(1);
    }
}

async function main() {
    requireSettings();

    const service = new EpicReleaseTrainsService(settings);

    // Live retrieve from Target Process (caches epicreleasetrains.json).
    console.log('[epicReleaseTrainsData] retrieving EpicAgileReleaseTrains from Target Process ...');
    const mappings = await service.retrieve();
    console.log(`[epicReleaseTrainsData] retrieved ${mappings.length} epic -> release train mapping(s).`);

    if (mappings.length) {
        console.log('\n----- sample mappings (first 5) -----');
        mappings.slice(0, 5).forEach((m) => {
            const epic = m.Epic ? `${m.Epic.Name} (${m.Epic.Id})` : '(none)';
            const art = m.AgileReleaseTrain ? `${m.AgileReleaseTrain.Name} (${m.AgileReleaseTrain.Id})` : '(none)';
            console.log(`  Epic ${epic}  ->  Release Train ${art}`);
        });
        console.log('----- end sample -----\n');

        const orphanEpic = mappings.filter((m) => !m.Epic).length;
        const orphanArt = mappings.filter((m) => !m.AgileReleaseTrain).length;
        if (orphanEpic || orphanArt) {
            console.log(`[epicReleaseTrainsData] note: ${orphanEpic} mapping(s) missing an Epic, ${orphanArt} missing an AgileReleaseTrain.`);
        }
    } else {
        console.log('[epicReleaseTrainsData] no mappings retrieved — nothing to preview.');
    }
}

main().catch((error) => {
    console.error('[epicReleaseTrainsData] error:', error.message);
    if (error.cause) console.error('[epicReleaseTrainsData] cause:', error.cause.code || error.cause.message || error.cause);
    process.exit(1);
});
