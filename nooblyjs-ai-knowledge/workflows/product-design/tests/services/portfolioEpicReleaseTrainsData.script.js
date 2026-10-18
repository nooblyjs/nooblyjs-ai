/**
 * @fileoverview Standalone test script for the product-design
 * PortfolioEpicReleaseTrainsService (Target Process
 * **PortfolioEpicAgileReleaseTrains** — Portfolio Epic → Agile Release Train map).
 *
 * Builds product-design settings from the knowledge repo's .env, then calls the
 * real service. retrieve() caches portfolioepicreleasetrains.json. This is a
 * data-only service (a junction collection consumed by the Release Trains
 * content step), so there is no --write / page-building stage.
 *
 * Run from the knowledge repo root:
 *   node product-design/tests/services/portfolioEpicReleaseTrainsData.script.js
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

// Load the knowledge repo's .env (six levels up from this script's folder).
// __dirname-relative so it works regardless of the current working directory.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const PortfolioEpicReleaseTrainsService = require('../../services/portfolioEpicReleaseTrainsService');

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
        console.error('[portfolioEpicReleaseTrainsData] missing required settings in .env: ' + missing.join(', '));
        process.exit(1);
    }
}

async function main() {
    requireSettings();

    const service = new PortfolioEpicReleaseTrainsService(settings);

    // Live retrieve from Target Process (caches portfolioepicreleasetrains.json).
    console.log('[portfolioEpicReleaseTrainsData] retrieving PortfolioEpicAgileReleaseTrains from Target Process ...');
    const mappings = await service.retrieve();
    console.log(`[portfolioEpicReleaseTrainsData] retrieved ${mappings.length} portfolio epic -> release train mapping(s).`);

    if (mappings.length) {
        console.log('\n----- sample mappings (first 5) -----');
        mappings.slice(0, 5).forEach((m) => {
            const pe = m.PortfolioEpic ? `${m.PortfolioEpic.Name} (${m.PortfolioEpic.Id})` : '(none)';
            const art = m.AgileReleaseTrain ? `${m.AgileReleaseTrain.Name} (${m.AgileReleaseTrain.Id})` : '(none)';
            console.log(`  Portfolio Epic ${pe}  ->  Release Train ${art}`);
        });
        console.log('----- end sample -----\n');

        const orphanPe = mappings.filter((m) => !m.PortfolioEpic).length;
        const orphanArt = mappings.filter((m) => !m.AgileReleaseTrain).length;
        if (orphanPe || orphanArt) {
            console.log(`[portfolioEpicReleaseTrainsData] note: ${orphanPe} mapping(s) missing a PortfolioEpic, ${orphanArt} missing an AgileReleaseTrain.`);
        }
    } else {
        console.log('[portfolioEpicReleaseTrainsData] no mappings retrieved — nothing to preview.');
    }
}

main().catch((error) => {
    console.error('[portfolioEpicReleaseTrainsData] error:', error.message);
    if (error.cause) console.error('[portfolioEpicReleaseTrainsData] cause:', error.cause.code || error.cause.message || error.cause);
    process.exit(1);
});
