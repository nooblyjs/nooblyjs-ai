/**
 * @fileoverview Retrieve business solutions from the domain model
 * This class retrieves the business solutions from the domain model and creates content for the business solutions page
 *
 * @author Digital Technologies Team
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
const BusinessSolutionClass = require('./businessSolution.js');

/**
 * Value streams in priority order. A solution's principal value stream is the
 * first of these flagged "Principal" on the roadmap object. This order also
 * decides which value-stream folder the solution's content is written to, so
 * the "Value Stream" filter and the folder placement always agree.
 */
const VALUE_STREAMS = [
   'Move',
   'Data and Analytics',
   'Sell',
   'People',
   'Finance',
   'Technology',
   'Plan',
   'Service',
   'Buy',
   'Artificial Intelligence',
];

/**
 * This class processes manages the inventory of business solutions
 * 
 * @method retrieve - Retrieve a class json from the architecture modeling tool and returns the data
 * @method filterBusinessSolution - Filter the business solution data for a given filter
 * @method determineFolder - Determine the solution folder structure from the roadmap object
 * @method creatBusinessSolutionsFolder - Build a solution folder from the roadmap
 * @method createBusinessSolutionsFolders - Build the solution folders from the data from our business solution json file
 * @method createBusinessSolutionsContent - Create business solutions data for a filtered list  
 */
class BusinessSolutionsClass extends Inventory {

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

      // '4688ca40-e7ec-11eb-2b0b-000d3aae822d' is the Business Solutions Domain Inventory.
      // The shared base fetches it and caches the result to businessSolutions.json.
      return super.retrieveInventory('4688ca40-e7ec-11eb-2b0b-000d3aae822d', 'businessSolutions.json', useCache);
   }

   /**
    * Retrieve all the business solutions data for a specified filter. 
    *
    * @param {*} filter
    * {"Responsible Technology Executive": "Debbie Cunningham"}
    * {"Roadmap": "c565dea1-9e3f-11ee-4896-005056bd2116"}
    */
   async retrieveBusinessSolutionsData(filter = {}, useCache = true) {

      // Instantiate out business solution class
      const businessSolution = new BusinessSolutionClass(this.settings);

      // Retrieve the data from the Business Solution roadmap
      let data = await this.retrieve(useCache)

         // filter out business solutions for passed filtre
      let solutions = await this.filterBusinessSolution(filter)
      if (solutions != null) {
         console.log("===========================================================================")
         console.log(`Processing model Objects ${Object.entries(solutions.modelObjects).length} `);
         console.log("===========================================================================")
         let cnt = 0;
         for (const [key, value] of Object.entries(solutions.modelObjects)) {
            cnt ++;
            if (value.assignments.length > 0) {
               try {
                  await businessSolution.retrieveBusinessSolutionData(value.assignments[0].model, useCache);
               } catch (error) {
                  console.error('Business Solution Data error:', value.assignments[0].model);
               }
            };
            console.log(`Processed model Objects ${cnt} of ${Object.entries(solutions.modelObjects).length} `);
         }
      }
   }

   /**
    * Determine the solution folder structure from the roadmap object
    * 
    * @param {object} [key, value] array of roadmap model 
    * @returns {object} {portfolio: "None", valuestream : "Unassigned", domain: "Unassigned"}
    */
   determineFolder([key, value]) {

      let folder = { portfolio: "None", valuestream: "Unassigned", domain: "Unassigned" } // Our folder object

      // Do not process archived or retired applications
      if (value.attributes["Current Status"] != "Retired" && value.attributes["Current Status"] != "Archived") {

         // Determine the porfolio
         switch (value.attributes["Responsible Technology Executive"]) {
            case 'Sandra Moumtzis':
               folder.portfolio = "Enterprise Technologies";
               break;
            case 'Debbie Cunningham':
               folder.portfolio = "Digital Technologies";
               break;
            case 'Adrian Linde':
               folder.portfolio = "Fintech Technologies";
               break;
            case 'Jacques De Waal':
               folder.portfolio = "Digital Infrastructure";
               break;
            case 'Ferdie Voges':
               folder.portfolio = "Shared Services";
               break;
            case 'Maciej Kaliszkas':
               folder.portfolio = "Maciej Kaliszkas";
               break;
            case 'Maciej Kaliszka':
               folder.portfolio = "Data and Analytics";
               break;
            case 'Richard Page':
               folder.portfolio = "Commercial Services";
               break;
            default:
               folder.portfolio = value.attributes["Responsible Technology Executive"];
         }

         // Determine the folder from the value stream (first "Principal" wins)
         const principalStream = this._principalValueStream(value);
         if (principalStream) {
            folder.valuestream = principalStream;
         }

         // Determine the Domain
         if (value.connections != null) {
            for (let i = 0; i < value.connections.length; i++) {
               if (value.connections[i].type == "belongs to class") {
                  folder.domain = fileUtils.sanitizeFilename(value.connections[i].targetmodelname)
               }
            }
         }
      }

      return folder
   }

   /**
    * Filter the business solution data for a given filter.
    *
    * The filter accepts three shapes:
    *
    *  1. Empty / missing — returns every active solution.
    *  2. Single object (legacy) — `{ "Roadmap": "...id..." }`.
    *  3. Array of single-key objects — values that share a key OR together;
    *     values across different keys AND together.
    *
    * @example
    *  // architects in the "People" domain
    *  filterBusinessSolution([
    *    { "Responsible Technology Executive": "Richard Page" },
    *    { "Responsible Technology Executive": "Sandra Moumtzis" },
    *    { "Domain": "People" }
    *  ]);
    *
    * @example
    *  // a single roadmap
    *  filterBusinessSolution([{ "Roadmap": "117e4011-7cca-11f0-00be-005056bd2116" }]);
    *
    * Supported keys:
    *  - "Responsible Technology Executive" (attribute lookup)
    *  - "Roadmap" (matches any assignment's `model` id)
    *  - "Domain" (matches `connections[].targetmodelname` for `belongs to class`)
    *  - Any other key is matched against `value.attributes[key]`
    *
    * @param {Array<object>|object} [filter] Filter criteria (see shapes above)
    * @returns {object} { modelObjects: {} } The filtered models
    */
   async filterBusinessSolution(filter) {

      const formattedModel = { modelObjects: {} };
      const data = super.readCache('businessSolutions.json');
      const groups = this._normalizeFilter(filter);

      for (const [key, value] of Object.entries(data.modelObjects)) {
         if (value.attributes["Current Status"] === "Retired" || value.attributes["Current Status"] === "Archived") continue;
         if (this._matchesFilter(value, groups)) {
            formattedModel.modelObjects[key] = value;
         }
      }
      return formattedModel;
   }

   /**
    * Collapse a filter input into Map<key, Set<value>> so we can OR values
    * within a key and AND across keys.
    * @private
    */
   _normalizeFilter(filter) {
      const groups = new Map();
      if (filter == null) return groups;

      const entries = Array.isArray(filter) ? filter : [filter];
      for (const entry of entries) {
         if (!entry || typeof entry !== 'object') continue;
         for (const [k, v] of Object.entries(entry)) {
            if (v == null || v === '') continue;
            if (!groups.has(k)) groups.set(k, new Set());
            groups.get(k).add(v);
         }
      }
      return groups;
   }

   /**
    * @private
    * @returns {boolean} true when the model matches every filter group
    */
   _matchesFilter(value, groups) {
      if (groups.size === 0) return true;
      for (const [key, allowed] of groups.entries()) {
         const actuals = this._extractFilterValues(value, key);
         if (!actuals.some(a => allowed.has(a))) return false;
      }
      return true;
   }

   /**
    * Resolve a model's principal value stream — the first VALUE_STREAMS entry
    * flagged "Principal". Returns null when none are. This is the same stream
    * used for the value-stream folder, so filtering and placement agree.
    * @private
    * @returns {string|null}
    */
   _principalValueStream(value) {
      if (!value || !value.attributes) return null;
      return VALUE_STREAMS.find(
         (stream) => value.attributes[`Value Stream - ${stream}`] === "Principal"
      ) ?? null;
   }

   /**
    * Pull the candidate values out of a model for a given filter key.
    * @private
    */
   _extractFilterValues(value, key) {
      // Match the reserved filter keys case-insensitively. Callers (the wiki
      // "Refresh" button, the workflow defaultInput template, hand-written
      // filters) use lower-case `roadmap`, while the original switch only knew
      // capitalised `Roadmap` — a mismatch silently matched zero models. The
      // default branch still uses the original key verbatim because model
      // attribute names ("Current Status", …) are case-sensitive.
      switch (String(key || '').trim().toLowerCase()) {
         case 'roadmap': {
            if (!value.assignments || value.assignments.length === 0) return [];
            return value.assignments.map(a => a.model).filter(Boolean);
         }
         case 'domain': {
            if (!value.connections) return [];
            return value.connections
               .filter(c => c.type === 'belongs to class')
               .map(c => c.targetmodelname)
               .filter(Boolean);
         }
         case 'value stream': {
            const stream = this._principalValueStream(value);
            return stream ? [stream] : [];
         }
         default: {
            const attr = value.attributes && value.attributes[key];
            return attr ? [attr] : [];
         }
      }
   }

   /**
    * Build a Business Solution folder from the roadmap
    * 
    * @param {object} [key, value] Single Roadmap Object 
    * @returns {string}}  The solution folder created
    */
   async creatBusinessSolutionsFolder([key, value]) {

      let solutionFolder = ""; // The solution folder created

      // Determine the solution folder. If it is null return null;
      let folder = this.determineFolder([key, value]);
      if (folder.portfolio == null) return "";

      // Create the business solution folder
      let businessSolutionPath = path.join(this.settings.contentfolder, folder.portfolio, folder.domain, fileUtils.sanitizeFilename(value.attributes.Name));
      if (!fs.existsSync(businessSolutionPath)) {
         fs.mkdirSync(path.join(this.settings.contentfolder, folder.portfolio, folder.domain, fileUtils.sanitizeFilename(value.attributes.Name)), { recursive: true });
         solutionFolder = "Folder Created for " + businessSolutionPath;
      } else {
         solutionFolder = "Folder Already Exists for " + businessSolutionPath;
      }

      // Return the solutin folder creation status message
      return solutionFolder;
   }

   /**
    * Build the solution folders from the data from our business solution json file
    * @param {*} filters 
    * {"Responsible Technology Executive": "Debbie Cunningham"}
    * {"Roadmap": "c565dea1-9e3f-11ee-4896-005056bd2116"}
    * @returns {array} The array of folder creation messages
    */
   async createBusinessSolutionsFolders(filter = {}, useCache = true) {

      let businessSolutionFolders = []; // Our container of business solutions folders

      // Ensure we have the latest data      
      await this.retrieve(useCache); // Ensure we have the latest data

      // Read our business solutions construct
      let data = await this.filterBusinessSolution(filter);

      // For all the roadmaps generate the folders and business solution markdown
      for (const [key, value] of Object.entries(data.modelObjects)) {
         let businessSolutionFolder = await this.creatBusinessSolutionsFolder([key, value]);
         businessSolutionFolders.push(businessSolutionFolder);
      }

      return businessSolutionFolders;
   }

   /**
    * Create business solutions data for a filtered list
    * @param {*} filter 
    * @returns 
    */
   async createBusinessSolutionsContent(filter = {}, useCache = true) {

      const returnSolutions = []; // The solutions that have been created

      // Instantiate out business solution class
      const businessSolution = new BusinessSolutionClass(this.settings);

      // Retrieve the data from the Business Solution roadmap
      let data = await this.retrieve(useCache)

      let solutions = await this.filterBusinessSolution(filter)
      if (solutions != null) {
         for (const [key, value] of Object.entries(solutions.modelObjects)) {
            if (value.assignments.length > 0) {
               await businessSolution.createBusinessSolutionContents(value.assignments[0].model, useCache);
               returnSolutions.push(value.assignments[0].model);
            };
         };
      };

      // When a non-empty filter was supplied (e.g. the wiki "Refresh" button's
      // single-roadmap filter) but nothing matched, the run would otherwise
      // report success having built nothing — a misleading "Content rebuilt
      // successfully" in the UI. Fail loudly so the workflow reports failure and
      // the caller sees the real outcome. An empty filter (build-all) is left
      // untouched: _normalizeFilter drops empty values, so its group size is 0.
      const filterGroups = this._normalizeFilter(filter);
      if (filterGroups.size > 0 && returnSolutions.length === 0) {
         throw new Error('No business solutions matched the filter ' + JSON.stringify(filter) + ' — nothing was built.');
      }

      return returnSolutions;
   }

}

module.exports = BusinessSolutionsClass;