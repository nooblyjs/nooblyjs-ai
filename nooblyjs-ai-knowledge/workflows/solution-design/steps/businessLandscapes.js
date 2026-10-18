/**
 * @fileoverview Retrieve and publish a Business Landscape (Application / Reference Architecture)
 * This worker retrieves a landscape inventory's data and creates the landscape content pages.
 * The landscape to process (Application vs Reference) is selected per-workflow via
 * the workflow's defaultInput (data.landscape), so a single step serves both.
 * @author Digital Technologies Team
 * @version 1.0.0
 * @lastupdated 2026-05-31
 */

'use strict';

// Load our settings
require('dotenv').config({path:'../../../.env'});

// Shared step helpers (ARIS credentials + authentication)
const authenticateStep = require('../../common/architecture/authentication/authenticateStep');

// The business landscapes class is used to retrieve and publish a Business Landscape (Application / Reference Architecture)
const BusinessLandscapesClass = require('../services/businessLandscapes');

/**
 * Retrieve a landscape inventory and publish its content pages.
 *
 * The landscape is selected by the workflow's defaultInput, e.g.
 *   { "landscape": { "landscapefolder": "Application Landscapes",
 *                    "model": "c36892e0-6fe2-11e4-17c9-005056a80022",
 *                    "inventoryroot": "188f6420-6fe2-11e4-17c9-005056a80022",
 *                    "modelfile": "businessLandscapes.json" } }
 * "Application Architecture" and "Reference Architecture" are the same step with
 * different landscape config (see workflow-definition.json).
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @param {Object} data.landscape - The landscape selector (see above)
 * @param {string} data.landscape.landscapefolder - Top-level content folder for this landscape
 * @param {string} data.landscape.model - The landscape inventory model id
 * @param {string} data.landscape.inventoryroot - The inventory root object id (anchors the folder tree)
 * @param {string} data.landscape.modelfile - The inventory cache file name
 * @param {boolean} [data.useCache] - Reuse the cache for settled models (defaults to true).
 *        Set false for the daily catch-all that always refetches from ARIS.
 * @param {number} [data.cacheAgeDays] - Refetch models changed within this many days (defaults to 1)
 * @returns {Promise<Object>} A promise that resolves with a completion message object
 */
async function run(data) {

    // A landscape selector is required — without it we'd have no inventory to
    // retrieve. Mirrors the filter guard used by the business solution steps so
    // we never call the source system with an undefined target.
    if (data.landscape == null) {
        throw new Error('Error no landscape is being passed. Please add a landscape e.g {"landscape": {"landscapefolder": "Application Landscapes", "model": "<inventory id>", "inventoryroot": "<root id>", "modelfile": "businessLandscapes.json"}}');
    }

    const { landscapefolder, model, inventoryroot, modelfile } = data.landscape;

    // Add required settings to the data object for authentication
    data.settings = authenticateStep.arisCredentials();
    data.settings.contentfolder = data.contentfolder || process.env.design_solution_contentfolder;
    data.settings.datafolder = process.env.design_solution_datafolder;

    // Cache controls (read by the shared model.js / graphic.js via settings):
    //   useCache=false  → always refetch from ARIS (daily catch-all)
    //   useCache=true   → reuse cache for models settled > cacheAgeDays days
    data.settings.useCache = data.useCache ?? true;
    data.settings.cacheAgeDays = data.cacheAgeDays ?? 1;

    // Landscape-specific settings (selected per workflow via defaultInput).
    // The service reads model/modelfile to load the inventory and
    // inventoryroot/landscapefolder to anchor the published folder tree.
    data.settings.landscapefolder = landscapefolder;
    data.settings.model = model;
    data.settings.inventoryroot = inventoryroot;
    data.settings.modelfile = modelfile;

    // Instantiate the classes we need
    const businessLandscapes = new BusinessLandscapesClass(data.settings);

    // Authenticate the user
    await authenticateStep.authenticate(data.settings);

    // Phase 1: retrieve (and cache) the inventory + each model's data and graphic.
    // Phase 2: publish the landscape content pages from that cached data.
    // Both are awaited so the step only completes once the pages are written.
    const useCache = data.settings.useCache;
    await businessLandscapes.retrieveBusinessLandscapesData({}, useCache);
    var businessLandscapesContent = await businessLandscapes.createBusinessLandscapesContent();

    // return our landscapes that were built
    const result = {
        'response': businessLandscapesContent,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };
    return result;
}

module.exports = {
  run,
};
