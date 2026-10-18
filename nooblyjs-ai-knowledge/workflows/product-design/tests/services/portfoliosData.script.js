/**
 * @fileoverview Standalone test script for the product-design PortfoliosService
 * (Target Process **Projects**).
 *
 * Same style as the design-solution *.script.js scripts: it loads the knowledge
 * repo's .env directly and builds the settings object from the product_design_*
 * variables, then calls the real service so you can exercise it outside the
 * workflow runner.
 *
 * Run from the knowledge repo root:
 *   node product-design/tests/services/portfoliosData.script.js
 *   node .../portfoliosData.script.js --write   # ALSO create folders + .home.md (writes files!)
 *
 * Requires in .env: product_design_server, (product_design_token OR
 * product_design_username + product_design_password), product_design_datafolder,
 * and product_design_contentfolder (for --write).
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

// Load the knowledge repo's .env (six levels up from this script's folder).
// __dirname-relative so it works regardless of the current working directory.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const PortfoliosService = require('../../services/portfoliosService');

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

/** Validate the settings the service needs; print a clear message and exit if missing. */
function requireSettings() {
    const missing = [];
    if (!settings.server) missing.push('product_design_server');
    if (!(settings.frontdoorPublicKey && settings.frontdoorPrivateKey) && !settings.token && !(settings.username && settings.password)) {
        missing.push('TP_PUBLIC_KEY+TP_PRIVATE_KEY OR product_design_token OR product_design_username+password');
    }
    if (!settings.datafolder) missing.push('product_design_datafolder');
    if (WRITE && !settings.contentfolder) missing.push('product_design_contentfolder (for --write)');
    if (missing.length) {
        console.error('[portfoliosData] missing required settings in .env: ' + missing.join(', '));
        process.exit(1);
    }
}

/** Print the first few lines of generated content as a non-destructive sanity check. */
function preview(label, content, lines = 14) {
    console.log(`\n----- ${label} (first ${lines} lines) -----`);
    console.log(String(content).split('\n').slice(0, lines).join('\n'));
    console.log('----- end preview -----\n');
}

async function main() {
    requireSettings();

    const service = new PortfoliosService(settings);

    // 1) Live retrieve from Target Process (also caches projects.json under datafolder).
    console.log('[portfoliosData] retrieving Projects from Target Process ...');
    const projects = await service.retrieve();
    console.log(`[portfoliosData] retrieved ${projects.length} project(s).`);
    if (projects.length) {
        console.log('[portfoliosData] sample:', projects.slice(0, 3).map((p) => p.Name).join(', '));
    }

    // 2) Non-destructive content check: build the root index from the retrieved data.
    preview('.home.md index', service.buildIndexContent(projects));

    // 3) Optional: actually create the per-project folders + root index (writes to contentfolder).
    if (WRITE) {
        console.log('[portfoliosData] --write: creating portfolio folders + .home.md ...');
        const messages = await service.createPortfolioFolders();
        messages.forEach((m) => console.log('  ' + m));
    } else {
        console.log('[portfoliosData] read-only run. Pass --write to create folders/pages.');
    }
}

main().catch((error) => {
    console.error('[portfoliosData] error:', error.message);
    if (error.cause) console.error('[portfoliosData] cause:', error.cause.code || error.cause.message || error.cause);
    process.exit(1);
});
