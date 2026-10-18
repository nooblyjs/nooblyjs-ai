/**
 * @fileoverview Retrieve a business solution roadmap object and process its view points
 *
 * @author NooblyJS Team
 * @version 1.1.0
 * @since 1.0.0
 */

'use strict';

// Internal Libraries
const ArchitectureModel = require('../../common/architecture/models/architectureModel.js');
const GraphicClass = require('../../common/architecture/models/graphic.js');
const fileUtils = require('../../common/architecture/filesystem/filesystem.js');

// Seatch Class
const BusinessSolutionsSearchClass = require('./businessSolutionSearch.js');

/**
 * Maps the "Responsible Technology Executive" attribute to a portfolio name.
 * Any executive not listed falls through to their own name as the portfolio.
 */
const PORTFOLIO_BY_EXECUTIVE = {
    'Sandra Moumtzis': 'Enterprise Technologies',
    'Debbie Cunningham': 'Digital Platforms',
    'Adrian Linde': 'Fintech Technologies',
    'Jacques De Waal': 'Digital Infrastructure',
    'Ferdie Voges': 'Shared Services',
    'Maciej Kaliszkas': 'Maciej Kaliszkas',
    'Maciej Kaliszka': 'Data and Analytics',
    'Richard Page': 'Commercial Services',
};

/**
 * Value streams, in priority order. The first one flagged "Principal" on the
 * roadmap object wins.
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
 * Viewpoint name fragments that are rendered as a plain picture placeholder
 * rather than a structured content page.
 */
const PLACEHOLDER_VIEWPOINTS = [
    '- Landscape',
    '- Application Landscape Model',
    '- Application Landscape Diagram',
    '- Cybersecurity',
    '- Physical Deployment',
    '- Solution Component',
    '- Technology Stack',
    '- Operational Support',
    '- Webhook Definition',
    '- Message Publish Definition',
];

/**
 * When walking a Roadmap viewpoint's descendants, integration viewpoints whose
 * name contains any of these fragments are skipped (they are documented
 * elsewhere).
 */
const IGNORED_INTEGRATION_VIEWPOINTS = [
    'API Definition',
    'Webhook Definition',
    'Business Solution',
    'Message Publish Definition',
    'Landscape',
    'Application Landscape Model',
    'Application Landscape Diagram',
    'Cybersecurity',
    'Operational Support',
    'Physical Deployment',
    'Solution Component',
    'Solution Positioning',
    'Solution Principles',
    'Technology Stack',
    'Capabilities',
    'Context',
    'Roadmap',
    'Reports',
    'CRUD',
];

/**
 * Maps a classified viewpoint type to the method that builds its content.
 * Used to dispatch the main viewpoint-processing loop.
 */
const CONTENT_BUILDER_BY_TYPE = {
    placeholder: 'createPlaceHolderContent',
    apidefinition: 'createApiDefinitionContent',
    capability: 'createCapabilityContent',
    context: 'createContextContent',
    crud: 'createCRUDContent',
    principles: 'createPrinciplesContent',
    compliance: 'createComplianceContent',
    positioning: 'createSolutionPositioningContent',
    deployment: 'createDeploymentContent',
    cybersecurity: 'createCybersecurityContent',
    component: 'createSolutionComponentContent',
    landscape: 'createLandscapeContent',
    techstack: 'createTechnologyStackContent',
    code: 'createCodeRepositoriesContent',
    undefined: 'createUndefinedContent',
};

/**
 * Non-Functional Requirement sections. Each entry becomes one accordion item;
 * the row labels double as the model attribute keys.
 */
const NFR_SECTIONS = [
    { title: 'Compatibility requirements', fields: ['Co-Existence', 'Interoperability'] },
    { title: 'Maintainability requirements', fields: ['Extensibility', 'Monitoring and Support', 'Re-usability'] },
    {
        title: 'Performance requirements',
        fields: [
            'Minimum network bandwidth required',
            'Network Quality of Service',
            'Network Quality of Service Internal WAN',
            'Peak messaging',
            'Peak time simultaneous users/ connections',
            'Projected solution usage growth',
            'Solution scalability required',
            'Storage space required',
        ],
    },
    { title: 'Portability requirements', fields: ['Adaptability', 'Installability'] },
    {
        title: 'Reliability requirements',
        fields: ['Archiving', 'Backup Config', 'Business Owner RPO/RTO', 'Data retention period', 'Down-time for servicing', 'Hours of operation'],
    },
    {
        title: 'Security requirements',
        fields: ['Accountability', 'Authenticity', 'Confidentiality', 'Integrity', 'Legislation and Gov', 'Non-repudiation', 'Policies'],
    },
    { title: 'Usability and Channel requirements', fields: ['Accessibility', 'Localization', 'Usability constraints'] },
];

/**
 * Information carrier detail sections. Each entry becomes one collapsible
 * section on an individual integration page; the `[label, attribute key]` pairs
 * become the Field/Value rows. The attribute keys mirror the "Information
 * carrier" (Data Flow) object's attributes in the architecture model.
 */
const INFO_CARRIER_SECTIONS = [
    {
        title: 'Overview',
        fields: [
            ['Reference', 'Name'],
            ['Description', 'Description/Definition'],
            ['Purpose', 'Purpose'],
            ['Technical Operation', 'Technical Operation Name'],
            ['Project Cross-Reference', 'Project-Cross Ref No.'],
        ],
    },
    {
        title: 'Technical',
        fields: [
            ['Integration Type', 'Integration Type'],
            ['Communication Protocol', 'Communication Protocol'],
            ['Data Format', 'Data Format'],
            ['Flow Direction', 'API Flow Direction'],
            ['Synchronicity', 'Synchronicity'],
            ['Batch or Real Time', 'Batch or Real Time'],
            ['Frequency', 'Frequency'],
            ['Estimated Message Size', 'Estimated size of the data per message'],
        ],
    },
    {
        title: 'Security & Compliance',
        fields: [
            ['Security Classification', 'Security Classification'],
            ['Required Security Mechanism', 'Required Security Mechanism'],
            ['Actual Security Mechanism', 'Actual Security Mechanism'],
            ['Data Privacy', 'Data Privacy'],
            ['PCI Related', 'PCI Related'],
            ['Finance or Pricing Related', 'Finance or Pricing related'],
            ['Monetised', 'Monetised'],
        ],
    },
    {
        title: 'Delivery & Design',
        fields: [
            ['Requires Guaranteed Delivery', 'Requires guaranteed delivery'],
            ['Transformation Required', 'Is transformation required'],
            ['Transformation Reason', 'Requires transformation reason'],
            ['Re-usable Interface', 'Is the interface re-usable'],
            ['Requires Complex Routing', 'Requires complex routing'],
            ['Requires Complex Transaction Management', 'Requires complex transaction management'],
            ['Requires Complex Error Management', 'Requires complex error management'],
        ],
    },
];

/**
 * Inline-badge variants for CRUD operation values, keyed by lowercased value.
 */
const CRUD_BADGE_VARIANTS = {
    reads: 'primary', read: 'primary',
    creates: 'success', create: 'success',
    updates: 'warning', update: 'warning',
    deletes: 'danger', delete: 'danger',
};

/**
 * Inline-badge variants for Security Classification values, keyed by
 * lowercased value.
 */
const SECURITY_BADGE_VARIANTS = {
    public: 'info',
    private: 'warning',
    confidential: 'danger',
    restricted: 'danger',
};

/**
 * Inline-badge variants for Capability "Purpose" values, keyed by lowercased
 * value. Anything other than "supports" falls back to the 'warning' default.
 */
const PURPOSE_BADGE_VARIANTS = {
    supports: 'success',
};

/**
 * Inline-badge variants for Solution Principle "Adheres" values, keyed by
 * lowercased value. Anything other than "yes" (including empty/undefined)
 * falls back to the 'warning' default.
 */
const ADHERES_BADGE_VARIANTS = {
    yes: 'success',
};

/**
 * Inline-badge variants for Solution Positioning relationships (the connection
 * type linking the solution to a positioning element), keyed by lowercased
 * value. Unmapped relationships fall back to the 'secondary' default.
 */
const POSITIONING_BADGE_VARIANTS = {
    supports: 'success',
    'can be located at': 'info',
    uses: 'primary',
};

/**
 * Solution Positioning sections. Diagram objects are grouped into one section
 * per object symbol, rendered in this order; the `describe` flag adds a
 * Description column (objectives carry a rich description, other elements do
 * not). Any symbol not listed is appended as its own section.
 */
const POSITIONING_CATEGORIES = [
    { symbol: 'Objective', heading: 'Strategic Objectives', label: 'Objective', describe: true },
    { symbol: 'Location', heading: 'Locations', label: 'Location', describe: false },
    { symbol: 'Product', heading: 'Products & Services', label: 'Product / Service', describe: false },
    { symbol: 'Entity', heading: 'Entities & Vendors', label: 'Entity', describe: false },
];

/**
 * Properties shown for an application/solution object in the diagram-inventory
 * accordions (Deployment, Cybersecurity, Solution Component, Landscape). Each
 * `[label, attribute key]` pair becomes one Field/Value row, in this order.
 * Only the keys an object actually carries are rendered, so a lightweight
 * object (an external solution, a channel) shows a short table while a full
 * SaaS/Technology Solution shows its complete profile — without dumping all
 * ~150 raw attributes. A present-but-empty value renders as a red "Undefined"
 * badge.
 */
const APPLICATION_PROFILE_FIELDS = [
    ['Description', 'Description/Definition'],
    ['Short Description', 'Short description'],
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
    ['Solution Architect', 'Solution Architect'],
    ['Business Owner', 'Business Owner'],
    ['Responsible Technology Executive', 'Responsible Technology Executive'],
    ['DR Level', 'DR Level'],
    ['DR Available', 'DR-Available'],
    ['Solution Continuity Tier', 'Solution Continuity Tier'],
    ['Solution Criticality Tier', 'Solution Criticality Tier'],
];

/**
 * Housekeeping attribute keys excluded when listing a non-application object's
 * own attributes in the diagram-inventory accordions — the identity key (shown
 * as the accordion title), the modelling-tool bookkeeping fields and the
 * numeric Type code.
 */
const NOISE_ATTRIBUTE_KEYS = new Set([
    'Name', 'Type', 'kind', 'guid',
    'Time of generation', 'Creator', 'Last change', 'Last user', 'ModelQA',
]);

/**
 * Categories the diagram-inventory objects are grouped under, in render order.
 * Each object is matched against the first category whose `match` returns true;
 * anything unmatched falls into a trailing "Other Objects" group. The match is
 * on the formatted object's ARIS `type` (see modelBase.formatModel).
 */
const INVENTORY_CATEGORIES = [
    { heading: 'Applications & Solutions', match: (object) => object.type === 'Application system type' },
    { heading: 'Hardware Components', match: (object) => object.type === 'Hardware component type' },
    { heading: 'Locations & Subscriptions', match: (object) => object.type === 'Location' },
    { heading: 'Requirements', match: (object) => object.type === 'Requirement' },
    { heading: 'Application Classes', match: (object) => object.type === 'Application system class' },
];

/**
 * The workflow (referenced by its display name) that rebuilds a single
 * roadmap's content. Emitted into each solution's `document` block as the
 * `workflow` field so the wiki "Refresh" button knows which workflow to run;
 * it is resolved by name via the backend WorkflowBridge.resolveWorkflowByName.
 */
const ROADMAP_REFRESH_WORKFLOW = 'Design Solution: Retrieve and Build Roadmap content ignoring Cache';

/**
 * Manages the inventory of business solutions: retrieves roadmap data from the
 * architecture modelling tool and generates the markdown content pages.
 *
 * Generated markdown targets the KR custom-block parser
 * (nooblyjs-core/src/views/js/markdown-parser.js): hero-banner,
 * container, accordion and summary blocks plus standard tables. Custom-block
 * content is indented two spaces — enough to stay inside the block, but under
 * the four-space threshold that would make `marked` treat it as a code block.
 *
 * @method retrieve - Retrieve a model JSON from the architecture modelling tool
 * @method retrieveBusinessSolutionData - Retrieve and cache all data for a roadmap
 * @method filterBusinessSolution - Find the roadmap object in the business solutions cache
 * @method determineFolder - Determine the folder structure for the business solution
 * @method determineModelPath - Determine the file path for a model's content
 * @method classifyViewpoint - Classify a viewpoint by its name
 * @method createBusinessSolutionContents - Create all content for a business solution
 * @method create*Content - Build the markdown for an individual viewpoint type
 */
class businessSolutionClass extends ArchitectureModel {

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
     * @param {string} roadmap - The roadmap model id
     * @param {boolean} useCache - Bypass the cache when true
     */
    async retrieveBusinessSolutionData(roadmap, useCache = true) {

        const graphic = new GraphicClass(this.settings);

        // Retrieve the data for the roadmap model
        const result = await this.retrieve(roadmap);

        for (const key in result.modelObjects) {
    
            // Retrieve the model object
            const modelObject = result.modelObjects[key];

            // Retrieve the models assigned to the roadmap object and cache them
            console.log("Retrieving data for object " + key + " with name " + modelObject.attributes.Name);

            for (let i = 0; i < modelObject.assignments.length; i++) {
                try {
                    await this.retrieve(modelObject.assignments[i].model, useCache);
                    await graphic.retrievePNGDataCached(modelObject.assignments[i].model, useCache);
                } catch (error) {
                    console.error("Error retrieving data for object " + key + " with name " + modelObject.attributes.Name);
                }
            }

            // Retrieve the models the object appears on (via search) and cache them
            console.log("Retrieving search data for object " + key + " with name " + modelObject.attributes.Name);
            const businessSolutionSearchClass = new BusinessSolutionsSearchClass(this.settings);
            const data = await businessSolutionSearchClass.retrieveBusinessSolutionsForSearch(key, useCache);
            if (data.items && data.items.length > 0) {
                for (const [descendantKey, value] of Object.entries(data.items[0].descendants)) {
                    try {
                        await this.retrieve(value.item.guid, useCache);
                        await graphic.retrievePNGDataCached(value.item.guid, useCache);
                    } catch (error) {
                        console.error("Error retrieving data for object " + descendantKey + " with name " + value.item.guid);
                    }
                }
            }

        }
    }

    /**
     * From the business solutions cache, find the objects belonging to a roadmap.
     * @param {string} roadmap - The roadmap model id
     * @returns {object} A model containing only the matching objects
     */
    async filterBusinessSolution(roadmap) {

        const filteredModel = { modelObjects: {} };
        const data = super.readCache('businessSolutions.json');

        for (const [key, value] of Object.entries(data.modelObjects)) {
            if (value.assignments != null && value.assignments.length > 0) {
                if (value.assignments[0].model == roadmap) {
                    filteredModel.modelObjects[key] = value;
                }
            }
        }
        return filteredModel;
    }

    /**
     * Determine the solution folder structure from the roadmap object.
     * @param {string} roadmap - The roadmap model id
     * @returns {object} { portfolio, valuestream, domain }
     */
    async determineFolder(roadmap) {

        const folder = { portfolio: "None", valuestream: "Unassigned", domain: "Unassigned" };
        const data = await this.filterBusinessSolution(roadmap);

        for (const value of Object.values(data.modelObjects)) {

            // Do not process archived or retired applications
            const status = value.attributes["Current Status"];
            if (status === "Retired" || status === "Archived") {
                continue;
            }

            // Determine the portfolio from the responsible executive
            const executive = value.attributes["Responsible Technology Executive"];
            folder.portfolio = PORTFOLIO_BY_EXECUTIVE[executive] ?? executive;

            // Determine the value stream (first one flagged "Principal" wins)
            const principalStream = VALUE_STREAMS.find(
                (stream) => value.attributes[`Value Stream - ${stream}`] === "Principal"
            );
            if (principalStream) {
                folder.valuestream = principalStream;
            }

            // Determine the domain from the "belongs to class" connection
            if (value.connections != null) {
                for (const connection of value.connections) {
                    if (connection.type == "belongs to class") {
                        folder.domain = fileUtils.sanitizeFilename(connection.targetmodelname);
                    }
                }
            }
        }
        console.log(folder)
        return folder;
    }

    /**
     * From the model name and folder structure, determine the content file path.
     * @param {object} modelViewPoint - The model viewpoint data
     * @param {object} folders - The { portfolio, valuestream } folder structure
     * @param {string} [versionFolder] - Optional version subfolder (e.g. "To Be").
     *   Empty for the root/"As Is" version, which writes to the solution folder.
     * @returns {object|undefined} { businessSolution, viewPoint, folder, filename }
     */
    determineModelPath(modelViewPoint, folders, versionFolder = '') {
        try {
            const businessSolution = fileUtils.sanitizeFilename(modelViewPoint.attributes.Name.split('-')[0]);
            const viewPoint = fileUtils.sanitizeFilename(modelViewPoint.attributes.Name.split('-')[1]);
            const versionSegment = versionFolder ? `${versionFolder}/` : '';
            const folder = `${this.settings.contentfolder}/${folders.portfolio}/${folders.valuestream}/${businessSolution}/${versionSegment}`;
            const filename = `${folder}${viewPoint}.md`;
            return { businessSolution, viewPoint, folder, filename };
        } catch (error) {
            console.error("=================================");
            console.log(error);
            console.log(modelViewPoint);
            console.error("=================================");
        }
    }

    /**
     * Classify a viewpoint by its name into a content type.
     * @param {string} name - The viewpoint name
     * @returns {string|null} A content type, 'roadmap', 'reports', or null when unmatched
     */
    classifyViewpoint(name) {
        if (name.includes('- Solution Positioning')) return 'positioning';
        if (name.includes('- API Definition')) return 'apidefinition';
        // These four viewpoints used to render the diagram image alone
        // (placeholder); they now also get an object-by-object inventory
        // accordion, so they must be classified before the placeholder catch.
        if (name.includes('- Physical Deployment')) return 'deployment';
        if (name.includes('- Cybersecurity')) return 'cybersecurity';
        if (name.includes('- Solution Component')) return 'component';
        if (name.includes('- Application Landscape Model')
            || name.includes('- Application Landscape Diagram')
            || name.includes('- Landscape')) return 'landscape';
        if (name.includes('- Technology Stack')) return 'techstack';
        if (name.includes('- Code Repositor')) return 'code';
        if (PLACEHOLDER_VIEWPOINTS.some((fragment) => name.includes(fragment))) {
            return 'placeholder';
        }
        if (name.includes('- Capabilities')) return 'capability';
        if (name.includes('- Context')) return 'context';
        if (name.includes('- CRUD')) return 'crud';
        if (name.includes('- Solution Principles')) return 'principles';
        if (name.includes('- Solution Compliance') || name.includes('- Compliance')) return 'compliance';
        if (name.includes('- Roadmap')) return 'roadmap';
        if (name.includes('- Reports')) return 'reports';
        if (name.split('-').length > 1) return 'undefined';
        return null;
    }

    /**
     * Extract a solution's version label from a roadmap object's name.
     *
     * A roadmap holds one object per version of the solution, named
     * "{solution} - {version}" (e.g. "SAP SuccessFactors - To Be"). The object
     * representing the solution itself carries no version suffix. The version is
     * whatever follows the solution-name prefix.
     *
     * @param {string} objectName - The roadmap object's Name attribute
     * @param {string} solutionPrefix - The solution name (roadmap name without " - Roadmap")
     * @returns {string} The version label, or '' when the object has no version suffix
     */
    versionLabel(objectName, solutionPrefix) {
        if (!objectName) return '';
        let name = objectName.trim();
        if (solutionPrefix && name.toLowerCase().startsWith(solutionPrefix.toLowerCase())) {
            name = name.slice(solutionPrefix.length);
        } else if (name.includes(' - ')) {
            // Fallback: keep everything from the first " - " separator onward
            name = name.slice(name.indexOf(' - '));
        } else {
            return '';
        }
        // Strip the leading separator (spaces and/or hyphens)
        return name.replace(/^[\s-]+/, '').trim();
    }

    /**
     * Whether a version renders into the solution's root folder rather than its
     * own subfolder. The "current" version — any "As Is" spelling variant
     * (case/space/hyphen-insensitive) or an object with no version suffix —
     * lives at the root; every other version (To Be, Go Live, …) gets a
     * subfolder named after its label.
     *
     * @param {string} version - The version label from {@link versionLabel}
     * @returns {boolean}
     */
    isRootVersion(version) {
        if (!version) return true;
        return version.toLowerCase().replace(/[\s-]/g, '') === 'asis';
    }

    /**
     * Build a viewpoint's content, write it to disk, and record it in viewpoints.
     * The content is always built; the write is skipped only when the result is
     * identical to the file on disk (see writeMarkdownPreserving).
     * @param {string} model - The model id
     * @param {object} modelViewPoint - The model viewpoint data
     * @param {string} builderMethod - The create*Content method name to use
     * @param {object} modelPath - The path object from determineModelPath
     * @param {Array} viewpoints - The accumulator of created viewpoints
     */
    async writeViewpointContent(model, modelViewPoint, builderMethod, modelPath, viewpoints) {
        const content = await this[builderMethod](model, modelViewPoint, modelPath.folder);
        fileUtils.writeFile(modelPath.filename, content);
        viewpoints.push({
            model,
            name: modelViewPoint.attributes.Name.split('-')[1].trim(),
            path: modelPath.filename,
        });
    }

    /**
     * Write a per-solution page (Home, Business Solution, NFR, Engineering).
     * The content is always built; the write is skipped only when the result is
     * identical to the file on disk (see writeMarkdownPreserving).
     * @param {string} roadmap - The roadmap model id
     * @param {object} value - The roadmap object data
     * @param {object} folders - The { portfolio, domain } folder structure
     * @param {Array} viewpoints - The accumulator of created viewpoints
     * @param {string} fileName - The file name (relative to the solution folder)
     * @param {string} viewpointName - The name to record in viewpoints
     * @param {function(): (string|Promise<string>)} buildContent - Builds the markdown content
     */
    async writeSolutionPage(roadmap, value, folders, viewpoints, fileName, viewpointName, buildContent) {
        const folderName = fileUtils.sanitizeFilename(value.attributes.Name);
        const filePath = `${this.settings.contentfolder}/${folders.portfolio}/${folders.valuestream}/${folderName}/${fileName}`;
        const content = await buildContent();
        fileUtils.writeFile(filePath, content);
        viewpoints.push({ model: roadmap, name: viewpointName, path: filePath });
    }

    /**
     * Walk a Roadmap viewpoint's descendants and create a page for each
     * integration viewpoint found (the diagram graphic plus the details of its
     * Information carriers — see {@link createIntegrationContent}).
     * @param {object} modelViewPoint - The Roadmap viewpoint data
     * @param {object} folders - The { portfolio, domain } folder structure
     * @param {Array} viewpoints - The accumulator of created viewpoints
     * @param {object} searchClass - A BusinessSolutionsSearchClass instance
     * @param {boolean} useCache - Bypass the search cache when true
     */
    async processRoadmapIntegrations(modelViewPoint, folders, viewpoints, searchClass, useCache = true) {

        for (const key in modelViewPoint.modelObjects) {
            const data = await searchClass.retrieveBusinessSolutionsForSearch(key, useCache);
            if (data.items[0].descendants == null) {
                continue;
            }
            for (const [descendantKey, value] of Object.entries(data.items[0].descendants)) {
                try {
                    const integrationViewPoint = await this.retrieve(value.item.guid);
                    const name = integrationViewPoint.attributes.Name;

                    if (IGNORED_INTEGRATION_VIEWPOINTS.some((fragment) => name.includes(fragment))) {
                        console.log("Ignoring integration viewpoint " + name + " for object " + descendantKey + " with name " + modelViewPoint.attributes.Name);
                    } else {
                        const fullpath = this.determineModelPath(modelViewPoint, folders).folder
                            + 'integrations/'
                            + this.determineModelPath(integrationViewPoint, folders).viewPoint + ".md";
                        const content = await this.createIntegrationContent(value.item.guid, integrationViewPoint);
                        fileUtils.writeFile(fullpath, content);
                        viewpoints.push({ model: value.item.guid, name, path: fullpath });
                    }
                } catch (error) {
                    console.error("Error processing integration viewpoint for object " + descendantKey + " with name " + modelViewPoint.attributes.Name);
                }
            }
        }
    }

    /**
     * Create all the content for the business solution based on its viewpoints.
     * @param {string} roadmap - The roadmap model id
     * @param {boolean} useCache - Bypass the search cache when true
     * @returns {Array} The created viewpoints
     */
    async createBusinessSolutionContents(roadmap, useCache = true) {
        console.log("Creating content for business solution with roadmap " + roadmap);

        const viewpoints = [];
        const businessSolutionSearchClass = new BusinessSolutionsSearchClass(this.settings);

        // Retrieve the data
        const result = await this.retrieve(roadmap);
        const folders = await this.determineFolder(roadmap);

        // If this is not meant to be publised then exit
        if (result.attributes != undefined && result.attributes["Model status"] != undefined &&  result.attributes["Model status"] == "Do not publish"){
            return viewpoints
        }

        // The solution name is the roadmap name without its " - Roadmap" suffix.
        // Each roadmap object is a version of the solution (e.g. "… - As Is",
        // "… - To Be"); the version determines which folder its viewpoints go in.
        const solutionPrefix = ((result.attributes && result.attributes.Name) || '')
            .replace(/\s*-\s*Roadmap\s*$/i, '').trim();

        // Process each version object's assigned viewpoints
        for (const key in result.modelObjects) {
            const object = result.modelObjects[key];
            const version = this.versionLabel(object.attributes && object.attributes.Name, solutionPrefix);
            // "As Is"/no-suffix versions render to the solution root; others to a subfolder
            const versionFolder = this.isRootVersion(version) ? '' : fileUtils.sanitizeFilename(version);
            const assignments = object.assignments;

            for (let i = 0; i < assignments.length; i++) {
                const model = assignments[i].model;
                const modelViewPoint = await this.retrieve(model);

                if (modelViewPoint.attributes == null) {
                    console.log(` === No attributes for  ${model}`);
                    continue;
                }

                const name = modelViewPoint.attributes.Name;
                const type = this.classifyViewpoint(name);

                if (type === 'roadmap') {
                    // Integrations are solution-wide; always written at the root
                    try {
                        await this.processRoadmapIntegrations(modelViewPoint, folders, viewpoints, businessSolutionSearchClass, useCache);
                    }catch (error) {
                        console.log(error);
                        console.error("Error processing roadmap integrations for roadmap " + roadmap);
                    }
                } else if (type === 'context') {
                    // The Context viewpoint is the solution's integrations overview. It is
                    // written as the landing page (.home.md) of the integrations folder
                    // rather than a page in the solution root. Integrations are
                    // solution-wide, so — like the individual integration pages — it is
                    // always written at the root (no version subfolder).
                    const modelPath = this.determineModelPath(modelViewPoint, folders);
                    if (modelPath) {
                        const integrationsPath = {
                            folder: `${modelPath.folder}integrations/`,
                            filename: `${modelPath.folder}integrations/.home.md`,
                        };
                        await this.writeViewpointContent(model, modelViewPoint, CONTENT_BUILDER_BY_TYPE[type], integrationsPath, viewpoints);
                    }
                } else if (type === 'reports' || type === null) {
                    // Reports are no longer used; unclassified viewpoints are skipped
                } else {
                    if (type === 'undefined') {
                        console.log(` === Undefined Model ${name}`);
                    }
                    const modelPath = this.determineModelPath(modelViewPoint, folders, versionFolder);
                    await this.writeViewpointContent(model, modelViewPoint, CONTENT_BUILDER_BY_TYPE[type], modelPath, viewpoints);
                }
            }
        }

        // Create the per-solution pages (Home, Business Solution, NFR, Engineering).
        // Each page type is written in its own pass to preserve the viewpoints ordering.
        const solutionObjects = await this.filterBusinessSolution(roadmap);
        const solutionValues = Object.values(solutionObjects.modelObjects);

        for (const value of solutionValues) {
            await this.writeSolutionPage(roadmap, value, folders, viewpoints, '.home.md', '.home',
                () => this.createHomeContent(roadmap, value, viewpoints));
        }

        for (const value of solutionValues) {
            await this.writeSolutionPage(roadmap, value, folders, viewpoints, 'Business Solution.md', 'Business Solution',
                () => this.createBusinessSolutionContent(roadmap, value, viewpoints));
        }

        for (const value of solutionValues) {
            await this.writeSolutionPage(roadmap, value, folders, viewpoints, 'Non Functional Requirements.md', 'Non Functional Requirements',
                () => this.createNFRContent(roadmap, value));
        }

        return viewpoints;
    }

    // ========================================================================
    // Markdown building helpers
    // ========================================================================

    /**
     * Return the solution name — the part of the model name before the first
     * " - " separator (e.g. "PaymentHub - Capabilities" -> "PaymentHub").
     * @param {object} data - The model data
     * @returns {string}
     */
    solutionName(data) {
        return data.attributes["Name"].split('-')[0].trim();
    }

    /**
     * Render a value as a parser inline badge (`[badge:variant text]`). The
     * variant is looked up (case-insensitively) in variantMap, falling back to
     * defaultVariant for unmapped or missing values.
     * @param {*} value
     * @param {Object} variantMap - { lowercased-value: variant }
     * @param {string} defaultVariant - Variant for unmapped/missing values
     * @returns {string}
     */
    badge(value, variantMap, defaultVariant = 'secondary') {
        const text = (value === undefined || value === null || value === '') ? 'undefined' : String(value);
        const variant = variantMap[text.toLowerCase()] || defaultVariant;
        return `[badge:${variant} ${text}]`;
    }

    /**
     * Indent every non-empty line by two spaces. Custom-block content must be
     * indented 1-3 spaces: enough to stay inside the block, but below the
     * four-space threshold that `marked` treats as an indented code block.
     * @param {string} text
     * @returns {string}
     */
    indentBlock(text) {
        return text
            .split('\n')
            .map((line) => (line.trim() === '' ? '' : '  ' + line))
            .join('\n');
    }

    /**
     * Build a `container` custom block (two column-cards, 50/50).
     * @param {string} leftMarkdown - Markdown for the left card
     * @param {string} rightMarkdown - Markdown for the right card
     * @returns {string}
     */
    buildContainer(leftMarkdown, rightMarkdown) {
        return [
            'container',
            '',
            '  left',
            this.indentBlock(leftMarkdown),
            '',
            '  right',
            this.indentBlock(rightMarkdown),
        ].join('\n');
    }

    /**
     * Build an `accordion` custom block of collapsible items.
     * @param {Array<{title:string, body:string}>} items
     * @param {number} expandedIndex - Index of the item that starts open
     * @returns {string}
     */
    buildAccordion(items, expandedIndex = 0) {
        const parts = ['accordion', '', `  expanded: ${expandedIndex}`];
        for (const item of items) {
            parts.push('', `  ## ${item.title}`, this.indentBlock(item.body));
        }
        return parts.join('\n');
    }

    /**
     * Build a `document` metadata block — a fence-only data block carrying the
     * solution's identifying properties (the roadmap id and the responsible
     * roles). The wiki markdown parser
     * (nooblyjs-ai-knowledge/public/js/markdown/markdown-parser.js)
     * recognises ```document as editable key/value metadata: each `Key: value`
     * line becomes one property (the key is lower-cased when read back via
     * extractDocumentMeta). It is hidden from the reading view and consumed
     * programmatically — breadcrumbs, ownership badges and the like — so the
     * values intentionally mirror the visible Responsible-parties table.
     *
     * It also embeds the wiki "Refresh" action contract as two fields:
     * `workflow` (the workflow to run to rebuild this solution's content) and
     * `workflow-filter` (the complete, self-contained JSON payload for that run
     * — the roadmap id, the content folder and useCache). The wiki reads
     * these two fields and POSTs them straight to /api/workflows/start, so the
     * button is fully data-driven. The payload is deliberately self-contained:
     * a non-empty payload bypasses the workflow's defaultInput, so useCache
     * must be stated explicitly (useCache:false) to force a full refresh. The
     * filter key is lower-case `roadmap` (the matcher in businessSolutions.js
     * is case-insensitive), matching how the parser lower-cases the block keys.
     *
     * Unlike the hero-banner/container/accordion blocks this MUST be a
     * triple-backtick fence: the parser detects `document` by fence only, never
     * by indentation, so an indented variant would be ignored. Keys are always
     * emitted (with an empty value when the attribute is missing) so the block's
     * shape stays stable for consumers, and each value is collapsed to a single
     * line so a stray newline cannot break the line-based format.
     *
     * @param {string} roadmap - The roadmap model id
     * @param {string} name - The solution name
     * @param {object} attrs - The roadmap object's attributes
     * @returns {string} The fenced document block (no trailing newline)
     */
    buildDocumentBlock(roadmap, name, attrs) {
        const value = (raw) => (raw === undefined || raw === null) ? '' : String(raw).replace(/\s+/g, ' ').trim();
        const roadmapId = value(roadmap);

        // The complete, self-contained payload the wiki "Refresh" button POSTs
        // to /api/workflows/start. useCache is explicit because a non-empty
        // payload bypasses the workflow's defaultInput; useCache:false forces a
        // full refresh from ARIS (the Refresh button's intent). Emitted via
        // JSON.stringify (compact, single line, properly escaped) so it survives
        // the line-based document-block format and round-trips through JSON.parse.
        const workflowFilter = {
            filter: [{ roadmap: roadmapId }],
            contentfolder: this.settings.contentfolder,
            useCache: false,
        };

        return [
            '```document',
            '',
            'owner: system',
            `Roadmap: ${roadmapId}`,
            `Business solution: ${value(name)}`,
            `Solutions Architect: ${value(attrs["Solution Architect"])}`,
            `HOD: ${value(attrs["Acme Technology HOD"])}`,
            `Responsible Executive: ${value(attrs["Responsible Technology Executive"])}`,
            `Business Owner: ${value(attrs["Business Owner"])}`,
            `workflow: ${ROADMAP_REFRESH_WORKFLOW}`,
            `workflow-filter: ${JSON.stringify(workflowFilter)}`,
            '',
            '```',
        ].join('\n');
    }

    /**
     * Build a "## Landscape" image block for a model (used as an error fallback).
     * @param {string} model - The model id
     * @param {object} data - The model data (for the alt text)
     * @returns {string}
     */
    async buildLandscapeImage(model, data) {
        const graphic = new GraphicClass(this.settings);
        const base64Png = await graphic.retrievePNGDataCached(model);
        return `## Landscape\n\n![${data.attributes.Name}](data:image/png;base64,${base64Png})`;
    }

    /**
     * Format an error as a fenced code block.
     * @param {Error} error - The error to render
     * @returns {string}
     */
    formatErrorBlock(error) {
        return "```\nError creating content for Business Solution\n" + error + "\n```";
    }

    // ========================================================================
    // Viewpoint content builders
    // ========================================================================

    /**
     * Create the Home page — a hero banner, a metadata strip, an overview and
     * a two-column Status / Responsible-parties container.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {Array} viewpoints - The viewpoints created so far (unused)
     * @returns {string} The markdown content
     */
    async createHomeContent(model, data, viewpoints) {
        try {
            const name = this.solutionName(data);
            const attrs = data.attributes;

            const hero = [
                'hero-banner',
                '',
                `  title: ${name}`,
                `  subtitle: ${this.field(attrs["Description/Definition"])}`,
            ].join('\n');

            const meta = `> **Abbreviation** \`${this.field(attrs["Abbreviation"])}\``
                + ` · **Manufacturer** ${this.field(attrs["Manufacturer"])}`
                + ` · **Solution Architect** ${this.field(attrs["Solution Architect"])}`;

            const status = '### Status\n' + this.buildTable(['Field', 'Value'], [
                ['**Current**', this.field(attrs["Current Status"])],
                ['**Future**', this.field(attrs["Future Strategy"])],
                ['**Pace Layer**', this.field(attrs["Pace Layer"])],
            ]);

            const parties = '### Responsible parties\n' + this.buildTable(['Role', 'Person'], [
                ['**Business Owner**', this.field(attrs["Business Owner"])],
                ['**Responsible Technology Executive**', this.field(attrs["Responsible Technology Executive"])],
                ['**Acme Technology HOD**', this.field(attrs["Acme Technology HOD"])],
                ['**Solution Architect**', this.field(attrs["Solution Architect"])],
            ]);

            return [
                hero,
                meta,
                '---',
                '## Overview',
                this.field(attrs["Description/Definition"]),
                this.buildContainer(status, parties),
                this.buildDocumentBlock(model, name, attrs),
            ].join('\n\n') + '\n';

        } catch (error) {
            return `# Business Solution Home\n\n${this.formatErrorBlock(error)}\n`;
        }
    }

    /**
     * Flatten a connection's own attributes into a single table cell. Empty
     * values are dropped; the surviving `Key: value` pairs are joined with line
     * breaks so the connections table stays one row per connection. Returns the
     * `_undefined_` placeholder when the connection carries no attributes.
     * @param {object} connection - A formatted model connection
     * @returns {string}
     */
    connectionAttributes(connection) {
        const attrs = (connection && connection.attributes) || {};
        const pairs = Object.entries(attrs)
            .filter(([, value]) => value !== undefined && value !== null && value !== '')
            .map(([key, value]) => `${key}: ${String(value).replace(/\s+/g, ' ').trim()}`);
        return pairs.length ? pairs.join('<br>') : '_undefined_';
    }

    /**
     * Create the Business Solution Details page — a full dump of the roadmap
     * object's model data rather than the previously curated sections. Every
     * attribute on the object becomes a row of one big Attributes table (in
     * model order), and every connection becomes a row of a Connections table
     * (type, both endpoints and any connection-level attributes).
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {Array} viewpoints - The viewpoints created so far (unused)
     * @returns {string} The markdown content
     */
    async createBusinessSolutionContent(model, data, viewpoints) {
        try {
            const name = this.solutionName(data);
            const attrs = data.attributes || {};

            // One big table of every attribute on the object, in model order.
            const attributeRows = Object.entries(attrs)
                .map(([key, value]) => [key, this.field(value)]);

            const parts = [
                `# ${name} — Business Solution Details`,
                '## Attributes',
                this.buildTable(['Field', 'Value'], attributeRows),
            ];

            // Every connection on the object: type, the two endpoints and the
            // connection's own attributes flattened into a single cell.
            const connections = Array.isArray(data.connections) ? data.connections : [];
            if (connections.length > 0) {
                const connectionRows = connections.map((connection) => [
                    this.field(connection.type),
                    this.field(connection.srcmodelname),
                    this.field(connection.targetmodelname),
                    this.connectionAttributes(connection),
                ]);
                parts.push(
                    '## Connections',
                    this.buildTable(['Type', 'Source', 'Target', 'Attributes'], connectionRows),
                );
            }

            return parts.join('\n\n') + '\n';

        } catch (error) {
            return await this.errorPage('Business Solution Details', model, data, error);
        }
    }

    /**
     * Create the Non-Functional Requirements page — an accordion with one
     * collapsible section per requirement group.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @returns {string} The markdown content
     */
    async createNFRContent(model, data) {
        try {
            const name = this.solutionName(data);
            const attrs = data.attributes;

            const items = NFR_SECTIONS.map((section) => ({
                title: section.title,
                body: this.buildTable(
                    ['Requirement', 'Value'],
                    section.fields.map((fieldName) => [fieldName, this.field(attrs[fieldName])])
                ),
            }));

            return `# ${name} — Non-Functional Requirements\n\n${this.buildAccordion(items)}\n`;

        } catch (error) {
            return await this.errorPage('Non-Functional Requirements', model, data, error);
        }
    }

    /**
     * Create the Engineering landing page — a short summary callout.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @returns {string} The markdown content
     */
    async createEngineeringContent(model, data) {
        return '';
    }

    /**
     * Build a single-table content page (shared by Principles, Compliance,
     * CRUD, Capability and Context viewpoints).
     * @param {string} model - The model id (used for the error-fallback image)
     * @param {object} data - The model data
     * @param {object} config - { title, columns, mapRow, intro }
     * @param {string} config.title - Text after the solution name in the heading
     * @param {string[]} config.columns - The table header cells
     * @param {function} config.mapRow - Maps a model object to an array of cells
     * @param {string} [config.intro] - Optional intro paragraph above the table
     * @returns {string} The markdown content
     */
    async createTableContent(model, data, { title, columns, mapRow, intro }) {
        try {
            const name = this.solutionName(data);

            const rows = [];
            for (const key in data.modelObjects) {
                const modelObject = data.modelObjects[key];
                if (modelObject.connections.length > 0) {
                    rows.push(mapRow(modelObject));
                }
            }

            const parts = [`# ${name} — ${title}`];
            if (intro) {
                parts.push(intro);
            }
            parts.push(this.buildTable(columns, rows));
            return parts.join('\n\n') + '\n';

        } catch (error) {
            return await this.errorPage(title, model, data, error);
        }
    }

    /**
     * Build an error-fallback page: a heading, a best-effort landscape image
     * and the error in a fenced block.
     * @param {string} title - The page title
     * @param {string} model - The model id
     * @param {object} data - The model data
     * @param {Error} error - The error to render
     * @returns {string}
     */
    async errorPage(title, model, data, error) {
        const parts = [`# ${title}`];
        try {
            parts.push(await this.buildLandscapeImage(model, data));
        } catch (landscapeError) {
            // The fallback image is best-effort; ignore if it cannot be built
        }
        parts.push(this.formatErrorBlock(error));
        return parts.join('\n\n') + '\n';
    }

    /**
     * Create the Solution Principles content.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createPrinciplesContent(model, data, folder) {
        return this.createTableContent(model, data, {
            title: 'Solution Principles',
            intro: 'All listed principles are adhered to.',
            columns: ['Name', 'Description', 'Adheres'],
            mapRow: (object) => [
                this.field(object.connections[0].srcmodelname),
                this.field(object.attributes["Description/Definition"]),
                this.badge(object.connections[0].attributes["Principle Compliance"], ADHERES_BADGE_VARIANTS, 'warning'),
            ],
        });
    }

    /**
     * Create the Solution Compliance content.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createComplianceContent(model, data, folder) {
        return this.createTableContent(model, data, {
            title: 'Solution Compliance',
            columns: ['Name', 'Description', 'Adheres'],
            mapRow: (object) => [
                this.field(object.connections[0].srcmodelname),
                this.field(object.attributes["Description/Definition"]),
                this.badge(object.connections[0].attributes["Principle Compliance"], ADHERES_BADGE_VARIANTS, 'warning'),
            ],
        });
    }

    /**
     * Create the CRUD content.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createCRUDContent(model, data, folder) {
        return this.createTableContent(model, data, {
            title: 'CRUD',
            columns: ['Information Classification', 'CRUD', 'Security Classification', 'Description'],
            mapRow: (object) => [
                this.field(object.connections[0].targetmodelname),
                this.badge(object.connections[0].type, CRUD_BADGE_VARIANTS),
                this.badge(object.attributes["Security Classification"], SECURITY_BADGE_VARIANTS),
                this.field(object.attributes["Description/Definition"]),
            ],
        });
    }

    /**
     * Create the Capability content.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createCapabilityContent(model, data, folder) {
        return this.createTableContent(model, data, {
            title: 'Capabilities',
            columns: ['Capability', 'Description', 'Purpose'],
            mapRow: (object) => [
                this.field(object.connections[0].targetmodelname),
                this.field(object.attributes["Description/Definition"]),
                this.badge(object.connections[0].type, PURPOSE_BADGE_VARIANTS, 'warning'),
            ],
        });
    }

    /**
     * Create the Context (Integrations) content.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createContextContent(model, data, folder) {
        return this.createTableContent(model, data, {
            title: 'Integrations',
            columns: ['Source', 'Destination', 'Information'],
            mapRow: (object) => [
                this.field(object.connections[0].srcmodelname),
                this.field(object.connections[0].targetmodelname),
                this.field(object.connections[0].attributes["Description/Definition"]),
            ],
        });
    }

    /**
     * Identify the Information carrier (Data Flow) objects in an integration
     * model — the objects whose details an individual integration page renders.
     * @param {object} data - The model data
     * @returns {object[]} The Information carrier model objects
     */
    infoCarriers(data) {
        return Object.values(data.modelObjects || {})
            .filter((object) => object.type === 'Information carrier');
    }

    /**
     * A human-readable label for an Information carrier: its description (or
     * short description), suffixed with its reference name when both exist.
     * @param {object} attrs - The carrier's attributes
     * @returns {string}
     */
    infoCarrierLabel(attrs) {
        const description = (attrs["Description/Definition"] || attrs["Short description"] || '').trim();
        const name = (attrs["Name"] || '').trim();
        if (description && name && description !== name) {
            return `${description} (${name})`;
        }
        return description || name || 'Interface';
    }

    /**
     * Build the captioned Field/Value tables describing one Information carrier,
     * grouped per {@link INFO_CARRIER_SECTIONS}. Returned as a single markdown
     * fragment for use as one accordion item body, so the section captions are
     * bold text rather than `##` headings (which the accordion parser would
     * read as new item titles). Values are plain text — inline badges are not
     * processed inside custom blocks, so they would render as literal markup.
     * @param {object} attrs - The carrier's attributes
     * @returns {string}
     */
    buildInfoCarrierDetails(attrs) {
        return INFO_CARRIER_SECTIONS.map((section) =>
            `**${section.title}**\n\n` + this.buildTable(
                ['Field', 'Value'],
                section.fields.map(([label, key]) => [label, this.field(attrs[key])])
            )
        ).join('\n\n');
    }

    /**
     * Create an individual integration page: the diagram graphic (exactly as the
     * placeholder renders it) followed by the details of each Information carrier
     * the model contains, one collapsible section per carrier. Falls back to the
     * graphic alone when the model has no Information carriers.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createIntegrationContent(model, data, folder) {
        // The diagram graphic (heading + image) is the page header, exactly as
        // the placeholder renders it.
        const placeholder = await this.createPlaceHolderContent(model, data, folder);

        const carriers = this.infoCarriers(data);
        if (carriers.length === 0) {
            return placeholder;
        }

        try {
            const items = carriers.map((carrier) => ({
                title: this.infoCarrierLabel(carrier.attributes),
                body: this.buildInfoCarrierDetails(carrier.attributes),
            }));
            // placeholder already ends with a trailing newline.
            return placeholder + '\n## Integration Details\n\n' + this.buildAccordion(items) + '\n';
        } catch (error) {
            return placeholder;
        }
    }

    /**
     * Render a value for a diagram-inventory table cell, flagging a missing
     * value with a red "Undefined" badge. The badge is emitted as raw HTML
     * (not the `[badge:…]` token) on purpose: inline badge tokens are only
     * processed on top-level markdown, never inside a custom block, so a token
     * placed in an accordion body would render as literal text — whereas raw
     * HTML passes straight through `marked`. The class names mirror the parser's
     * own badge output so the styling matches.
     * @param {*} value
     * @returns {string}
     */
    inventoryField(value) {
        if (value === undefined || value === null || String(value).trim() === '') {
            return '<span class="badge text-bg-danger kr-inline-badge">Undefined</span>';
        }
        return String(value);
    }

    /**
     * The accordion title for a diagram object — its Name, falling back to its
     * symbol.
     * @param {object} object - A formatted model object
     * @returns {string}
     */
    objectTitle(object) {
        const name = (object.attributes && object.attributes.Name || '').trim();
        return name || object.symbol || 'Object';
    }

    /**
     * Build the [field, value] rows describing one diagram object. Application
     * objects (`type === 'Application system type'`) use the curated
     * {@link APPLICATION_PROFILE_FIELDS} — only the keys actually present are
     * shown — so a rich solution keeps a readable profile rather than dumping
     * every attribute. Every other (lighter) object lists its own attributes,
     * minus the {@link NOISE_ATTRIBUTE_KEYS} housekeeping keys. The object's
     * symbol is always shown first as "Category". Missing values become a red
     * "Undefined" badge.
     * @param {object} object - A formatted model object
     * @returns {Array<string[]>}
     */
    objectPropertyRows(object) {
        const attrs = object.attributes || {};
        const rows = [['Category', this.inventoryField(object.symbol)]];

        if (object.type === 'Application system type') {
            for (const [label, key] of APPLICATION_PROFILE_FIELDS) {
                if (key in attrs) {
                    rows.push([label, this.inventoryField(attrs[key])]);
                }
            }
        } else {
            for (const [key, value] of Object.entries(attrs)) {
                if (NOISE_ATTRIBUTE_KEYS.has(key)) {
                    continue;
                }
                rows.push([key, this.inventoryField(value)]);
            }
        }
        return rows;
    }

    /**
     * Build the [relationship, related object] rows for one diagram object from
     * its connections — the party at the other end of each connection (the one
     * that is not this object). De-duplicated, since a connection is recorded on
     * both of its endpoints.
     * @param {object} object - A formatted model object
     * @returns {Array<string[]>}
     */
    objectRelationshipRows(object) {
        const rows = [];
        const seen = new Set();
        for (const connection of object.connections || []) {
            const other = connection.srcmodel === object.guid
                ? connection.targetmodelname
                : connection.srcmodelname;
            const dedupeKey = `${connection.type}::${other}`;
            if (seen.has(dedupeKey)) {
                continue;
            }
            seen.add(dedupeKey);
            rows.push([connection.type, this.inventoryField(other)]);
        }
        return rows;
    }

    /**
     * Build one accordion-item body for a diagram object: a Properties table
     * and, when the object is connected to others, a Relationships table.
     * Section captions are bold text (not `##`) so the accordion parser does
     * not read them as new item titles. Mirrors {@link buildInfoCarrierDetails}.
     * @param {object} object - A formatted model object
     * @returns {string}
     */
    buildObjectDetails(object) {
        const parts = [
            '**Properties**\n\n' + this.buildTable(['Field', 'Value'], this.objectPropertyRows(object)),
        ];
        const relationships = this.objectRelationshipRows(object);
        if (relationships.length > 0) {
            parts.push('**Relationships**\n\n' + this.buildTable(['Relationship', 'Related Object'], relationships));
        }
        return parts.join('\n\n');
    }

    /**
     * Build a diagram-inventory page: the model graphic (exactly as the
     * placeholder renders it) followed by an accordion walk-through of the
     * diagram's objects, grouped by {@link INVENTORY_CATEGORIES}. Each object is
     * one collapsible item showing a Properties table (missing values flagged
     * with a red "Undefined" badge) and, where present, its relationships.
     * Shared by the Physical Deployment, Cybersecurity, Solution Component and
     * Landscape viewpoints, which previously rendered the diagram image alone.
     * Falls back to the image when the model carries no inventory objects.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @param {string} title - The details-section heading prefix
     * @returns {string} The markdown content
     */
    async createModelInventoryContent(model, data, folder, title) {
        // The diagram graphic (heading + image) is the page header, exactly as
        // the placeholder renders it.
        const placeholder = await this.createPlaceHolderContent(model, data, folder);

        try {
            // The solution this model belongs to appears as one of its own
            // objects (e.g. "SAP Commerce Cloud (B2B eCommerce)" inside its own
            // Landscape). Its full profile is already on the Home / Business
            // Solution Details pages, so it is excluded here to avoid rendering
            // the same detail twice. The subject name is the model name without
            // its " - <Viewpoint>" suffix (same prefix convention as
            // {@link solutionName}); matched case-insensitively. Other solutions
            // in the diagram are kept.
            const subjectName = ((data.attributes && data.attributes.Name) || '')
                .split('-')[0].trim().toLowerCase();

            // Folder objects are layout containers, not real diagram elements.
            const objects = Object.values(data.modelObjects || {})
                .filter((object) => object.symbol !== 'Folder')
                .filter((object) => {
                    const objectName = ((object.attributes && object.attributes.Name) || '').trim().toLowerCase();
                    return objectName === '' || objectName !== subjectName;
                });
            if (objects.length === 0) {
                return placeholder;
            }

            // Group the objects by category, preserving INVENTORY_CATEGORIES
            // order; anything unmatched is collected into a trailing group.
            const sections = [];
            const categorised = new Set();
            for (const category of INVENTORY_CATEGORIES) {
                const members = objects.filter((object) => category.match(object));
                members.forEach((object) => categorised.add(object));
                if (members.length > 0) {
                    sections.push({ heading: category.heading, members });
                }
            }
            const others = objects.filter((object) => !categorised.has(object));
            if (others.length > 0) {
                sections.push({ heading: 'Other Objects', members: others });
            }

            // placeholder already ends with a trailing newline.
            const parts = [placeholder.trimEnd(), `## ${title} Details`];
            for (const section of sections) {
                const items = section.members.map((object) => ({
                    title: this.objectTitle(object),
                    body: this.buildObjectDetails(object),
                }));
                parts.push(`### ${section.heading}`, this.buildAccordion(items));
            }
            return parts.join('\n\n') + '\n';

        } catch (error) {
            return placeholder;
        }
    }

    /**
     * Create the Physical Deployment content — the deployment diagram plus an
     * inventory of its objects (see {@link createModelInventoryContent}).
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createDeploymentContent(model, data, folder) {
        return this.createModelInventoryContent(model, data, folder, 'Deployment');
    }

    /**
     * Create the Cybersecurity content — the cybersecurity diagram plus an
     * inventory of its objects (see {@link createModelInventoryContent}).
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createCybersecurityContent(model, data, folder) {
        return this.createModelInventoryContent(model, data, folder, 'Cybersecurity');
    }

    /**
     * Create the Solution Component content — the component diagram plus an
     * inventory of its objects (see {@link createModelInventoryContent}).
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createSolutionComponentContent(model, data, folder) {
        return this.createModelInventoryContent(model, data, folder, 'Solution Component');
    }

    /**
     * Create the Landscape content — the landscape diagram plus an inventory of
     * its objects (see {@link createModelInventoryContent}).
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createLandscapeContent(model, data, folder) {
        return this.createModelInventoryContent(model, data, folder, 'Landscape');
    }

    /**
     * Create the Technology Stack content — the technology-stack diagram plus an
     * inventory of its objects: the technology components, products and versions
     * the solution is built on (see {@link createModelInventoryContent}).
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createTechnologyStackContent(model, data, folder) {
        return this.createModelInventoryContent(model, data, folder, 'Technology Stack');
    }

    /**
     * Create the Code Repositories content — a plain table of the source-code
     * repositories backing the solution (no diagram image). Each diagram object
     * (a repository, modelled as a "Folder") becomes one row: its name, its
     * source/host (Manufacturer), the clone URL (the "Link 1" attribute) and an
     * "Available" column left blank for now. Objects without a Name are skipped;
     * rows are ordered by name. Falls back to a heading-only error block (never
     * an image) so the "data only" intent holds even on failure.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createCodeRepositoriesContent(model, data, folder) {
        try {
            const name = this.solutionName(data);

            const rows = Object.values(data.modelObjects || {})
                .map((object) => object.attributes || {})
                .filter((attrs) => attrs.Name)
                .sort((a, b) => this.field(a.Name).localeCompare(this.field(b.Name)))
                .map((attrs) => [
                    this.field(attrs.Name),
                    this.field(attrs.Manufacturer),
                    this.field(attrs["Link 1"]),
                    '',
                ]);

            return `# ${name} — Code Repositories\n\n`
                + this.buildTable(['Name', 'Source', 'Repository', 'Available'], rows)
                + '\n';

        } catch (error) {
            return `# Code Repositories\n\n${this.formatErrorBlock(error)}\n`;
        }
    }

    /**
     * Create content for an unrecognised viewpoint — the catch-all for diagrams
     * that match no dedicated builder (e.g. "… - Code Repositories"). Rather than
     * showing the diagram image alone, it walks the diagram's objects and renders
     * them as inventory tables below the image (see
     * {@link createModelInventoryContent}), exactly as the Landscape, Solution
     * Component and Technology Stack viewpoints do. The details-section title is
     * the viewpoint name's suffix — the part after the solution name, e.g.
     * "Knowledge Repository - Code Repositories" -> "Code Repositories" — falling
     * back to "Diagram". When the diagram carries no inventory objects,
     * createModelInventoryContent falls back to the image alone.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createUndefinedContent(model, data, folder) {
        const name = (data.attributes && data.attributes.Name) || '';
        const separatorIndex = name.indexOf('-');
        const title = (separatorIndex >= 0 ? name.slice(separatorIndex + 1) : '').trim() || 'Diagram';
        return this.createModelInventoryContent(model, data, folder, title);
    }

    /**
     * Create the Solution Positioning content — how the solution is positioned
     * within the architecture landscape: the strategic objectives it supports,
     * the locations it operates in and the products and vendors it uses. Built
     * from the diagram's own objects and the connections relating them to the
     * solution. Falls back to the cached diagram image when the model has no
     * positioning relationships.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createSolutionPositioningContent(model, data, folder) {
        try {
            const name = this.solutionName(data);

            // Collect every positioning element (the objects the solution is
            // positioned against) and the connection describing the relation.
            // The solution object itself carries the mirror of each connection
            // and is skipped so relationships are not counted twice.
            const related = [];
            for (const object of Object.values(data.modelObjects || {})) {
                if (object.symbol === 'Technology Solution' || !object.connections) {
                    continue;
                }
                for (const connection of object.connections) {
                    related.push({
                        symbol: object.symbol,
                        name: this.field(object.attributes && object.attributes["Name"]),
                        description: this.field(object.attributes && object.attributes["Description/Definition"]),
                        relationship: connection.type,
                    });
                }
            }

            // Nothing to position against — keep the diagram image fallback
            if (related.length === 0) {
                return await this.createPlaceHolderContent(model, data, folder);
            }

            // Append a section for any symbol not in POSITIONING_CATEGORIES so
            // no diagram element is dropped.
            const knownSymbols = new Set(POSITIONING_CATEGORIES.map((category) => category.symbol));
            const extraCategories = [...new Set(related.map((item) => item.symbol))]
                .filter((symbol) => !knownSymbols.has(symbol))
                .sort()
                .map((symbol) => ({ symbol, heading: symbol, label: symbol, describe: false }));

            const parts = [
                `# ${name} — Solution Positioning`,
                'How this solution is positioned within the architecture landscape — '
                + 'the strategic objectives it supports, the locations it operates in '
                + 'and the products and vendors it uses.',
            ];

            for (const category of [...POSITIONING_CATEGORIES, ...extraCategories]) {
                const rows = related.filter((item) => item.symbol === category.symbol);
                if (rows.length === 0) {
                    continue;
                }
                const columns = category.describe
                    ? [category.label, 'Description', 'Relationship']
                    : [category.label, 'Relationship'];
                const tableRows = rows.map((item) => (category.describe
                    ? [item.name, item.description, this.badge(item.relationship, POSITIONING_BADGE_VARIANTS)]
                    : [item.name, this.badge(item.relationship, POSITIONING_BADGE_VARIANTS)]));
                parts.push(`### ${category.heading}\n` + this.buildTable(columns, tableRows));
            }

            return parts.join('\n\n') + '\n';

        } catch (error) {
            return await this.errorPage('Solution Positioning', model, data, error);
        }
    }

    /**
     * Create the API Definition content — one table per interface group. The
     * groups are the diagram's `Class`/`Interface` objects (e.g.
     * `sapcommercecloud.b2b.products`); each interface (an `Information carrier`
     * /`Data Flow` object) is bucketed under the group named by its
     * "is assigned to" connection. Replaces the diagram-image placeholder this
     * viewpoint used to render. Falls back to that image when the model has no
     * interface groups with interfaces.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createApiDefinitionContent(model, data, folder) {
        try {
            const name = this.solutionName(data);
            const objects = Object.values(data.modelObjects || {});

            // Seed an (initially empty) bucket for each interface group,
            // preserving the order in which the groups appear in the model.
            const groups = new Map();
            for (const object of objects) {
                if (object.symbol === 'Interface' && object.attributes) {
                    groups.set(object.attributes["Name"], { attributes: object.attributes, interfaces: [] });
                }
            }

            // Bucket each interface (Data Flow) under the group its
            // "is assigned to" connection points at.
            for (const object of objects) {
                if (object.symbol !== 'Data Flow' || !object.connections) {
                    continue;
                }
                const assignment = object.connections.find((connection) => connection.type === 'is assigned to');
                if (!assignment) {
                    continue;
                }
                if (!groups.has(assignment.targetmodelname)) {
                    groups.set(assignment.targetmodelname, { attributes: null, interfaces: [] });
                }
                groups.get(assignment.targetmodelname).interfaces.push(object.attributes || {});
            }

            const parts = [
                `# ${name} — API Definition`,
                'The interfaces this solution exposes, grouped by interface (API) group.',
            ];

            for (const [groupName, group] of groups) {
                if (group.interfaces.length === 0) {
                    continue;
                }

                // Stable, readable order by reference number.
                const rows = group.interfaces
                    .slice()
                    .sort((a, b) => this.field(a["Name"]).localeCompare(this.field(b["Name"])))
                    .map((attrs) => [
                        this.field(attrs["Short description"]).trim(),
                        this.field(attrs["Name"]).trim(),
                        this.field(attrs["API Flow Direction"]),
                        this.field(attrs["Integration Type"]),
                        this.field(attrs["Frequency"]),
                        this.badge(attrs["Security Classification"], SECURITY_BADGE_VARIANTS),
                    ]);

                parts.push(`### ${groupName}`);
                if (group.attributes && group.attributes["Internally/Externally Exposed"]) {
                    parts.push(`_${group.attributes["Internally/Externally Exposed"]}_`);
                }
                parts.push(this.buildTable(
                    ['Interface', 'Reference', 'Direction', 'Integration Type', 'Frequency', 'Security'],
                    rows
                ));
            }

            // No interface groups with interfaces — keep the diagram image.
            if (parts.length === 2) {
                return await this.createPlaceHolderContent(model, data, folder);
            }

            return parts.join('\n\n') + '\n';

        } catch (error) {
            return await this.errorPage('API Definition', model, data, error);
        }
    }

    /**
     * Create placeholder content (heading + model graphic) for viewpoints that
     * have no dedicated content format — e.g. Landscape, Physical Deployment.
     * @param {string} model - The model id being processed
     * @param {object} data - The model data
     * @param {string} folder - The folder path (unused)
     * @returns {string} The markdown content
     */
    async createPlaceHolderContent(model, data, folder) {
        try {
            const graphic = new GraphicClass(this.settings);
            const base64Png = await graphic.retrievePNGDataCached(model);
            return `# ${data.attributes["Name"]}\n\n`
                + `![${data.attributes.Name}](data:image/png;base64,${base64Png})\n`;
        } catch (error) {
            return `# ${data.attributes ? data.attributes.Name : 'Diagram'}\n\n${this.formatErrorBlock(error)}\n`;
        }
    }

}

module.exports = businessSolutionClass;
