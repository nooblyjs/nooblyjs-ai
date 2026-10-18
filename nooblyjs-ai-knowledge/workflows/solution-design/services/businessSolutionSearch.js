/**
 * @fileoverview This file performs a search based on an object and gets all the instances of that object
 *
 * @author Digital Technologies Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

// External Libraries and Node
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout, setInterval, setImmediate } = require('node:timers/promises');

// Internal Libraries
const ModelBase = require('../../common/architecture/models/modelBase.js');
const GraphicClass = require('../../common/architecture/models/graphic.js');
const fileUtils = require('../../common/architecture/filesystem/filesystem.js');

// Instantiate business classes
const BusinessSolutionClass = require('./businessSolution.js');

/**
 * This class manages search functionality to find instances of objects
 * 
 * @method constructor -The constructor of the class
 * @method retrieve - Retrieve a search result for a model and cache the result
 */
class businessSolutionSearchClass extends ModelBase {

    /**
     * The constructor of the class
     * 
     * @async
     * @function run
     * @param {Object} settings - The data passed from the parent thread
     * @param {Object} settings.server - The ARIS server to call
     * @param {Object} settings.database - The ARIS database
     * @param {Object} settings.token - The token recieved from auth token call
     * @param {Object} settings.datafolder - The data folder where the data must be created in
     * @returns {object>} The JSON result
     */
    constructor(settings) {
        super(settings);
        this.settings = settings;
    }

    /**
     * Retrieve a search result for a model and cache the result
     * @param {string} object 
     * @param {boolean} useCache reuse the cache when true
     * @returns {data} the data and formatted data
     */
    async retrieve(object, useCache = true) {

        // Use the cached search result when it exists, the caller has not forced
        // a refresh, and it is still fresh. A search result carries no
        // "Last change" attribute (unlike a model), so freshness is judged from
        // the cache file's own modified time: a result written within the last
        // 48 hours is reused; an older one is re-fetched from ARIS so that
        // deleted/renamed objects self-heal even without a forced run.
        if (super.searchExists(object) && useCache) {
            const modified = super.searchModifiedTime(object);
            if (modified != null && (Date.now() - modified.getTime()) < (48 * 60 * 60 * 1000)) {
                return super.readSearch(object);
            }
            console.log(`Search cache for object ${object} is older than 48 hrs; refreshing from ARIS`);
        }

        // Retrieve a model from the database
        try {
            let result = '';
            let jsonData = {};

            const response = await fetch(`http://${this.settings.server}/abs/api/objects/${this.settings.database}/query?umcsession=${this.settings.token}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: `
                {
                    "start_guids": "${object}",
                    "items": [
                        {
                        "type": "OCCURRENCE",
                        "items": [
                            {
                            "type": "MODEL",
                            "typenum": "16",
                            "function": "TARGET"
                            }
                        ]
                        }
                    ]
                }`
            });
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

            // Clean up the JSON
            jsonData = JSON.parse(result);
            super.writeSearch(object, jsonData);

            return jsonData;
        }
        catch (error) {
            console.error(error)
            return error;
        }
    }

    /**
     * Retrieve the business solutions data for a passed object
     * @param {*} object
     * @param {boolean} useCache Reuse the search cache when true
     */
    async retrieveBusinessSolutionsForSearch(object, useCache = true) {
        let data = await this.retrieve(object, useCache);
        return data;
    }

}

module.exports = businessSolutionSearchClass;