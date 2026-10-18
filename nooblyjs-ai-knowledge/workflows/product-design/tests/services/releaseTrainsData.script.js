/**
 * @fileoverview Standalone test script for the product-design
 * ReleaseTrainsService (Target Process **AgileReleaseTrains**).
 *
 * Builds product-design settings from the knowledge repo's .env, then calls the
 * real service. retrieve() caches releasetrains.json; createReleaseTrainFolders()
 * assembles the Product tree: Release Train > Value Stream > { Epic, Portfolio
 * Epic } > Feature, with a "Portfolio - <Project>" group holding epics / portfolio
 * epics that map to the train but to no value stream. It reads every value-stream
 * and mapping cache and enriches pages from epics.json / portfolioepics.json /
 * features.json. So for a fully populated --write run, run valueStreamsData,
 * agileReleaseTrainValueStreamsData, valueStreamEpicsData, valueStreamPortfolioEpicsData,
 * the two release-train mapping scripts, and epicsData / portfolioEpicsData /
 * featuresData first.
 *
 * Run from the knowledge repo root:
 *   node product-design/tests/services/releaseTrainsData.script.js
 *   node .../releaseTrainsData.script.js --write   # ALSO build the full Product tree (writes files!)
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

// Load the knowledge repo's .env (six levels up from this script's folder).
// __dirname-relative so it works regardless of the current working directory.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const ReleaseTrainsService = require('../../services/releaseTrainsService');

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
    if (!(settings.frontdoorPublicKey && settings.frontdoorPrivateKey) && !settings.token && !(settings.username && settings.password)) {
        missing.push('TP_PUBLIC_KEY+TP_PRIVATE_KEY OR product_design_token OR product_design_username+password');
    }
    if (!settings.datafolder) missing.push('product_design_datafolder');
    if (WRITE && !settings.contentfolder) missing.push('product_design_contentfolder (for --write)');
    if (missing.length) {
        console.error('[releaseTrainsData] missing required settings in .env: ' + missing.join(', '));
        process.exit(1);
    }
}

async function main() {
    requireSettings();

    const service = new ReleaseTrainsService(settings);

    // 1) Live retrieve from Target Process (caches releasetrains.json).
    console.log('[releaseTrainsData] retrieving AgileReleaseTrains from Target Process ...');
    const releaseTrains = await service.retrieve();
    console.log(`[releaseTrainsData] retrieved ${releaseTrains.length} release train(s).`);
    if (releaseTrains.length) {
        console.log('[releaseTrainsData] sample:', releaseTrains.slice(0, 3).map((t) => t.Name).join(', '));
    }

    // 2) Non-destructive content check: plan one train's tree from the
    //    value-stream / mapping caches (empty caches handled). Prefer a train
    //    that has value streams so the preview is meaningful.
    const context = service.buildContext();
    if (!context.artValueStreamMappings.length) {
        console.log('[releaseTrainsData] note: value-stream caches are empty — run valueStreamsData,'
            + ' agileReleaseTrainValueStreamsData, valueStreamEpicsData and valueStreamPortfolioEpicsData first'
            + ' (and epicsData / portfolioEpicsData / featuresData) for a fully-populated tree.');
    }

    const train = releaseTrains.find((t) =>
        t.Name && context.artValueStreamMappings.some((m) => m.AgileReleaseTrain && m.AgileReleaseTrain.Id === t.Id))
        || releaseTrains.find((t) => t.Name)
        || releaseTrains[0];

    if (train) {
        const plan = service.planReleaseTrain(train, context);
        const directEpics = plan.portfolios.reduce((n, p) => n + p.epics.length, 0);
        const directPortfolioEpics = plan.portfolios.reduce((n, p) => n + p.portfolioEpics.length, 0);
        console.log(`[releaseTrainsData] "${train.Name}" has ${plan.valueStreams.length} value stream(s) and`
            + ` ${plan.portfolios.length} portfolio group(s) (${directEpics} epic(s),`
            + ` ${directPortfolioEpics} portfolio epic(s) with no value stream).`);
        console.log('[releaseTrainsData] note: the release-train folder no longer gets its own .home.md.');
    } else {
        console.log('[releaseTrainsData] no release trains retrieved — nothing to preview.');
    }

    // 3) Optional: write the full tree (train > value stream > epic / portfolio
    //    epic > feature). Reads every value-stream and mapping cache.
    if (WRITE) {
        console.log('[releaseTrainsData] --write: assembling the Product tree ...');
        const messages = await service.createReleaseTrainFolders();
        messages.forEach((m) => console.log('  ' + m));
    } else {
        console.log('[releaseTrainsData] read-only run. Pass --write to build the release train tree.');
    }
}

main().catch((error) => {
    console.error('[releaseTrainsData] error:', error.message);
    if (error.cause) console.error('[releaseTrainsData] cause:', error.cause.code || error.cause.message || error.cause);
    process.exit(1);
});
