/**
 * @fileoverview Standalone test script for the product-design EpicsService
 * (Target Process **Epics**).
 *
 * Builds product-design settings from the knowledge repo's .env, then calls the
 * real service. retrieve() caches epics.json; createEpicFolders() additionally
 * reads the features cache (for the per-epic feature list), so for a fully
 * populated --write run, run featuresData.script.js first.
 *
 * Run from the knowledge repo root:
 *   node product-design/tests/services/epicsData.script.js
 *   node .../epicsData.script.js --write   # ALSO write each epic's .home.md (writes files!)
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

// Load the knowledge repo's .env (six levels up from this script's folder).
// __dirname-relative so it works regardless of the current working directory.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const EpicsService = require('../../services/epicsService');

const WRITE = process.argv.includes('--write');

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
    const hasFrontdoor = settings.frontdoorPublicKey && settings.frontdoorPrivateKey;
    if (!hasFrontdoor && !settings.token && !(settings.username && settings.password)) {
        missing.push('TP_PUBLIC_KEY+TP_PRIVATE_KEY OR product_design_token OR product_design_username+password');
    }
    if (!settings.datafolder) missing.push('product_design_datafolder');
    if (WRITE && !settings.contentfolder) missing.push('product_design_contentfolder (for --write)');
    if (missing.length) {
        console.error('[epicsData] missing required settings in .env: ' + missing.join(', '));
        process.exit(1);
    }
}

function preview(label, content, lines = 14) {
    console.log(`\n----- ${label} (first ${lines} lines) -----`);
    console.log(String(content).split('\n').slice(0, lines).join('\n'));
    console.log('----- end preview -----\n');
}

async function main() {
    requireSettings();

    const service = new EpicsService(settings);

    // 1) Live retrieve from Target Process (caches epics.json).
    console.log('[epicsData] retrieving Epics from Target Process ...');
    const epics = await service.retrieve();
    console.log(`[epicsData] retrieved ${epics.length} epic(s).`);
    if (epics.length) {
        console.log('[epicsData] sample:', epics.slice(0, 3).map((e) => e.Name).join(', '));
    }

    // 2) Non-destructive content check: build one epic's detail page using the
    //    just-retrieved epics and the features cache (empty cache is handled).
    const epic = epics.find((e) => e.Project && e.Project.Name) || epics[0];
    if (epic) {
        const features = service.readCache('features.json');
        const epicFeatures = features.filter((f) => f.Epic && f.Epic.Id === epic.Id);
        preview(`epic home "${epic.Name}"`, service.buildEpicHome(epic, epicFeatures));
    } else {
        console.log('[epicsData] no epics retrieved — nothing to preview.');
    }

    // 3) Optional: write each epic's .home.md (reads epics + features caches).
    if (WRITE) {
        console.log('[epicsData] --write: creating epic folders + .home.md ...');
        const messages = await service.createEpicFolders();
        messages.forEach((m) => console.log('  ' + m));
    } else {
        console.log('[epicsData] read-only run. Pass --write to create epic folders/pages.');
    }
}

main().catch((error) => {
    console.error('[epicsData] error:', error.message);
    if (error.cause) console.error('[epicsData] cause:', error.cause.code || error.cause.message || error.cause);
    process.exit(1);
});
