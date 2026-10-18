/**
 * @fileoverview Retrieve business processes from the entry model
 *
 * @author Digital Technologies Team
 * @date 2024-06-20
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

// Instantiate the business process calss
const BusinessProcessClass = require('./businessProcess.js');

/**
 * This class processes manages the inventory of business processes
 * 
 * @method retrieve - Retrieve a class json from the business pro modeling tool and returns the data
 * @method retrieveBusinessProcessesData - Retrieve all the business processes data for a specified filter.
 */
class BusinessProcessesClass extends Inventory {

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
    * @param {string} modelId - The inventory model id
    * @param {string} cacheFile - The cache file name (e.g. 'businessSolutions.json')
    * @param {boolean} forceRetrieve allows us to ignore the cache
    * @returns {data} The cleaned up data retrieved from the endpoint
    */
   async retrieve(modelId, cacheFile, useCache = true) {

      // 'd496ce00-1ef4-11de-7d4f-000c29300558' is the Business Processes Domain Inventory.
      // The shared base fetches it and caches the result to businessProcesses.json.
      return super.retrieveInventory(modelId, cacheFile, useCache);
   }

   /**
    * Retrieve all the business processes data for a specified filter. 
    *
    * @param {*} filter
    *   @requires filter.modelId The model id to call
    *   @requires filter.cacheFile The name of the file where the data will be stored           
    * @param {boolean} [useCache=true] 
    */
   async retrieveBusinessProcessesData(filter = {}, useCache = true) {

      // Instantiate out business solution class
      const businessProcess = new BusinessProcessClass(this.settings);

      // Retrieve the data from the Business Solution roadmap
      let data = await this.retrieve(filter.modelId, filter.cacheFile, useCache)
      // Retrieve the underlying model data
      if (data != null) {
         for (const [key, value] of Object.entries(data.modelObjects)) {
            // Only follow EPC sub-process links (each L1 is an "EPC" assignment);
            // grouping objects like "Support"/"Value Chain" have no process model.
            if (businessProcess.isProcessAssignment(value.assignments[0])) {
               try {
                  await businessProcess.retrieveBusinessProcessData(value.assignments[0].model, useCache);
               } catch (error) {
                  console.error(error)
                  console.error('Business Process Data error:', value.assignments[0].model);
               }
            };
         }
      }
   }

    /**
    * Retrieve all the business processes data for a specified filter. 
    *
    * @param {*} filter
    *   @requires filter.modelId The model id to call
    *   @requires filter.cacheFile The name of the file where the data will be stored
    * @param {boolean} [useCache=true] 
    */
   async buildBusinessProcessesContent(filter = {}, useCache = true) {

      // Instantiate out business solution class
      const businessProcess = new BusinessProcessClass(this.settings);

      // Retrieve the data from the Business Solution roadmap
      let data = await this.retrieve(filter.modelId, filter.cacheFile, useCache)
      
      // Retrieve the underlying model data
      if (data != null) {

         // Build Top Level Folder
         let businessProcessInventoryPath = path.join(this.settings.contentfolder);
         if (!fs.existsSync(businessProcessInventoryPath)) {
            fs.mkdirSync(businessProcessInventoryPath, { recursive: true });
         }   
         // Build the inventory (.home.md) for the L0 top model directly into the
         // content root. Its L1 children get their own folders below.
         await businessProcess.buildBusinessProcessContent(filter.modelId, businessProcessInventoryPath, useCache);

         // Process the L1 child objects to create their content. Each
         // retrieveBusinessProcessContent call builds a folder named after the
         // L1 model itself (e.g. "L1 Plan") and recurses into its decomposition.
         for (const [key, value] of Object.entries(data.modelObjects)) {
            // Only follow EPC sub-process links (skip grouping objects with no model).
            if (businessProcess.isProcessAssignment(value.assignments[0])) {
               try {
                  await businessProcess.retrieveBusinessProcessContent(value.assignments[0].model, businessProcessInventoryPath, useCache);
               } catch (error) {
                  console.error(error)
                  console.error('Business Process Data error:', value.assignments[0].model);
               }
            };
         }
      }
   }

}

module.exports = BusinessProcessesClass;