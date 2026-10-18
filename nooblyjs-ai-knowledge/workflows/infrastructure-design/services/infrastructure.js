/**
 * @fileoverview Retrieve a single infrastructure model from ARIS and build its
 * content. This is the per-model service for the infrastructure-design project;
 * it mirrors solution-design/businessSolution.js and
 * business-design/businessProcess.js but sources from the technology
 * classification models (Type 21 "Application system type diagram"). All the
 * shared ARIS "sourcing" behaviour (model fetch, graphic fetch, caching,
 * object inspection, markdown helpers) is inherited from
 * common/architecture/models/architectureModel.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

// External classes
const fs = require('node:fs');
const path = require('node:path');

// Shared architecture layer (ARIS API calls + object inspection + markdown)
const ArchitectureModel = require('../../common/architecture/models/architectureModel.js');
const GraphicClass = require('../../common/architecture/models/graphic.js');
const fileUtils = require('../../common/architecture/filesystem/filesystem.js');

// ARIS model "Type" code of an infrastructure model. The technology
// classification models ("Acme Technology Classification" and each of the
// technology-area models it references — Portal, Storage Area Network, …) are
// all "Application system type diagram" models, Type '21'. Verified against
// the cached inventory: every model its assignments lead to is Type 21. Used
// to decide whether a retrieved model is one this project should walk/build
// (Type 16 application collaboration / access diagrams linked off the same
// objects are skipped).
const INFRASTRUCTURE_MODEL_TYPE = '21';

// The assignment "type" label that links an object to its child infrastructure
// model (the equivalent of 'EPC' for business processes). Technology
// classification objects assign out to their technology-area model with the
// label of the target model's type: 'Application system type diagram'.
// Filtering on this BEFORE retrieving the child avoids fetching models we'd
// only discard (access diagrams, collaboration diagrams, org charts, …).
const INFRASTRUCTURE_ASSIGNMENT_TYPE = 'Application system type diagram';

// How many levels below the entry model the walk drills into. The cycle guard
// (`visited`) makes deep recursion safe; this only bounds "how far down".
const MAX_DEPTH = 2;

/**
 * Sources and builds a single infrastructure model.
 * @class
 * @extends ArchitectureModel
 */
class InfrastructureClass extends ArchitectureModel {

   /**
    * @param {Object} settings - The data passed from the parent thread
    * @param {string} settings.server - The ARIS server to call
    * @param {string} settings.database - The ARIS database
    * @param {string} settings.token - The token received from the auth token call
    * @param {string} settings.datafolder - Where retrieved data is cached
    * @param {string} settings.contentfolder - Where content is written
    */
   constructor(settings) {
      super(settings);
      this.settings = settings;
   }

   /**
    * True when a retrieved model is an infrastructure model.
    * @param {object} data - A model returned by retrieve()
    * @returns {boolean}
    */
   isInfrastructureModel(data) {
      return this.isModelType(data, INFRASTRUCTURE_MODEL_TYPE);
   }

   /**
    * True when an assignment links to a child infrastructure model.
    * @param {object} assignment - An entry from an object's assignments[]
    * @returns {boolean}
    */
   isInfrastructureAssignment(assignment) {
      return this.assignmentIsType(assignment, INFRASTRUCTURE_ASSIGNMENT_TYPE);
   }

   /**
    * Retrieve and cache all data (model JSON + graphic) for an infrastructure
    * model and its descendants, so the content build finds them warm in cache.
    * Mirrors businessProcess.retrieveBusinessProcessData.
    * @param {string} model - The model id
    * @param {boolean} useCache - Bypass the cache when false
    * @param {Set<string>} [visited] - Models already processed on this walk
    * @param {number} [depth] - Levels below the entry model
    */
   async retrieveInfrastructureData(model, useCache = true, visited = new Set(), depth = 0) {

      // Cycle / self-reference guard (see businessProcess.js for the rationale).
      if (model == null || visited.has(model)) {
         return;
      }
      visited.add(model);

      // Retrieve this model; only walk infrastructure models (Type 21
      // technology classification diagrams) — other types (e.g. Type 16
      // application diagrams) are not part of the classification, so stop here.
      const result = await this.retrieve(model, useCache);
      if (!result || !result.modelObjects || !this.isInfrastructureModel(result)) {
         return;
      }

      // Cache this model's graphic.
      const graphic = new GraphicClass(this.settings);
      try {
         await graphic.retrievePNGDataCached(model, useCache);
      } catch (error) {
         console.log(error);
         console.error('Error retrieving graphic for model ' + model);
      }

      if (depth >= MAX_DEPTH) {
         return;
      }

      // Recurse into child infrastructure models.
      for (const key in result.modelObjects) {
         const modelObject = result.modelObjects[key];
         for (let i = 0; i < modelObject.assignments.length; i++) {
            const assignment = modelObject.assignments[i];
            const assignedModel = assignment.model;

            // Only follow infrastructure links (skip access / collaboration /
            // org-chart assignments entirely — no wasted retrieve) and never
            // revisit a model (cycle / self-reference safety; the technology
            // classification models frequently self-link).
            if (!this.isInfrastructureAssignment(assignment) || !assignedModel
               || assignedModel == model || visited.has(assignedModel)) {
               continue;
            }

            try {
               await this.retrieveInfrastructureData(assignedModel, useCache, visited, depth + 1);
            } catch (error) {
               console.log(error);
               console.error('Error retrieving data for object ' + key);
            }
         }
      }
   }

   /**
    * Recursively build content for an infrastructure model and every
    * descendant, mirroring the model hierarchy as nested folders. Each model
    * gets a folder named after the model's OWN name (not the parent object's
    * name — 16 of the 70 technology areas are named differently on the
    * inventory object than on the model itself), with its .home.md inside and
    * any child models nested below. Mirrors
    * businessProcess.retrieveBusinessProcessContent.
    * @param {string} model - The model id
    * @param {string} parentFolder - The folder this model's folder is created in
    * @param {boolean} useCache - Reuse the cache for settled models when true
    * @param {Set<string>} [visited] - Models already processed on this walk
    * @param {number} [depth] - Levels below the entry model
    */
   async retrieveInfrastructureContent(model, parentFolder, useCache = true, visited = new Set(), depth = 0) {

      // Cycle / self-reference guard (one Set per top-level call).
      if (model == null || visited.has(model)) {
         return;
      }
      visited.add(model);

      // Retrieve this model. Only build & follow infrastructure models.
      const result = await this.retrieve(model, useCache);
      if (!result || !result.modelObjects || !this.isInfrastructureModel(result)) {
         return;
      }

      // Build THIS model's own folder, named after the model itself, and write
      // its .home.md there — keeping the wiki tree aligned with the ARIS model
      // hierarchy (naming folders after the parent's objects instead would
      // rename 16 of the technology areas).
      const folder = path.join(parentFolder, fileUtils.sanitizeFilename(result.attributes.Name));
      await this.buildInfrastructureContent(model, folder, useCache);

      // Drill into this model's child infrastructure models, each nested under
      // this model's folder. Stop once we've gone MAX_DEPTH levels down.
      if (depth >= MAX_DEPTH) {
         return;
      }

      for (const key in result.modelObjects) {
         const modelObject = result.modelObjects[key];
         for (let i = 0; i < modelObject.assignments.length; i++) {
            const assignment = modelObject.assignments[i];
            const assignedModel = assignment.model;

            // Only follow infrastructure links; never revisit a model.
            if (!this.isInfrastructureAssignment(assignment) || !assignedModel
               || assignedModel == model || visited.has(assignedModel)) {
               continue;
            }

            try {
               await this.retrieveInfrastructureContent(assignedModel, folder, useCache, visited, depth + 1);
            } catch (error) {
               console.log(error);
               console.error('Error building content for object ' + key);
            }
         }
      }
   }

   /**
    * Build the [field, value] property rows for one object: its symbol shown as
    * "Category", then each attribute (minus housekeeping keys), sorted.
    * @param {object} object - A formatted model object
    * @returns {Array<string[]>}
    */
   objectPropertyRows(object) {
      const attrs = object.attributes || {};
      const excluded = new Set(['Name', 'Type', 'kind', 'guid', 'Time of generation', 'Creator', 'Last change', 'Last user', 'ModelQA']);
      const rows = [['Category', this.field(object.symbol)]];
      Object.entries(attrs)
         .filter(([key]) => !excluded.has(key))
         .sort(([a], [b]) => a.localeCompare(b))
         .forEach(([key, value]) => rows.push([key, this.field(value)]));
      return rows;
   }

   /**
    * Build the [relationship, related object] rows for one object from its
    * connections — the party at the other end of each connection (the one that
    * is not this object). De-duplicated, since a connection is recorded on both
    * of its endpoints.
    * @param {object} object - A formatted model object
    * @returns {Array<string[]>}
    */
   objectConnectionRows(object) {
      const rows = [];
      const seen = new Set();
      for (const connection of object.connections || []) {
         const other = connection.srcmodel === object.guid
            ? connection.targetmodelname
            : connection.srcmodelname;
         const key = `${connection.type}::${other}`;
         if (seen.has(key)) {
            continue;
         }
         seen.add(key);
         rows.push([connection.type, this.field(other)]);
      }
      return rows;
   }

   /**
    * Build one accordion-item body for an object: a Properties table and, when
    * the object is connected to others, a Connections table. Section captions are
    * bold text (not `##`) so the accordion parser does not read them as new item
    * titles.
    * @param {object} object - A formatted model object
    * @returns {string}
    */
   buildObjectDetails(object) {
      const parts = [
         '**Properties**\n\n' + this.buildTable(['Field', 'Value'], this.objectPropertyRows(object)),
      ];
      const connections = this.objectConnectionRows(object);
      if (connections.length > 0) {
         parts.push('**Connections**\n\n' + this.buildTable(['Relationship', 'Related Object'], connections));
      }
      return parts.join('\n\n');
   }

   /**
    * Build the content (.home.md: title + graphic + model attributes + an
    * accordion of the model's objects, each collapsible item showing that
    * object's attributes and connections). Uses the inherited markdown helpers
    * (field/buildTable/objectTitle/buildAccordion) from ArchitectureModel.
    * Mirrors businessProcess.buildBusinessProcessContent.
    * @param {string} model - The model id
    * @param {string} folder - The folder to write the content into
    * @param {boolean} useCache - Bypass the cache when false
    */
   async buildInfrastructureContent(model, folder, useCache = true) {
      try {
         const data = await this.retrieve(model, useCache);
         if (data == null || data.attributes == null) {
            return;
         }

         const graphic = new GraphicClass(this.settings);
         const base64Png = await graphic.retrievePNGDataCached(model, useCache);

         const parts = [
            `# ${data.attributes['Name']}`,
            `![${data.attributes.Name}](data:image/png;base64,${base64Png})`,
         ];

         // Model-level attributes table (skip housekeeping keys).
         const excluded = new Set(['Name', 'Type', 'kind', 'guid', 'Time of generation', 'Creator', 'Last change', 'Last user', 'ModelQA']);
         const modelAttrs = Object.entries(data.attributes || {})
            .filter(([key]) => !excluded.has(key))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, this.field(value)]);

         if (modelAttrs.length > 0) {
            parts.push(`## Attributes`);
            parts.push(this.buildTable(['Field', 'Value'], modelAttrs));
         }

         // Each object becomes one collapsible accordion item showing all of its
         // attributes (Properties) and connections (Connections) — mirroring the
         // integration / business-solution content.
         const objects = Object.values(data.modelObjects || {});
         if (objects.length > 0) {
            parts.push(`## Objects`);
            const items = objects.map((object) => ({
               title: this.objectTitle(object, 'Infrastructure'),
               body: this.buildObjectDetails(object),
            }));
            parts.push(this.buildAccordion(items));
         }

         if (!fs.existsSync(folder)) {
            fs.mkdirSync(folder, { recursive: true });
         }
         fileUtils.writeFile(path.join(folder, `.home.md`), parts.join('\n\n') + '\n');
         console.log('Content built for model ' + model);

      } catch (error) {
         console.error('Error building content for model ' + model + ': ' + error);
      }
   }
}

module.exports = InfrastructureClass;
