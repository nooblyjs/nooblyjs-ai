/**
 * @fileoverview Manage the inventory of infrastructure models. This is the
 * inventory service for the infrastructure-design project; it mirrors
 * solution-design/businessSolutions.js and
 * business-design/businessProcesses.js. The "fetch one inventory model by id
 * and cache it" behaviour is inherited from common/architecture/models/inventory.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

// External classes
const fs = require('node:fs');
const path = require('node:path');

// Shared architecture layer
const Inventory = require('../../common/architecture/models/inventory.js');
const fileUtils = require('../../common/architecture/filesystem/filesystem.js');

// The per-model infrastructure service
const InfrastructureClass = require('./infrastructure.js');

// The ARIS model id of the infrastructure inventory: "Acme Technology
// Classification" (Type 21), whose objects assign out to the individual
// technology-area models (Portal, Storage Area Network, …). Compare with
// businessProcesses.js ('d496ce00-1ef4-11de-7d4f-000c29300558') and
// businessSolutions.js ('4688ca40-e7ec-11eb-2b0b-000d3aae822d').
const INVENTORY_MODEL_ID = '1743f770-ca32-11df-4177-005056a175bf';

// The cache file the inventory is written to under <datafolder>/cache.
const INVENTORY_CACHE_FILE = 'infrastructureInventory.json';

// The connection "type" that expresses the diagram's visual grouping: each
// teal group block (Enterprise Business Technologies, Observability, …)
// "encompasses" the grey technology-area objects drawn inside it. These are
// the ONLY connections on the inventory model (85 unique edges, connection
// attribute Type 155). The content build turns this grouping into the folder
// hierarchy: <group>/<technology area>/.home.md.
const GROUPING_CONNECTION_TYPE = 'encompasses';

/**
 * Manages the infrastructure inventory.
 * @class
 * @extends Inventory
 */
class InfrastructuresClass extends Inventory {

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
    * Retrieve the infrastructure inventory model and cache it.
    * @param {boolean} useCache - Bypass the cache when false
    * @returns {Promise<object>} The inventory model data
    */
   async retrieve(useCache = true) {
      return super.retrieveInventory(INVENTORY_MODEL_ID, INVENTORY_CACHE_FILE, useCache);
   }

   /**
    * Retrieve and cache the data (model JSON + graphic) for every infrastructure
    * model referenced by the inventory. Mirrors
    * businessProcesses.retrieveBusinessProcessesData.
    * @param {*} filter - Reserved for future filtering (unused)
    * @param {boolean} useCache - Bypass the cache when false
    */
   async retrieveInfrastructuresData(filter = {}, useCache = true) {

      const infrastructure = new InfrastructureClass(this.settings);

      const data = await this.retrieve(useCache);
      if (data == null) {
         return;
      }

      for (const [key, value] of Object.entries(data.modelObjects)) {
         // Only follow infrastructure links (each technology area is an
         // 'Application system type diagram' assignment); grouping objects and
         // access/collaboration links are skipped without a wasted retrieve.
         if (value.assignments && value.assignments.length > 0
            && infrastructure.isInfrastructureAssignment(value.assignments[0])) {
            try {
               await infrastructure.retrieveInfrastructureData(value.assignments[0].model, useCache);
            } catch (error) {
               console.error(error);
               console.error('Infrastructure data error:', value.assignments[0].model);
            }
         }
      }
   }

   /**
    * Build the content: the inventory's own .home.md (its graphic + attributes +
    * objects accordion) at the content root, then a folder per group block
    * (from the inventory's 'encompasses' connections) with each grouped
    * technology-area model's content nested inside it — so the folder tree
    * mirrors the diagram: root → Enterprise Business Technologies → Customer
    * Engagement → .home.md.
    * @param {*} filter - Reserved for future filtering (unused)
    * @param {boolean} useCache - Bypass the cache when false
    */
   async buildInfrastructuresContent(filter = {}, useCache = true) {

      const infrastructure = new InfrastructureClass(this.settings);

      const data = await this.retrieve(useCache);
      if (data == null) {
         return;
      }

      // Top-level content folder.
      const root = path.join(this.settings.contentfolder);
      if (!fs.existsSync(root)) {
         fs.mkdirSync(root, { recursive: true });
      }

      // The grouping forest expressed by the inventory's 'encompasses'
      // connections: each teal group block encompasses the grey technology-area
      // objects drawn inside it. It shapes both the inventory's own .home.md
      // (an accordion item per group) and the folder tree below it.
      const forest = this.buildGroupingForest(data);

      // Build the inventory's own .home.md (its graphic + attributes + a
      // grouped objects accordion) directly into the content root — the
      // landing page for the whole inventory. Each referenced model gets its
      // own folder below.
      try {
         await this.buildInventoryHome(infrastructure, data, forest, root, useCache);
      } catch (error) {
         console.error(error);
         console.error('Infrastructure inventory home content error:', INVENTORY_MODEL_ID);
      }

      // Walk the grouping forest so the folder tree mirrors the diagram's
      // visual grouping: each teal group block becomes a folder (with a
      // .home.md holding its name + description), and the grey technology-area
      // models inside it become that folder's children. Ungrouped objects with
      // a model (e.g. "Security Information Event Management") land at the
      // content root.
      for (const guid of forest.roots) {
         await this.buildGroupNode(infrastructure, forest, guid, root, useCache);
      }
   }

   /**
    * Build the inventory's own .home.md: title + graphic + model attributes +
    * one accordion item per top-level group block (Enterprise Business
    * Technologies, Observability, …), each item detailing the grey
    * technology-area objects the group encompasses. The 'encompasses'
    * connections themselves are not shown — the grouping now expresses them.
    * The accordion parser reads any `##`-prefixed line as a new item title and
    * renders item bodies with plain marked (no nested custom blocks), so the
    * member captions inside a body are bold text, not headings.
    * @param {InfrastructureClass} infrastructure - The per-model service (markdown helpers)
    * @param {object} data - The retrieved inventory model
    * @param {{byGuid: Object, children: Object, roots: string[]}} forest - From buildGroupingForest
    * @param {string} folder - The content root the .home.md is written into
    * @param {boolean} useCache - Reuse the cache for settled models when true
    */
   async buildInventoryHome(infrastructure, data, forest, folder, useCache = true) {
      if (data == null || data.attributes == null) {
         return;
      }

      const base64Png = await infrastructure.retrieveGraphic(INVENTORY_MODEL_ID, useCache);

      const parts = [
         `# ${data.attributes['Name']}`,
         `![${data.attributes.Name}](data:image/png;base64,${base64Png})`,
      ];

      // Model-level attributes table (skip housekeeping keys).
      const excluded = new Set(['Name', 'Type', 'kind', 'guid', 'Time of generation', 'Creator', 'Last change', 'Last user', 'ModelQA']);
      const modelAttrs = Object.entries(data.attributes || {})
         .filter(([key]) => !excluded.has(key))
         .sort(([a], [b]) => a.localeCompare(b))
         .map(([key, value]) => [key, infrastructure.field(value)]);

      if (modelAttrs.length > 0) {
         parts.push(`## Attributes`);
         parts.push(infrastructure.buildTable(['Field', 'Value'], modelAttrs));
      }

      // One collapsible accordion item per top-level node of the grouping
      // forest: the group blocks with their members inside, plus any ungrouped
      // stand-alone objects with their own details.
      if (forest.roots.length > 0) {
         parts.push(`## Objects`);
         const items = forest.roots.map((guid) => ({
            title: infrastructure.objectTitle(forest.byGuid[guid], 'Infrastructure'),
            body: this.buildGroupAccordionBody(infrastructure, forest, guid),
         }));
         parts.push(infrastructure.buildAccordion(items));
      }

      if (!fs.existsSync(folder)) {
         fs.mkdirSync(folder, { recursive: true });
      }
      fileUtils.writeFile(path.join(folder, `.home.md`), parts.join('\n\n') + '\n');
      console.log('Content built for model ' + INVENTORY_MODEL_ID);
   }

   /**
    * Build one accordion-item body for a node of the grouping forest.
    * - A group: its description, then each member as a bold caption followed by
    *   that member's Properties table (recursing into nested sub-groups).
    * - An ungrouped stand-alone object: its own Properties table.
    * The objects' connections are all 'encompasses' links, already expressed by
    * the grouping itself, so no Connections tables are shown here.
    * @param {InfrastructureClass} infrastructure - The per-model service (markdown helpers)
    * @param {{byGuid: Object, children: Object}} forest - From buildGroupingForest
    * @param {string} guid - The forest node to render
    * @param {Set<string>} [visited] - Nodes already rendered (cycle safety)
    * @returns {string}
    */
   buildGroupAccordionBody(infrastructure, forest, guid, visited = new Set()) {
      if (visited.has(guid)) {
         return '';
      }
      visited.add(guid);

      const object = forest.byGuid[guid];
      const attributes = object.attributes || {};
      const members = forest.children[guid] || [];
      const parts = [];

      // Stand-alone object: show its full details.
      if (members.length === 0) {
         parts.push(infrastructure.buildTable(['Field', 'Value'], infrastructure.objectPropertyRows(object)));
         return parts.join('\n\n');
      }

      // Group: its description, then each member's caption + details.
      const description = attributes['Description/Definition'];
      if (description && String(description).trim()) {
         parts.push(String(description).trim());
      }

      for (const member of members) {
         const memberObject = forest.byGuid[member];
         parts.push(`**${infrastructure.objectTitle(memberObject, 'Infrastructure')}**`);
         if (forest.children[member]) {
            // Nested sub-group: recurse (description + its own members).
            parts.push(this.buildGroupAccordionBody(infrastructure, forest, member, visited));
         } else {
            const rows = infrastructure.objectPropertyRows(memberObject);
            if (rows.length > 0) {
               parts.push(infrastructure.buildTable(['Field', 'Value'], rows));
            }
         }
      }
      return parts.join('\n\n');
   }

   /**
    * Build the grouping forest from the inventory's 'encompasses' connections.
    * Connections are recorded on both endpoints, so edges are de-duplicated;
    * a handful of group↔member pairs were drawn in ARIS in BOTH directions, so
    * for a reciprocal pair the direction whose source has the higher out-degree
    * wins (the group encompasses many members; a member's backlink has
    * out-degree 1). Children and roots are name-sorted for deterministic output.
    * @param {object} data - The retrieved inventory model
    * @returns {{byGuid: Object, children: Object, roots: string[]}}
    */
   buildGroupingForest(data) {

      const objects = Object.values(data.modelObjects || {});
      const byGuid = {};
      for (const object of objects) {
         if (object.guid) {
            byGuid[object.guid] = object;
         }
      }
      const displayName = (guid) =>
         (((byGuid[guid].attributes || {}).Name) || guid).trim();

      // Unique directed grouping edges between objects on this model.
      const edges = new Set();
      for (const object of objects) {
         for (const connection of object.connections || []) {
            if (connection.type === GROUPING_CONNECTION_TYPE
               && byGuid[connection.srcmodel] && byGuid[connection.targetmodel]
               && connection.srcmodel !== connection.targetmodel) {
               edges.add(connection.srcmodel + '|' + connection.targetmodel);
            }
         }
      }

      // Out-degrees decide which direction of a double-drawn pair is the group.
      const outDegree = {};
      for (const edge of edges) {
         const src = edge.split('|')[0];
         outDegree[src] = (outDegree[src] || 0) + 1;
      }

      // children[group] = member guids; a member's reciprocal backlink is dropped.
      const children = {};
      const hasParent = new Set();
      for (const edge of edges) {
         const [src, target] = edge.split('|');
         if (edges.has(target + '|' + src) && (outDegree[target] || 0) > (outDegree[src] || 0)) {
            continue;
         }
         (children[src] = children[src] || []).push(target);
         hasParent.add(target);
      }
      for (const src of Object.keys(children)) {
         children[src].sort((a, b) => displayName(a).localeCompare(displayName(b)));
      }

      // Roots: every object nothing encompasses — the group blocks themselves
      // plus any ungrouped stand-alone objects.
      const roots = objects
         .map((object) => object.guid)
         .filter((guid) => guid && !hasParent.has(guid))
         .sort((a, b) => displayName(a).localeCompare(displayName(b)));

      return { byGuid, children, roots };
   }

   /**
    * Build the content for one node of the grouping forest.
    * - A group (has 'encompasses' children) becomes a folder named after the
    *   grouping object, holding a .home.md (its own model's content when it has
    *   one, else name + description) and its members nested inside.
    * - A leaf with a model builds that model's content folder (named after the
    *   model's OWN name) via retrieveInfrastructureContent.
    * - A leaf without a model has no content to build and is skipped.
    * @param {InfrastructureClass} infrastructure - The per-model service
    * @param {{byGuid: Object, children: Object}} forest - From buildGroupingForest
    * @param {string} guid - The inventory object to build
    * @param {string} parentFolder - The folder this node's content goes under
    * @param {boolean} useCache - Reuse the cache for settled models when true
    * @param {Set<string>} [visited] - Objects already built (cycle safety)
    */
   async buildGroupNode(infrastructure, forest, guid, parentFolder, useCache, visited = new Set()) {

      // Cycle guard — grouping edges come from hand-drawn connections.
      if (visited.has(guid)) {
         return;
      }
      visited.add(guid);

      const object = forest.byGuid[guid];
      const members = forest.children[guid] || [];
      const assignment = (object.assignments || [])[0];
      const hasModel = assignment && infrastructure.isInfrastructureAssignment(assignment);

      // Leaf: only members with a model produce content.
      if (members.length === 0) {
         if (hasModel) {
            try {
               await infrastructure.retrieveInfrastructureContent(assignment.model, parentFolder, useCache);
            } catch (error) {
               console.error(error);
               console.error('Infrastructure content error:', assignment.model);
            }
         }
         return;
      }

      // Group: folder named after the grouping object, members nested inside.
      const folder = path.join(parentFolder, fileUtils.sanitizeFilename((object.attributes || {}).Name || guid));
      try {
         if (hasModel) {
            await infrastructure.buildInfrastructureContent(assignment.model, folder, useCache);
         } else {
            this.buildGroupHome(object, folder);
         }
      } catch (error) {
         console.error(error);
         console.error('Infrastructure group content error:', guid);
      }

      for (const member of members) {
         await this.buildGroupNode(infrastructure, forest, member, folder, useCache, visited);
      }
   }

   /**
    * Write a minimal .home.md for a group folder from the grouping object's
    * own attributes: its name as the title plus its description, so the group
    * page shows the same text as the teal block on the diagram.
    * @param {object} object - The grouping model object
    * @param {string} folder - The group folder
    */
   buildGroupHome(object, folder) {
      const attributes = object.attributes || {};
      const parts = [`# ${(attributes.Name || '').trim()}`];
      const description = attributes['Description/Definition'];
      if (description && String(description).trim()) {
         parts.push(String(description).trim());
      }
      if (!fs.existsSync(folder)) {
         fs.mkdirSync(folder, { recursive: true });
      }
      fileUtils.writeFile(path.join(folder, `.home.md`), parts.join('\n\n') + '\n');
   }
}

module.exports = InfrastructuresClass;
