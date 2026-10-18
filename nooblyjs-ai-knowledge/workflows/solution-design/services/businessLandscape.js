/**
 * @fileoverview Retrieve a business solution roadmap object and process its view points
 *
 * @author NooblyJS Team
 * @version 1.1.0
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');

// Internal Libraries
const ArchitectureModel = require('../../common/architecture/models/architectureModel.js');
const GraphicClass = require('../../common/architecture/models/graphic.js');
const fileUtils = require('../../common/architecture/filesystem/filesystem.js');

/**
 * Curated profile rows for an application object in a landscape inventory.
 *
 * Applications are by far the largest group on these diagrams (3,228 of the
 * 6,029 objects across the cached Application Landscapes) and the richest —
 * an application carries upwards of 40 attributes, so listing them all would
 * bury the useful ones. Only keys actually present on an object are rendered.
 *
 * Deliberately the same list businessSolution.js uses for its diagram
 * inventories, so the SAME application reads the same way whether you meet it
 * on a landscape or inside a solution — plus `Abbreviation` and `Domain
 * Architect`, which are ~90% populated here and are how people identify and
 * route an application when scanning a landscape.
 */
const APPLICATION_PROFILE_FIELDS = [
    ['Description', 'Description/Definition'],
    ['Short Description', 'Short description'],
    ['Abbreviation', 'Abbreviation'],
    ['Manufacturer', 'Manufacturer'],
    ['Application Type', 'Application Type'],
    ['Hosting Type', 'Hosting Type'],
    ['Current Status', 'Current Status'],
    ['Future Strategy', 'Future Strategy'],
    ['Pace Layer', 'Pace Layer'],
    ['Lifecycle', 'Lifecycle'],
    ['Standardization Status', 'Standardization Status'],
    ['Vendor Mainstream Support', 'Vendor Mainstream Support'],
    ['Vendor Extended Support', 'Vendor Extended Support'],
    ['Domain Architect', 'Domain Architect'],
    ['Solution Architect', 'Solution Architect'],
    ['Business Owner', 'Business Owner'],
    ['Responsible Technology Executive', 'Responsible Technology Executive'],
    ['DR Level', 'DR Level'],
    ['DR Available', 'DR-Available'],
    ['Solution Continuity Tier', 'Solution Continuity Tier'],
    ['Solution Criticality Tier', 'Solution Criticality Tier'],
];

/**
 * Manages the inventory of a business landscape
 *
 *
 * @method retrieve - Retrieve a model JSON from the architecture modelling tool
 * @method retrieveBusinessLandscapeData - Retrieve and cache all data for a business landscape model
 */
class businessLandscapeClass extends ArchitectureModel {

    /**
     * @param {Object} settings - The data passed from the parent thread
     * @param {string} settings.server - The ARIS server to call
     * @param {string} settings.database - The ARIS database
     * @param {string} settings.token - The token received from the auth token call
     * @param {string} settings.model - The model to be processed
     * @param {string} settings.datafolder - Where retrieved data is cached
     * @param {string} settings.contentfolder - Where the formatted content is written
     */
    constructor(settings) {
        super(settings);
        this.settings = settings;
    }

    /**
     * Retrieve and cache all data for a business solution roadmap.
     * @param {string} model - The model id
     * @param {boolean} useCache - Bypass the cache when true
     */
    async retrieveBusinessLandscapeData(model, useCache = true) {

        // Retrieve the model data and cache it
        await this.retrieve(model, useCache);

        // Retrieve the model's graphic and cache it
        const graphic = new GraphicClass(this.settings);
        await graphic.retrievePNGDataCached(model, useCache);

    }

    /**
     * Build a business landscape page for a specified model: the diagram
     * graphic, followed by a grouped accordion walk-through of every object the
     * diagram contains.
     *
     * The accordions are the point. A landscape page used to be a heading and a
     * base64 PNG and nothing else — around half a megabyte of image carrying
     * content that no reader could search, no index could tokenise and the AI
     * context builder could only describe as "an illustrative image". Every
     * application, capability, service, data flow and location on the diagram
     * was invisible to the platform. The same walk-through already backs the
     * Solution Component / Deployment / Cybersecurity viewpoints
     * (businessSolution.createModelInventoryContent); this brings landscapes to
     * the same standard, sharing the implementation via ArchitectureModel rather
     * than copying it.
     *
     * The content is always (re)built from the model's cached data + graphic;
     * the write itself is skipped when the result is byte-identical to the file
     * on disk (see writeMarkdownPreserving), so unchanged pages are never
     * rewritten — and a reader's own annotations/comments survive a rebuild.
     *
     * @param {string} model
     * @param {object} options
     * @param {string} options.folder - Destination folder for the page
     * @param {boolean} useCache
     */
    async createBusinessLandscapeContent(model, options = {}, useCache = true) {
        try {
            const data = await this.retrieve(model, useCache);

            // If there is no data or no attributes, skip this model
            if (data == null || data.attributes == null) {
                return;
            }

            /* ----------------   Model Status Disabled due to lack of data -------------------------------------
            // If the solution has no model status ignore it
            if (data.attributes["Model status"] == null) {
               return;
            }         
            
            // If the model is approved
            if (data.attributes["Model status"] != "Approved") {
                console.log(data.attributes.Name + " " + data.attributes["Model status"])
                return;
            }
            */
            
            const filePath = path.join(options.folder, `${fileUtils.sanitizeFilename(data.attributes.Name)}.md`);

            // Create the graphic content for the graphic class
            const graphic = new GraphicClass(this.settings);
            const base64Png = await graphic.retrievePNGDataCached(model, useCache);
            let content = `# ${data.attributes["Name"]}\n\n`
                + `![${data.attributes.Name}](data:image/png;base64,${base64Png})\n`;

            // The object walk-through. Built defensively: a landscape's value is
            // its diagram, so a fault in the inventory must never cost the page
            // the image it already has.
            try {
                const inventory = this.buildInventoryAccordions(data, {
                    title: 'Landscape',
                    profileFieldsFor: (object) =>
                        (object.type === 'Application system type' ? APPLICATION_PROFILE_FIELDS : null),
                });
                if (inventory) {
                    content = `${content.trimEnd()}\n\n${inventory}\n`;
                }
            } catch (inventoryError) {
                console.error(`Landscape inventory error for model ${model}:`, inventoryError.message);
            }

            fileUtils.writeFile(filePath, content);

        } catch (error) {
            console.log(error);
        }
    }
}

module.exports = businessLandscapeClass;
