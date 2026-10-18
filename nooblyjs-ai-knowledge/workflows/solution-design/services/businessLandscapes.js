/**
 * @fileoverview Retrieve business solutions from the application landscape model
 * This class retrieves the business solutions from the application landscape model and creates content for the business solutions page
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

// Instatiate external classes
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout, setInterval, setImmediate } = require('node:timers/promises');

// Instantiate internal helper classes
const Inventory = require('../../common/architecture/models/inventory.js');
const GraphicClass = require('../../common/architecture/models/graphic.js');
const fileUtils = require('../../common/architecture/filesystem/filesystem.js');

// Instantiate business classes
const BusinessLandscapeClass = require('./businessLandscape.js');

/**
 * This class processes manages the inventory of business solutions
 * 
 * @constructor
 * @method retrieve - Retrieve a class json from the architecture modeling tool and returns the data
 * @method retrieveBusinessLandscapesData - Retieve the business landscape data for a filter and create the underlying data for the business landscape models
 * @method determineFolder - Determine the solution folder structure from the roadmap object
 * @method createBusinessLandscapesContent - Create business landscapes content
 * 
 */
class BusinessLandscapesClass extends Inventory {

   /**
    * Constructor
    * 
    * @async
    * @function run
    * @param {Object} settings - The data passed from the parent thread
    * @param {string} settings.server - The ARIS server to call
    * @param {string} settings.database - The ARIS database
    * @param {string} settings.token - The token recieved from auth token call
    * @param {string} settings.datafolder - The data folder is used for caching the retrieved data from the endpoints.
    * @returns {Object,Object} The JSON data and the formatted data
    */
   constructor(settings) {
      super(settings);
      this.settings = settings;
   }

   /**
    * Retrieve the roadmap model
    * @param {boolean} forceRetrieve allows us to ignore the cache
    * @returns {data} The cleaned up data retrieved from the endpoint
    */
   async retrieve(useCache = true) {

      // The landscape inventory model id and cache file are selected per workflow
      // via settings (model, modelfile). The shared base fetches and caches it.
      return super.retrieveInventory(this.settings.model, this.settings.modelfile, useCache);
   }

   /**
    * Retieve the business landscape data for a filter and create the underlying data for the business landscape models
    * @param {*} filter 
    * @param {*} useCache 
    */
   async retrieveBusinessLandscapesData(filter = {},useCache = true) {

      // Instantiate out business solution class
      const businessLandscape = new BusinessLandscapeClass(this.settings);

      // Retrieve the data from the Business Landscape Inventory. Awaited
      // throughout so callers (e.g. the workflow step) only resolve once every
      // model + graphic has actually been cached — a fire-and-forget .then here
      // returned immediately and let content generation race the retrieval,
      // hammering the source system with duplicate concurrent calls.
      try {
         const data = await this.retrieve(useCache);
         for (const [key, value] of Object.entries(data.modelObjects)) {
            if (value.assignments.length > 0) {
               for (let i = 0; i < value.assignments.length; i++) {
                  console.log(`Retrieving data for business landscape model ${value.assignments[i].model} with useCache set to ${useCache}`);
                  try {
                     await businessLandscape.retrieveBusinessLandscapeData(value.assignments[i].model, useCache);
                  } catch (error) {
                     console.error('Business Landscape data error:', value.assignments[i].model);
                  }
               }
            };
         };
      } catch (error) {
         console.error('Business Landscapes data error:', error);
      }
   }

   /**
    * Determine the folder that an assignment should appear in based on the inventory tree.
    *
    * The inventory is a flat map of model objects that describe a hierarchy through
    * "contains" connections (srcmodel contains targetmodel), with the tree rooted at
    * INVENTORY_ROOT ("Application Landscapes"). Each object may carry "assignments",
    * and each assignment is identified by its `model` id (e.g. the value passed in here).
    *
    * We resolve the folder by:
    *   1. Finding the object that owns the assignment.
    *   2. Computing that object's path from the root via a breadth-first walk down the
    *      "contains" tree (this keeps every path anchored at the root and picks a
    *      root-connected branch for objects that have more than one parent).
    *   3. Falling back to a parent walk-up for objects that are not reachable from the
    *      root, so orphaned/secondary inventories still resolve to a sensible path.
    *
    * Each folder segment uses the object's Identifier attribute when present, otherwise
    * its Name (matching createBusinessLandscapesContent), and is filesystem-sanitised.
    *
    * @param {String} model - The assignment model id (e.g. 3b346bd0-c867-11eb-2b0b-000d3aae822d)
    * @returns {Promise<String>} The folder path, e.g. "<contentfolder>/Application Landscapes/Business Domain Landscapes/Nigeria Business"
    */
   async determineFolder(model) {

      // Lets get our inventory data
      const data = await this.retrieve();
      const objects = data.modelObjects || {};
      const base = this.settings.contentfolder + "/" + this.settings.landscapefolder;

      // The label used for a folder: Identifier attribute first, then Name, then the id.
      const labelOf = (id) => {
         const o = objects[id];
         if (!o || !o.attributes) return id;
         return o.attributes.Identifier || o.attributes.Name || id;
      };

      // Find the object that owns this assignment (fallback: the model may be an object itself).
      let owner = null;
      for (const [id, value] of Object.entries(objects)) {
         if ((value.assignments || []).some((a) => a.model === model)) {
            owner = id;
            break;
         }
      }
      if (!owner && objects[model]) owner = model;

      // If we can't place it, default to the inventory root folder.
      if (!owner) return base;

      // Build the "contains" tree (parent -> children) and the reverse (child -> parents).
      const children = {};
      const parents = {};
      for (const value of Object.values(objects)) {
         for (const c of value.connections || []) {
            if (c.type !== 'contains') continue;
            (children[c.srcmodel] = children[c.srcmodel] || new Set()).add(c.targetmodel);
            (parents[c.targetmodel] = parents[c.targetmodel] || new Set()).add(c.srcmodel);
         }
      }

      // Preferred path: breadth-first walk down from the root, recording the first
      // (shortest, root-anchored) path reached for every object.
      const pathFromRoot = { [this.settings.inventoryroot]: [this.settings.inventoryroot] };
      const queue = [this.settings.inventoryroot];
      while (queue.length) {
         const current = queue.shift();
         for (const child of children[current] || []) {
            if (!pathFromRoot[child]) {
               pathFromRoot[child] = [...pathFromRoot[current], child];
               queue.push(child);
            }
         }
      }

      let chain = pathFromRoot[owner];

      // Fallback for objects not reachable from the root: walk up via any parent,
      // guarding against cycles, then anchor under the inventory root.
      if (!chain) {
         chain = [];
         const seen = new Set();
         let current = owner;
         while (current && !seen.has(current)) {
            seen.add(current);
            chain.unshift(current);
            const next = parents[current] ? [...parents[current]][0] : undefined;
            current = next;
         }
         if (chain[0] !== this.settings.inventoryroot) chain.unshift(this.settings.inventoryroot);
      }

      // Map ids to sanitised folder labels and join under the content folder.
      // (The root object's own name is "Application Landscapes" == BUSINESS_LANDSCAPE_FOLDER,
      //  so the chain already begins with the inventory folder.)
      const segments = chain.map((id) => fileUtils.sanitizeFilename(labelOf(id)));
      return this.settings.contentfolder + "/" + segments.join("/");

   }
         
   /**
    * Create business landscapes content
    * @returns 
    */
   async createBusinessLandscapesContent(useCache = true) {

      // Instantiate out business solution class
      const businessLandscape = new BusinessLandscapeClass(this.settings);

      try {
         // Retrieve the data from the Business Solution roadmap
         const data = await this.retrieve(useCache);

         for (const [key, value] of Object.entries(data.modelObjects)) {
            if (value.assignments.length > 0) {
               for (let i = 0; i < value.assignments.length; i++) {
                  try {
                     const options = {};
                     options.folder = await this.determineFolder(value.assignments[i].model);

                     await businessLandscape.createBusinessLandscapeContent(value.assignments[i].model, options, useCache);
                  } catch (error) {
                     console.log(error)
                     console.error('Business Landscape content error:', value.assignments[i].model);
                  }
               }
            };
         };

      } catch (error) {
         console.error('Business Landscapes content error:', error);
      }

   }

}

module.exports = BusinessLandscapesClass;