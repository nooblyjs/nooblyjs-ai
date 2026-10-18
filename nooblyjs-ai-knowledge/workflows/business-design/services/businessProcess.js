/**
 * @fileoverview Retrieve a business process from the entry model
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
const ArchitectureModel = require('../../common/architecture/models/architectureModel.js');
const GraphicClass = require('../../common/architecture/models/graphic.js');
const fileUtils = require('../../common/architecture/filesystem/filesystem.js');

// ARIS model "Type" of a business-process model (the L1–L5 process
// decomposition). The traversal only walks these; other types — e.g. Type 16
// application / CRUD / context diagrams linked off a process — are skipped.
const PROCESS_MODEL_TYPE = '13';

// The assignment "type" label that links a process object to its sub-process
// model. Process decompositions are always linked as "EPC" (event-driven
// process chains); other assignment labels (e.g. "Access diagram",
// "Application collaboration diagram") point at non-process models. Filtering
// on this BEFORE retrieving the child avoids fetching models we'd only discard.
const PROCESS_ASSIGNMENT_TYPE = 'EPC';

// How many sub-process levels below the entry model (an L1 value chain) the
// content build drills into. The entry level (L1) is depth 0; each EPC child is
// one deeper. 1 → also build the L1's direct EPC sub-processes (L2) as nested
// folders, then stop. Bump this to go deeper (L3, L4 …); the cycle-guard
// `visited` Set already makes full recursion safe, so this is purely a "how far
// down" control, not a safety limit.
const MAX_SUBPROCESS_DEPTH = 5;

// The ARIS object "Type" of an application/solution object. These appear inside
// process models as the systems supporting a process, but this workflow is not
// where an application is documented — solution-design builds the full profile.
// Matched on the formatted object's `type` (see modelBase.formatModel), same as
// solution-design's INVENTORY_CATEGORIES.
const APPLICATION_OBJECT_TYPE = 'Application system type';

// The only fields written for an application object. Dumping its ~150 raw
// attributes plus assignment and relationship tables into every process page it
// appears on drowned the process content in the search index — the same
// application repeated verbatim across dozens of L2/L3 pages outweighed the
// process text those pages exist for. Name (the heading) + these three is
// enough to say which system supports the process and who owns it; the detail
// lives in the solution-design content. Each `[label, attribute key]` pair
// becomes one row, in this order, and only when the object carries the key.
const APPLICATION_SUMMARY_FIELDS = [
   ['Description', 'Description/Definition'],
   ['Short Description', 'Short description'],
   ['Business Owner', 'Business Owner'],
];

/**
 * This class processes a business process and manages the inventory of business processes
 * 
 * @method retrieve - Retrieve a class json from the architecture modeling tool and returns the data
 * @method retrieveBusinessProcessData - Retrieve all the business processes data for a specified filter.
 */
class BusinessProcessClass extends ArchitectureModel {

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
    * True when a retrieved model is a business-process model (Type 13). Other
    * model types (e.g. Type 16 application/CRUD/context diagrams) are not part
    * of the process decomposition and are skipped by the traversal.
    * @param {object} data - A model returned by retrieve()
    * @returns {boolean}
    */
   isProcessModel(data) {
      return this.isModelType(data, PROCESS_MODEL_TYPE);
   }

   /**
    * True when an assignment links to a sub-process model (labelled "EPC").
    * Lets us skip non-process links (application/CRUD/context diagrams) without
    * a wasted retrieve. `isProcessModel` remains the authority once retrieved.
    * @param {object} assignment - An entry from an object's assignments[]
    * @returns {boolean}
    */
   isProcessAssignment(assignment) {
      return this.assignmentIsType(assignment, PROCESS_ASSIGNMENT_TYPE);
   }

   /**
    * Retrieve and cache all data (model JSON + graphic) for a business process
    * roadmap and its sub-process descendants, so the content build finds them
    * warm in the cache instead of fetching on demand.
    * @param {string} roadmap - The roadmap model id
    * @param {boolean} useCache - Bypass the cache when true
    * @param {Set<string>} [visited] - Models already processed on this walk
    * @param {number} [depth] - Levels below the entry model (L1 = 0); drilling
    *   into children stops once depth reaches MAX_SUBPROCESS_DEPTH
    */
   async retrieveBusinessProcessData(roadmap, useCache = true, visited = new Set(), depth = 0) {

      // Guard against circular object references. Models can link back to a
      // model already on the current traversal path (A → B → A, or a self
      // link); without remembering what we've already walked, the recursion
      // below would never terminate. `visited` is shared across the whole
      // recursive walk (one Set per top-level call), so each model is
      // processed at most once.
      if (roadmap == null || visited.has(roadmap)) {
         return;
      }
      visited.add(roadmap);

      // Retrieve the data for this model. Only walk business-process models
      // (Type 13); other types (e.g. Type 16 application diagrams) are not part
      // of the process decomposition, so stop here.
      const result = await this.retrieve(roadmap, useCache);
      if (!result || !result.modelObjects || !this.isProcessModel(result)) {
         return;
      }

      // Cache this model's graphic, then recurse into its sub-process children.
      const graphic = new GraphicClass(this.settings);
      try {
         await graphic.retrievePNGDataCached(roadmap, useCache);
      } catch (error) {
         console.log(error);
         console.error("Error retrieving graphic for model " + roadmap);
      }

      // Pre-cache the EPC sub-process children too, to the same depth the
      // content build walks (MAX_SUBPROCESS_DEPTH). Stop once we've gone that
      // many levels below the entry model.
      if (depth >= MAX_SUBPROCESS_DEPTH) {
         return;
      }

      for (const key in result.modelObjects) {
         const modelObject = result.modelObjects[key];
         for (let i = 0; i < modelObject.assignments.length; i++) {
            const assignment = modelObject.assignments[i];
            const assignedModel = assignment.model;

            // Only follow EPC sub-process links (skip application/CRUD/context
            // diagram assignments entirely — no wasted retrieve) and never
            // revisit a model (cycle / self-reference safety).
            if (!this.isProcessAssignment(assignment) || !assignedModel
               || assignedModel == roadmap || visited.has(assignedModel)) {
               continue;
            }

            try {
               await this.retrieveBusinessProcessData(assignedModel, useCache, visited, depth + 1);
            } catch (error) {
               console.log(error)
               console.error("Error retrieving data for object " + key + " with name " + modelObject.attributes.Name);
            }
         }
      }
   }

   /**
    * Recursively build content for a business process roadmap and every
    * descendant model, mirroring the model hierarchy as nested folders.
    * @param {string} roadmap - The roadmap model id
    * @param {string} folder - The folder this level's content is written under
    * @param {boolean} useCache - Reuse the cache for settled models when true
    * @param {Set<string>} [visited] - Models already processed on this walk
    * @param {number} [depth] - Levels below the entry model (L1 = 0); drilling
    *   into children stops once depth reaches MAX_SUBPROCESS_DEPTH
    */
   async retrieveBusinessProcessContent(roadmap, parentFolder, useCache = true, visited = new Set(), depth = 0) {

      // Guard against circular object references (see retrieveBusinessProcessData):
      // a model can link back to one already on the path, which would recurse
      // forever. One Set per top-level call; each model is processed at most once.
      if (roadmap == null || visited.has(roadmap)) {
         return;
      }
      visited.add(roadmap);

      // Retrieve this model. Only build & follow business-process models
      // (Type 13); skip other types (e.g. Type 16 application diagrams).
      const result = await this.retrieve(roadmap, useCache);
      if (!result || !result.modelObjects || !this.isProcessModel(result)) {
         return;
      }

      // Build THIS model's own folder, named after the model itself (e.g.
      // "L1 Manage Financial Services"), and write its .home.md there. Naming
      // the folder after the model — not after the parent's object — keeps the
      // wiki tree aligned with the ARIS model hierarchy (L0 → L1 → L2 …); the
      // previous version named folders after a model's children, which dropped
      // the L1 level so an L2 like "Manage K'nect" surfaced at the top.
      const folder = path.join(parentFolder, fileUtils.sanitizeFilename(result.attributes.Name));
      await this.buildBusinessProcessContent(roadmap, folder, useCache);

      // Drill into this model's EPC sub-process children, building each as a
      // folder + .home.md nested under THIS model's folder (so an L1's L2
      // sub-processes sit alongside the L1's own .home.md). Stop once we've
      // gone MAX_SUBPROCESS_DEPTH levels below the entry model.
      if (depth >= MAX_SUBPROCESS_DEPTH) {
         return;
      }

      for (const key in result.modelObjects) {
         const modelObject = result.modelObjects[key];
         for (let i = 0; i < modelObject.assignments.length; i++) {
            const assignment = modelObject.assignments[i];
            const assignedModel = assignment.model;

            // Only follow EPC sub-process links; skip non-process assignments
            // (no wasted retrieve) and never revisit a model (cycle safety).
            if (!this.isProcessAssignment(assignment) || !assignedModel
               || assignedModel == roadmap || visited.has(assignedModel)) {
               continue;
            }

            try {
               await this.retrieveBusinessProcessContent(assignedModel, folder, useCache, visited, depth + 1);
            } catch (error) {
               console.log(error)
               console.error("Error retrieving content for object " + key + " with name " + modelObject.attributes.Name);
            }
         }
      }
   }

   /**
    * Get the title for a process object (Name or symbol, falling back to
    * "Process"). The generic Name/symbol logic lives in the shared markdown
    * helper; this override just supplies the process-specific fallback.
    * @param {object} object - A model object
    * @returns {string}
    */
   objectTitle(object) {
      return super.objectTitle(object, 'Process');
   }

   /**
    * True when a model object is an application/solution object, which is
    * summarised rather than documented in full (see APPLICATION_SUMMARY_FIELDS).
    * @param {object} object - A model object
    * @returns {boolean}
    */
   isApplicationObject(object) {
      return !!object && object.type === APPLICATION_OBJECT_TYPE;
   }

   /**
    * Build the summary rows for an application object — only the
    * APPLICATION_SUMMARY_FIELDS keys the object actually carries, in that order.
    * An object with none of them yields no rows, and so renders as its heading
    * alone.
    * @param {object} object - A model object
    * @returns {Array<string[]>}
    */
   applicationSummaryRows(object) {
      const attrs = object.attributes || {};

      const rows = [];
      for (const [label, key] of APPLICATION_SUMMARY_FIELDS) {
         if (key in attrs) {
            rows.push([label, this.field(attrs[key])]);
         }
      }
      return rows;
   }

   /**
    * Build property rows for an object's attributes.
    * @param {object} object - A model object
    * @returns {Array<string[]>}
    */
   objectPropertyRows(object) {
      const attrs = object.attributes || {};
      const excludeKeys = new Set(['Name', 'Type', 'kind', 'guid', 'Time of generation', 'Creator', 'Last change', 'Last user', 'ModelQA']);

      const rows = [];
      for (const [key, value] of Object.entries(attrs)) {
         if (!excludeKeys.has(key)) {
            rows.push([key, this.field(value)]);
         }
      }
      return rows.sort(([a], [b]) => a.localeCompare(b));
   }

   /**
    * Build assignment rows (links to sub-models).
    * @param {object} object - A model object
    * @returns {Array<string[]>}
    */
   objectAssignmentRows(object) {
      const rows = [];
      for (const assignment of object.assignments || []) {
         rows.push([
            this.field(assignment.name),
            this.field(assignment.type),
            this.field(assignment.model),
         ]);
      }
      return rows;
   }

   /**
    * Build connection rows (relationships to other objects).
    * @param {object} object - A model object
    * @returns {Array<string[]>}
    */
   objectConnectionRows(object) {
      const rows = [];
      const seen = new Set();
      for (const connection of object.connections || []) {
         const key = `${connection.type}::${connection.targetmodelname || connection.srcmodelname}`;
         if (!seen.has(key)) {
            seen.add(key);
            rows.push([
               this.field(connection.type),
               this.field(connection.targetmodelname || connection.srcmodelname),
            ]);
         }
      }
      return rows;
   }

   /**
    * Build the business process content for the business processes page.
    * Walks through all objects in the model and creates detailed documentation.
    * @param {string} model - The roadmap model id
    * @param {string} folder - The folder to store the content in
    * @param {boolean} useCache - Bypass the cache when true
    */
   async buildBusinessProcessContent(model, folder, useCache = true) {
      try {

         // Retrieve the data for the model
         const data = await this.retrieve(model, useCache);

         // Retrieve the PNG for the model
         const graphic = new GraphicClass(this.settings);
         const base64Png = await graphic.retrievePNGDataCached(model, useCache);

         // Start with title and graphic
         const parts = [
            `# ${data.attributes["Name"]}`,
            `![${data.attributes.Name}](data:image/png;base64,${base64Png})`,
         ];

         // Add model-level attributes if any
         const modelAttrs = Object.entries(data.attributes || {})
            .filter(([key]) => !new Set(['Name', 'Type', 'kind', 'guid', 'Time of generation', 'Creator', 'Last change', 'Last user', 'ModelQA']).has(key))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, this.field(value)]);

         if (modelAttrs.length > 0) {
            parts.push(`## Model Attributes`);
            parts.push(this.buildTable(['Field', 'Value'], modelAttrs));
         } else {
            parts.push(`_No model attributes found._`);
         }

         // Process all objects in the model
         const objects = Object.values(data.modelObjects || {});
         if (objects.length > 0) {
            parts.push(`## Processes`);

            for (const object of objects) {
               const title = this.objectTitle(object);
               parts.push(`### ${title}`);

               // Application objects get their name (the heading above) and at
               // most three fields — no symbol, properties, assignment or
               // relationship tables. See APPLICATION_SUMMARY_FIELDS for why.
               if (this.isApplicationObject(object)) {
                  const summaryRows = this.applicationSummaryRows(object);
                  if (summaryRows.length > 0) {
                     parts.push(this.buildTable(['Field', 'Value'], summaryRows));
                  }
                  parts.push('');
                  continue;
               }

               // Show object type/symbol
               if (object.symbol) {
                  parts.push(`**Type:** ${this.field(object.symbol)}`);
               }

               // Show object properties
               const propRows = this.objectPropertyRows(object);
               if (propRows.length > 0) {
                  parts.push(`**Properties**`);
                  parts.push(this.buildTable(['Field', 'Value'], propRows));
               } else {
                  parts.push(`_No properties found._`);
               }

               // Show assignments (sub-processes)
               const assignRows = this.objectAssignmentRows(object);
               if (assignRows.length > 0) {
                  parts.push(`**Sub-Processes**`);
                  parts.push(this.buildTable(['Name', 'Type', 'Model ID'], assignRows));
               } else {
                  parts.push(`_No assignments found._`);
               }

               // Show connections
               const connRows = this.objectConnectionRows(object);
               if (connRows.length > 0) {
                  parts.push(`**Relationships**`);
                  parts.push(this.buildTable(['Relationship', 'Related Object'], connRows));
               } else {
                  parts.push(`_No relationships found._`);
               }

               parts.push('');
            }
         }

         // Write the content for the model
         const content = parts.join('\n\n') + '\n';
         if (model == 'd496ce00-1ef4-11de-7d4f-000c29300558'){
            fileUtils.writeFile(path.join(folder, `.home.md`), content);
         }
         else { 
            fileUtils.writeFile(path.join(folder, fileUtils.sanitizeFilename(`${data.attributes["Name"]}.md`)), content);         
         }
         
         console.log("Content built for model " + path.join(folder, fileUtils.sanitizeFilename(`${data.attributes["Name"]}.md`)));

      } catch (error) {
         console.error("Error building content for model " + model + ": " + error);
      }
   }

}

module.exports = BusinessProcessClass;