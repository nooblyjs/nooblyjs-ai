/**
 * @fileoverview Retrieve a model Grapic from ARIS
 *
 * @author Digital Technologies Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const ModelBase = require('./modelBase');

/**
 * This class returns the graphic of a model
 * 
 * @method retrieve - Retrieve a class json from the architecture modeling tool and returns the data
 */
class ModelGraphicClass extends ModelBase {

    /**
     * Constructor
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
        this.settings = settings
    }

    /**
     * Retrieve a model
     * @returns 
     */
    async retrieve(model) {

        // Retrieve a model from the database. Bound the request with a timeout
        // so a slow/unresponsive ARIS server can never hang a content build.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            let result = '';
            const response = await fetch(`http://${ this.settings.server}/abs/api/models/${this.settings.database}/${model}/graphic?withcontent=true&umcsession=${ this.settings.token}`, { signal: controller.signal });
            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8'); // Specify the correct encoding
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break; // Stream has ended
                }
                result += decoder.decode(value, { stream: true });
            }
            result += decoder.decode();
            return JSON.parse(result);
        }
        catch (error) {
            console.error(error)
            return error;
        }
        finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Return the base64 string of the the model image
     * @param {string} model 
     * @returns 
     */
    async retrievePNGData(model) {
        let content = await this.retrieve(model);
        if (content.items == null){
            throw new Error(`Error returning image for model ${model} `);
        } else if (content.items[0] == null){
             throw new Error(`Error returning image for model ${model} `);
        } else if (content.items[0].pngdata == null){
             throw new Error(`Error returning image for model ${model} `);
        }
        return content.items[0].pngdata;
    }

    /**
     * Return the binary png data
     * @param {string} model 
     * @param {string} pngData 
     * @returns 
     */
    /**
     * Return the model's "Last change" date from the cached model JSON, or null
     * when it cannot be determined (no model cache, missing attribute, or an
     * unparseable value).
     * @param {string} model - The model id
     * @returns {Date|null}
     */
    modelLastChange(model) {
        if (!this.modelExists(model)) {
            return null;
        }
        const data = this.readModel(model);
        const lastChange = data && data.attributes && data.attributes["Last change"];
        if (!lastChange) {
            return null;
        }
        const date = new Date(lastChange);
        return isNaN(date.getTime()) ? null : date;
    }

    /**
     * Return the base64 string with disk caching to {datafolder}/graphics/{model}.b64
     *
     * The cached graphic is reused unless we can prove the model changed after
     * it was cached (its "Last change" is newer than the cache file). When the
     * model's last-change date is unknown the cache is kept rather than
     * re-fetched, so a missing model cache never triggers an unnecessary (slow)
     * call to ARIS. Passing useCache=false forces a fresh fetch regardless (the
     * daily catch-all), mirroring model.js retrieve.
     * @param {string} model
     * @param {boolean} [useCache=true] - Reuse the cached image when true
     * @returns {string} base64 PNG data URI
     */
    async retrievePNGDataCached(model, useCache = true) {
        const fs = require('node:fs');
        const path = require('node:path');
        const cacheFile = `${this.datafolder}/graphics/${model}.b64`;
        const cacheExists = fs.existsSync(cacheFile);

        // Reuse the cached graphic when allowed and it is still newer than the model's last change
        if (useCache && cacheExists) {
            const lastChange = this.modelLastChange(model);
            const cached = fs.statSync(cacheFile).mtime;
            if (lastChange == null || cached > lastChange) {
                return fs.readFileSync(cacheFile, 'utf8');
            }
        }

        // The model changed since the graphic was cached (or there is no cache
        // yet): (re)fetch from ARIS. A refetch must never break a content build,
        // so on any failure fall back to the stale cache when we have one.
        try {
            const pngData = await this.retrievePNGData(model);
            fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
            fs.writeFileSync(cacheFile, pngData);
            return pngData;
        } catch (error) {
            if (cacheExists) {
                console.warn(`Graphic refetch failed for model ${model}; using cached image. ${error}`);
                return fs.readFileSync(cacheFile, 'utf8');
            }
            throw error;
        }
    }

    /**
     * Return the binary png data
     * @param {string} model
     * @param {string} pngData
     * @returns
     */
    async retrievePNG(model, pngData) {
        if (pngData == null){
            const pngData = await this.retrievePNGData(model)
        }
        const base64Data = pngData.replace(/^data:image\/png;base64,/, '');
        const imageBuffer = Buffer.from(pngData, 'base64');
        return imageBuffer;
    }
};

module.exports = ModelGraphicClass;
