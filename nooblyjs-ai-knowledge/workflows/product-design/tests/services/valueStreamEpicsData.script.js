/**
 * @fileoverview Standalone test script for the product-design
 * ValueStreamEpicsService (Target Process **ValueStreamEpics** —
 * Value Stream → Epic map).
 *
 * Builds product-design settings from the knowledge repo's .env, then calls the
 * real service. retrieve() caches valuestreamepics.json. Data-only: the tree is
 * assembled by releaseTrainsData.script.js --write.
 *
 * Run from the knowledge repo root:
 *   node product-design/tests/services/valueStreamEpicsData.script.js
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const ValueStreamEpicsService = require('../../services/valueStreamEpicsService');

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
        console.error('[valueStreamEpicsData] missing required settings in .env: ' + missing.join(', '));
        process.exit(1);
    }
}

async function main() {
    requireSettings();

    const service = new ValueStreamEpicsService(settings);

    console.log('[valueStreamEpicsData] retrieving ValueStreamEpics from Target Process ...');
    const mappings = await service.retrieve();
    console.log(`[valueStreamEpicsData] retrieved ${mappings.length} value stream -> epic mapping(s).`);

    if (mappings.length) {
        console.log('\n----- sample mappings (first 5) -----');
        mappings.slice(0, 5).forEach((m) => {
            const vs = m.ValueStream ? `${m.ValueStream.Name} (${m.ValueStream.Id})` : '(none)';
            const epic = m.Epic ? `${m.Epic.Name} (${m.Epic.Id})` : '(none)';
            console.log(`  Value Stream ${vs}  ->  Epic ${epic}`);
        });
        console.log('----- end sample -----\n');
    } else {
        console.log('[valueStreamEpicsData] no mappings retrieved — nothing to preview.');
    }
}

main().catch((error) => {
    console.error('[valueStreamEpicsData] error:', error.message);
    if (error.cause) console.error('[valueStreamEpicsData] cause:', error.cause.code || error.cause.message || error.cause);
    process.exit(1);
});
