/**
 * @fileoverview Standalone test script for the product-design
 * PortfolioEpicsService (Target Process **PortfolioEpics**).
 *
 * Builds product-design settings from the knowledge repo's .env, then calls the
 * real service. retrieve() caches portfolioepics.json; createProjectHomePages()
 * additionally reads the projects + epics caches, so for a full --write run you
 * should first run portfoliosData.script.js and epicsData.script.js.
 *
 * Run from the knowledge repo root:
 *   node product-design/tests/services/portfolioEpicsData.script.js
 *   node .../portfolioEpicsData.script.js --write   # ALSO write each project's .home.md (writes files!)
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

// Load the knowledge repo's .env (six levels up from this script's folder).
// __dirname-relative so it works regardless of the current working directory.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const PortfolioEpicsService = require('../../services/portfolioEpicsService');

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
        console.error('[portfolioEpicsData] missing required settings in .env: ' + missing.join(', '));
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

    const service = new PortfolioEpicsService(settings);

    // 1) Live retrieve from Target Process (caches portfolioepics.json).
    console.log('[portfolioEpicsData] retrieving PortfolioEpics from Target Process ...');
    const portfolioEpics = await service.retrieve();
    console.log(`[portfolioEpicsData] retrieved ${portfolioEpics.length} portfolio epic(s).`);
    if (portfolioEpics.length) {
        console.log('[portfolioEpicsData] sample:', portfolioEpics.slice(0, 3).map((pe) => pe.Name).join(', '));
    }

    // 2) Non-destructive content check: build one project's home page. Needs the
    //    projects cache (run portfoliosData.script.js first for a populated preview);
    //    epics are read from the epics cache if present.
    const projects = service.readCache('projects.json');
    if (projects.length) {
        const project = projects[0];
        const epics = service.readCache('epics.json');
        const projectPEs = portfolioEpics.filter((pe) => pe.Project && pe.Project.Id === project.Id);
        const projectEpics = epics.filter((e) => e.Project && e.Project.Id === project.Id);
        preview(`project home "${project.Name}"`, service.buildProjectHome(project, projectPEs, projectEpics));
    } else {
        console.log('[portfolioEpicsData] no projects cache found — run portfoliosData.script.js first to preview a project home.');
    }

    // 3) Optional: write each project's .home.md (reads projects/portfolioepics/epics caches).
    if (WRITE) {
        console.log('[portfolioEpicsData] --write: creating project home pages ...');
        const messages = await service.createProjectHomePages();
        messages.forEach((m) => console.log('  ' + m));
    } else {
        console.log('[portfolioEpicsData] read-only run. Pass --write to create project home pages.');
    }
}

main().catch((error) => {
    console.error('[portfolioEpicsData] error:', error.message);
    if (error.cause) console.error('[portfolioEpicsData] cause:', error.cause.code || error.cause.message || error.cause);
    process.exit(1);
});
