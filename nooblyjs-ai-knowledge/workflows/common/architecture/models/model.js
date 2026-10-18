/**
 * @fileoverview Perform Model Operations
 * This library is used to retrieve a model utilising the ARIS API's
 *
 * @author Digital Technologies Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const ModelBase = require('./modelBase');

/**
 * This class manages all model functions
 * 
 * @method retrieve - Retrieve a model JSON for a supplied model id and returns the JSON
 */
class ModelClass extends ModelBase {

    /**
     * Retrieve a model from the ARIS API's
     * 
     * @async
     * @function run
     * @param {Object} settings - The settings passed from the parent thread
     * @param {Object} settings.server - The ARIS server to call
     * @param {Object} settings.database - The ARIS database
     * @param {Object} settings.token - The token recieved from auth token call
     * @returns {object>} The JSON result
     */
    constructor(settings) {
        super(settings);
        this.settings = settings;
    }

    /**
     * Retrieve the model, with cache-age awareness.
     *
     * useCache = false : always fetch fresh from ARIS (the daily catch-all that
     *                    picks up edits to otherwise-settled models).
     * useCache = true  : serve the cached copy for models whose "Last change" is
     *                    older than `cacheAgeDays` days (treated as settled);
     *                    refetch models changed within that window so recent
     *                    edits surface quickly.
     *
     * @param {string} model
     * @param {boolean} useCache - Reuse the cache for settled models when true
     * @param {number} [cacheAgeDays] - Refetch models changed within this many
     *        days; falls back to settings.cacheAgeDays, then 1.
     * @returns {Promise<object>}
     */
    async retrieve(model, useCache = true, cacheAgeDays) {

        // Resolve the freshness window: explicit arg → settings → 1 day default
        if (cacheAgeDays == null) {
            cacheAgeDays = Number(this.settings && this.settings.cacheAgeDays) || 8;
        }

        // Serve from cache when allowed and the model has settled
        if (useCache && super.modelExists(model)) {

            // retrieve the data from the cache
            let data = super.readModel(model);

            // if we have no last change date use the cache
            if (data.attributes == undefined  || data.attributes["Last change"] == undefined){
                console.log(`Model ${model}: no "Last change" date, serving cache`)
                return data;
            }

            // Settled for longer than the freshness window → reuse the cache
            let lastChangeDate = new Date(data.attributes["Last change"]);
            let ageMs = Date.now() - lastChangeDate.getTime();
            if (!isNaN(lastChangeDate.getTime()) && ageMs > (cacheAgeDays * 24 * 60 * 60 * 1000)) {
                console.log(`Model ${model}: unchanged for > ${cacheAgeDays} day(s), serving cache`)
                return data;
            }
            // Otherwise the model changed within the window → fall through and refetch
        }

        // Retrieve a fresh copy from ARIS (useCache=false, no cache yet, or a
        // recently-changed model).
        try {
            let result = '';
            let jsonData ={};

            console.log(`Model ${model}: fetching fresh from ARIS (useCache=${useCache}, cacheAgeDays=${cacheAgeDays})`)
            const response = await fetch(`http://${this.settings.server}/abs/api/models/${this.settings.database}/${model}?withcontent=true&attributes=all&umcsession=${this.settings.token}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8'); // Specify the correct encoding
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break; 
                }
                result += decoder.decode(value, { stream: true });
            }
            result += decoder.decode();

            // Clean up the JSON
            jsonData = this.formatModel(JSON.parse(result));
            super.writeModel(model, jsonData);

            return jsonData;
        }
        catch (error) {
            console.error(`Error retrieving model ${model} from ARIS server ${this.settings.server}`)
            console.error(error)
            // The live ARIS fetch/parse failed. Fall back to the cached model
            // when one exists (mirrors the graphic's stale-cache resilience in
            // graphic.js retrievePNGDataCached) so a transient ARIS failure on a
            // recently-changed model — which the cacheAgeDays freshness rule
            // forces us to refetch — never turns a perfectly good cached model
            // into an Error that the caller then skips. Only surface the error
            // when we have nothing cached to fall back to.
            if (super.modelExists(model)) {
                console.warn(`Using cached copy for model ${model} after refetch failure`);
                return super.readModel(model);
            }
            return error;
        }
    }
};

module.exports = ModelClass;
