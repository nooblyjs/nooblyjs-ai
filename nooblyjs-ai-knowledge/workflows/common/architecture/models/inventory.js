/**
 * @fileoverview Inventory — shared base for the per-domain "inventory" service
 * classes (business solutions, business processes, business landscapes,
 * infrastructure, …). An inventory is a single ARIS model whose objects each
 * assign out to the individual models the domain then walks.
 *
 * Every inventory class repeated the same "fetch one model by id and cache the
 * result to a named file" step; this centralises it. Domain classes extend this,
 * expose their own `retrieve(useCache)` that calls {@link retrieveInventory}
 * with their model id + cache file, and add their filter/folder/content logic
 * on top.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const ModelBase = require('./modelBase');
const ModelClass = require('./model');

/**
 * Base class for a domain inventory model.
 * @class
 * @extends ModelBase
 */
class Inventory extends ModelBase {

    /**
     * @param {Object} settings - The data passed from the parent thread
     * @param {string} settings.server - The ARIS server to call
     * @param {string} settings.database - The ARIS database
     * @param {string} settings.token - The token received from the auth token call
     * @param {string} settings.datafolder - Where retrieved data is cached
     */
    constructor(settings) {
        super(settings);
        this.settings = settings;
    }

    /**
     * Retrieve an inventory model by id and cache the formatted result under the
     * given cache file name (in <datafolder>/cache). Returns the model data.
     * @param {string} modelId - The inventory model id
     * @param {string} cacheFile - The cache file name (e.g. 'businessSolutions.json')
     * @param {boolean} [useCache=true] - Bypass the cache when false
     * @returns {Promise<object>} The formatted inventory model data
     */
    async retrieveInventory(modelId, cacheFile, useCache = true) {

        // Instantiate the model class
        const modelClass = new ModelClass(this.settings);

        // Retrieve the data and format it
        const data = await modelClass.retrieve(modelId, useCache);

        // Write the model cache to the domain's inventory file
        this.writeCache(cacheFile, data);

        return data;
    }
}

module.exports = Inventory;
