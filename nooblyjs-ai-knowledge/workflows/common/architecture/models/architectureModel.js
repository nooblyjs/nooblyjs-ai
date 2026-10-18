/**
 * @fileoverview ArchitectureModel — shared base for the per-model service
 * classes that source a single ARIS model by id (business solutions, business
 * processes, business landscapes, infrastructure, …).
 *
 * It centralises the ARIS "sourcing" primitives every architecture domain
 * repeats: fetching a model's JSON (cache-aware), fetching its graphic, and the
 * small object-inspection helpers used to decide whether a retrieved model — or
 * one of its assignments — is of a given ARIS type. Domain classes extend this
 * and add their own traversal + content-building on top.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const ModelBase = require('./modelBase');
const ModelClass = require('./model');
const GraphicClass = require('./graphic');
const markdown = require('../content-generation/markdown');

/**
 * Housekeeping attribute keys hidden when listing an object's own attributes in
 * a diagram-inventory accordion: the identity key (already the accordion
 * title), the modelling tool's bookkeeping fields, and the numeric Type code.
 */
const INVENTORY_NOISE_ATTRIBUTES = new Set([
    'Name', 'Type', 'kind', 'guid',
    'Time of generation', 'Creator', 'Last change', 'Last user', 'ModelQA',
]);

/**
 * Default groups a diagram's objects are collected into, in render order. Each
 * object joins the FIRST category whose `match` returns true; anything left over
 * lands in a trailing "Other Objects" group, so nothing is ever dropped.
 *
 * The order and the set of types are drawn from what the models ACTUALLY
 * contain, measured across both landscape corpora — because a group of 600
 * objects called "Other" is no more useful than no grouping at all:
 *
 *   Application Landscapes (77 models, 6,029 objects)
 *     Application system type 3228, Service type 685, Information carrier 602,
 *     Location 512, Capability 386, Hardware component type 323, then a tail.
 *   Reference Landscapes (35 models, 509 objects)
 *     Quick object 417, Structural element 92 — and NOTHING else. Neither type
 *     appears in the application corpus at all, so a list tuned only to the
 *     first workflow would file every single reference object under "Other".
 *     Both workflows run the same step, so both must be covered here.
 *
 * A domain that wants different groups passes its own list — see
 * {@link ArchitectureModel#buildInventoryAccordions}.
 */
const DEFAULT_INVENTORY_CATEGORIES = [
    { heading: 'Applications & Solutions', match: (object) => object.type === 'Application system type' },
    { heading: 'Capabilities', match: (object) => object.type === 'Capability' },
    { heading: 'Services', match: (object) => object.type === 'Service type' },
    { heading: 'Information Carriers', match: (object) => object.type === 'Information carrier' },
    { heading: 'Hardware Components', match: (object) => object.type === 'Hardware component type' },
    { heading: 'Locations & Subscriptions', match: (object) => object.type === 'Location' },
    { heading: 'Application Classes', match: (object) => object.type === 'Application system class' },
    // Reference-architecture shapes. Structural elements are the grouping nodes
    // ("Subscription Management"), so they precede the elements they group.
    { heading: 'Structural Elements', match: (object) => object.type === 'Structural element' },
    { heading: 'Reference Elements', match: (object) => object.type === 'Quick object' },
    { heading: 'Roles & Organisation', match: (object) => object.type === 'Role' || object.type === 'Organizational unit' },
    { heading: 'Functions & Processes', match: (object) => object.type === 'Function' || object.type === 'Process' },
    { heading: 'Data Objects', match: (object) => object.type === 'Class' || object.type === 'Cluster/Data model' },
    { heading: 'Products & Objectives', match: (object) => object.type === 'Product/Service' || object.type === 'Objective' },
    { heading: 'Requirements', match: (object) => object.type === 'Requirement' },
];

/**
 * Base class for a class that inspects one ARIS model at a time.
 * @class
 * @extends ModelBase
 */
class ArchitectureModel extends ModelBase {

    /**
     * @param {Object} settings - The data passed from the parent thread
     * @param {string} settings.server - The ARIS server to call
     * @param {string} settings.database - The ARIS database
     * @param {string} settings.token - The token received from the auth token call
     * @param {string} settings.datafolder - Where retrieved data is cached
     */
    constructor(settings) {
        super(settings);
        this.settings = settings;
    }

    /**
     * Retrieve a model's data and cache it.
     * @param {string} model - The model id (defaults to settings.model)
     * @param {boolean} useCache - Bypass the cache when true
     * @returns {object} The model data
     */
    async retrieve(model, useCache = true) {

        // If no model is passed, use the one from settings
        if (model == null) {
            model = this.settings.model;
        }

        // Instantiate the model class and retrieve the data
        const modelClass = new ModelClass(this.settings);

        // modelClass.retrieve already caches the model under its own id (and
        // returns the cached copy on a refetch failure), so there is nothing to
        // write here. Writing to settings.model — undefined in the content-build
        // path — would dump every retrieval into models/undefined.json.
        const data = await modelClass.retrieve(model, useCache);

        return data;
    }

    /**
     * Retrieve a model's graphic (base64 PNG data URI), disk-cached.
     * @param {string} model - The model id
     * @param {boolean} useCache - Reuse the cached image when true
     * @returns {Promise<string>} base64 PNG data URI
     */
    async retrieveGraphic(model, useCache = true) {
        const graphic = new GraphicClass(this.settings);
        return graphic.retrievePNGDataCached(model, useCache);
    }

    /**
     * True when a retrieved model is of the given ARIS "Type" code. ARIS reports
     * the model type as a numeric string in `attributes.Type` (e.g. "13" for a
     * business-process/EPC model, "16" for an application diagram); the compare
     * is string-based to match how formatModel stores it.
     * @param {object} data - A model returned by {@link retrieve}
     * @param {string|number} type - The ARIS model Type code
     * @returns {boolean}
     */
    isModelType(data, type) {
        return !!(data && data.attributes) && String(data.attributes.Type) === String(type);
    }

    /**
     * True when an object assignment links to a model of the given assignment
     * "type" label (e.g. "EPC" for a process decomposition). Lets a traversal
     * skip non-matching links without a wasted retrieve.
     * @param {object} assignment - An entry from an object's assignments[]
     * @param {string} type - The assignment type label
     * @returns {boolean}
     */
    assignmentIsType(assignment, type) {
        return !!assignment && assignment.type === type;
    }

    /**
     * Render a field value for a table cell, with a missing-value placeholder.
     * Thin instance wrapper over the shared markdown helper.
     * @param {*} value
     * @returns {string}
     */
    field(value) {
        return markdown.field(value);
    }

    /**
     * Build a GitHub-flavoured markdown table (first column bold, no trailing
     * newline). Thin instance wrapper over the shared markdown helper.
     * @param {string[]} headers - Column header cells
     * @param {Array<string[]>} rows - Row cells
     * @returns {string}
     */
    buildTable(headers, rows) {
        return markdown.buildTable(headers, rows);
    }

    /**
     * Get an object's display title (Name, else symbol, else fallback). Thin
     * instance wrapper over the shared markdown helper.
     * @param {object} object - A formatted model object
     * @param {string} [fallback='Object'] - Used when there is no Name or symbol
     * @returns {string}
     */
    objectTitle(object, fallback = 'Object') {
        return markdown.objectTitle(object, fallback);
    }

    /**
     * Indent a block of markdown to sit inside a custom block. Thin instance
     * wrapper over the shared markdown helper.
     * @param {string} text
     * @returns {string}
     */
    indentBlock(text) {
        return markdown.indentBlock(text);
    }

    /**
     * Build an `accordion` custom block of collapsible items. Thin instance
     * wrapper over the shared markdown helper.
     * @param {Array<{title:string, body:string}>} items
     * @param {number} [expandedIndex=0] - Index of the item that starts open
     * @returns {string}
     */
    buildAccordion(items, expandedIndex = 0) {
        return markdown.buildAccordion(items, expandedIndex);
    }

    // ─── Diagram inventory ────────────────────────────────────────────────
    //
    // A diagram page whose whole body is one image tells a reader nothing they
    // can search, and nothing the AI context builder can summarise: the objects,
    // their attributes and their relationships are all locked inside a PNG.
    // These helpers turn a retrieved model's `modelObjects` into a grouped set
    // of collapsible accordions underneath the image — the objects become real
    // markdown (indexed, searchable, summarisable) without pushing the diagram
    // itself off the top of the page.

    /**
     * Render a value for an inventory table cell. A missing value becomes a red
     * "Undefined" badge rather than an empty cell, so a gap in the source model
     * reads as a gap rather than as a rendering fault.
     * @param {*} value
     * @returns {string}
     */
    inventoryField(value) {
        if (value === undefined || value === null || String(value).trim() === '') {
            return '<span class="badge text-bg-danger kr-inline-badge">Undefined</span>';
        }
        // Every caller puts this in a markdown table cell, where an unescaped
        // pipe ends the cell and a newline ends the ROW — one such character in
        // a description would silently shear the rest of the table off the page.
        // Neither appears in the current corpus (0 of 262,199 attribute values),
        // which is exactly why it would go unnoticed when one finally does.
        return String(value).replace(/\r?\n|\r/g, ' ').replace(/\|/g, '\\|');
    }

    /**
     * The [field, value] rows describing one diagram object.
     *
     * `profileFields` curates the output for object types rich enough that
     * dumping every attribute would be unreadable: pass [[label, attributeKey], …]
     * and only those keys, when present, are shown. Without it the object lists
     * its own attributes minus {@link INVENTORY_NOISE_ATTRIBUTES}. The symbol is
     * always the first row, as "Category" — it is the most useful single fact
     * about an object and is not part of `attributes`.
     *
     * @param {object} object - A formatted model object
     * @param {Array<string[]>} [profileFields] - Curated [label, key] pairs
     * @returns {Array<string[]>}
     */
    inventoryPropertyRows(object, profileFields = null) {
        const attrs = (object && object.attributes) || {};
        const rows = [['Category', this.inventoryField(object && object.symbol)]];

        if (Array.isArray(profileFields) && profileFields.length > 0) {
            for (const [label, key] of profileFields) {
                if (key in attrs) rows.push([label, this.inventoryField(attrs[key])]);
            }
            return rows;
        }

        for (const [key, value] of Object.entries(attrs)) {
            if (INVENTORY_NOISE_ATTRIBUTES.has(key)) continue;
            rows.push([key, this.inventoryField(value)]);
        }
        return rows;
    }

    /**
     * The [relationship, related object] rows for one object — the party at the
     * far end of each of its connections.
     *
     * De-duplicated on type+counterparty, because a connection is recorded on
     * BOTH of its endpoints: without this, an object connected to the same
     * neighbour by two modelled directions lists it twice.
     *
     * @param {object} object - A formatted model object
     * @returns {Array<string[]>}
     */
    inventoryRelationshipRows(object) {
        const rows = [];
        const seen = new Set();
        for (const connection of (object && object.connections) || []) {
            const other = connection.srcmodel === object.guid
                ? connection.targetmodelname
                : connection.srcmodelname;
            const key = `${connection.type}::${other}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push([connection.type, this.inventoryField(other)]);
        }
        return rows;
    }

    /**
     * One accordion item's body: a Properties table and, when the object is
     * connected to anything, a Relationships table.
     *
     * Section captions are BOLD TEXT, never `##`. The accordion parser reads a
     * `##` line as the start of a new item, so a heading here would split one
     * object's body into two half-empty accordion entries.
     *
     * @param {object} object - A formatted model object
     * @param {Array<string[]>} [profileFields] - Curated [label, key] pairs
     * @returns {string}
     */
    inventoryObjectDetails(object, profileFields = null) {
        const parts = [
            '**Properties**\n\n' + this.buildTable(['Field', 'Value'], this.inventoryPropertyRows(object, profileFields)),
        ];
        const relationships = this.inventoryRelationshipRows(object);
        if (relationships.length > 0) {
            parts.push('**Relationships**\n\n' + this.buildTable(['Relationship', 'Related Object'], relationships));
        }
        return parts.join('\n\n');
    }

    /**
     * Collect a model's objects into ordered groups.
     *
     * Objects with the `Folder` symbol are dropped: they are layout containers
     * the modelling tool uses to arrange a canvas, not elements of the
     * architecture, and they carry no attributes worth listing.
     *
     * @param {object} data - A model returned by {@link retrieve}
     * @param {Object} [options]
     * @param {Array<{heading: string, match: function}>} [options.categories]
     * @param {function(object): boolean} [options.exclude] - Drop matching objects
     * @returns {Array<{heading: string, members: Array<object>}>}
     */
    groupInventoryObjects(data, options = {}) {
        const categories = options.categories || DEFAULT_INVENTORY_CATEGORIES;
        const exclude = typeof options.exclude === 'function' ? options.exclude : null;

        const objects = Object.values((data && data.modelObjects) || {})
            .filter((object) => object && object.symbol !== 'Folder')
            .filter((object) => !exclude || !exclude(object));

        const sections = [];
        const categorised = new Set();
        for (const category of categories) {
            const members = objects.filter((object) => category.match(object));
            members.forEach((object) => categorised.add(object));
            if (members.length > 0) sections.push({ heading: category.heading, members });
        }

        const others = objects.filter((object) => !categorised.has(object));
        if (others.length > 0) sections.push({ heading: 'Other Objects', members: others });

        return sections;
    }

    /**
     * Build the grouped accordion walk-through of a model's objects: a
     * `## <title> Details` heading, then a `### <group>` heading and one
     * accordion per group.
     *
     * Returns an EMPTY STRING when the model has no inventory objects, so a
     * caller can append it unconditionally and a diagram with nothing behind it
     * simply keeps its image and gains no empty scaffolding.
     *
     * @param {object} data - A model returned by {@link retrieve}
     * @param {Object} [options]
     * @param {string} [options.title='Landscape'] - Prefix for the details heading
     * @param {Array<{heading: string, match: function}>} [options.categories]
     * @param {function(object): boolean} [options.exclude]
     * @param {Array<string[]>} [options.profileFields] - Curated rows for rich objects
     * @param {function(object): Array<string[]>|null} [options.profileFieldsFor]
     *        Per-object curation, taking precedence over `profileFields`.
     * @returns {string} Markdown, or '' when there is nothing to show
     */
    buildInventoryAccordions(data, options = {}) {
        const sections = this.groupInventoryObjects(data, options);
        if (sections.length === 0) return '';

        const title = options.title || 'Landscape';
        const profileFieldsFor = typeof options.profileFieldsFor === 'function'
            ? options.profileFieldsFor
            : () => options.profileFields || null;

        const parts = [`## ${title} Details`];
        for (const section of sections) {
            const items = section.members.map((object) => ({
                title: this.objectTitle(object),
                body: this.inventoryObjectDetails(object, profileFieldsFor(object)),
            }));
            parts.push(`### ${section.heading}`, this.buildAccordion(items));
        }
        return parts.join('\n\n');
    }
}

module.exports = ArchitectureModel;
module.exports.INVENTORY_NOISE_ATTRIBUTES = INVENTORY_NOISE_ATTRIBUTES;
module.exports.DEFAULT_INVENTORY_CATEGORIES = DEFAULT_INVENTORY_CATEGORIES;
