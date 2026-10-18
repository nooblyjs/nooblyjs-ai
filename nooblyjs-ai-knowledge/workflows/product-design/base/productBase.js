/**
 * @fileoverview Base class for Product Design services.
 *
 * Provides JSON caching against the configured data folder (the retrieved
 * Target Process collections are cached under `{datafolder}/cache`) plus small
 * shared helpers (HTML→text, field formatting). Mirrors the role of
 * design-solution/base/modelBase.js.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const { writeJSONFile, readJSONFile, fileExists } = require('../utilities/filesystem');
const md = require('./../utilities/markdown.js');

/**
 * Base class for all Product Design service classes.
 * @class
 */
class ProductBase {

    /**
     * @param {object} settings
     * @param {string} settings.datafolder - Folder used to cache retrieved data.
     */
    constructor(settings) {
        if (settings == null || settings.datafolder == null) {
            throw new Error('A datafolder location must be provided in the settings');
        }
        this.settings = settings;
        this.datafolder = settings.datafolder;
    }

    /**
     * @param {string} filename - Cache file name, e.g. "projects.json"
     * @returns {boolean} Whether the cache file exists.
     */
    cacheExists(filename) {
        return fileExists(`${this.datafolder}/cache/${filename}`);
    }

    /**
     * Read a cached collection. Returns [] when absent/invalid.
     * @param {string} filename - Cache file name, e.g. "projects.json"
     * @returns {Array<object>}
     */
    readCache(filename) {
        if (!this.cacheExists(filename)) {
            return [];
        }
        const data = readJSONFile(`${this.datafolder}/cache/${filename}`);
        return Array.isArray(data) ? data : [];
    }

    /**
     * Write a cached collection.
     * @param {string} filename - Cache file name, e.g. "projects.json"
     * @param {*} jsonData
     */
    writeCache(filename, jsonData) {
        writeJSONFile(`${this.datafolder}/cache/${filename}`, jsonData);
    }

    /**
     * Convert a Target Process rich-text/HTML description into plain markdown-ish
     * text: unwrap common tags, collapse whitespace, decode a few entities.
     * @param {string} html
     * @returns {string}
     */
    htmlToText(html) {
        if (html == null || html === '') {
            return '';
        }
        return String(html)
            .replace(/<\s*br\s*\/?\s*>/gi, '\n')
            .replace(/<\s*\/\s*p\s*>/gi, '\n\n')
            .replace(/<\s*li\s*>/gi, '\n- ')
            .replace(/<[^>]+>/g, '')          // strip remaining tags
            .replace(/&#x([0-9a-f]+);/gi, (_, hex) => ProductBase.fromCodePoint(parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, dec) => ProductBase.fromCodePoint(parseInt(dec, 10)))
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&apos;/gi, "'")
            .replace(/&#39;/gi, "'")
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /**
     * Safely convert a numeric character-reference code point to a string,
     * tolerating out-of-range / malformed values (returns '' rather than throwing).
     * @param {number} code
     * @returns {string}
     */
    static fromCodePoint(code) {
        if (!Number.isInteger(code) || code < 0 || code > 0x10FFFF) {
            return '';
        }
        try {
            return String.fromCodePoint(code);
        } catch (error) {
            return '';
        }
    }

    /**
     * Read the `Name` of a Target Process reference object (e.g. EntityState,
     * Project, Epic), tolerating null references.
     * @param {object} ref
     * @returns {string}
     */
    refName(ref) {
        return ref && ref.Name != null ? ref.Name : '';
    }

    /**
     * Whether a Target Process entity is in a cancelled workflow state. Used to
     * drop cancelled Epics / Portfolio Epics from the cached data so they are
     * excluded from every downstream content build.
     * @param {object} entity - Any entity carrying an `EntityState[Name]`.
     * @returns {boolean}
     */
    isCancelled(entity) {
        return this.refName(entity && entity.EntityState).trim().toLowerCase() === 'cancelled';
    }

    /**
     * Whether a Target Process entity is in the "On Track" workflow state. Used to
     * tag an Epic / Portfolio Epic folder with the green ("success") navigation
     * accent when the content tree is built.
     * @param {object} entity - Any entity carrying an `EntityState[Name]`.
     * @returns {boolean}
     */
    isOnTrack(entity) {
        return this.refName(entity && entity.EntityState).trim().toLowerCase() === 'on track';
    }

    /**
     * Whether a Target Process entity is in the "Done" workflow state. Used to
     * float completed Epics / Portfolio Epics to the top of their parent folder
     * (via .settings/file-order.json) when the content tree is built.
     * @param {object} entity - Any entity carrying an `EntityState[Name]`.
     * @returns {boolean}
     */
    isDone(entity) {
        return this.refName(entity && entity.EntityState).trim().toLowerCase() === 'done';
    }

    /**
     * Build the Target Process web URL for an entity (project, epic, feature,
     * request…). Derived from the configured API server so it follows a host
     * change, e.g. "https://acme.tpondemand.com/api/v1" →
     * "https://acme.tpondemand.com/entity/44576".
     * @param {string|number} id
     * @returns {string}
     */
    tpEntityUrl(id) {
        let base = String(this.settings.server || 'https://acme.tpondemand.com')
            .replace(/\/api\/v\d+\/?$/i, '')
            .replace(/\/+$/, '');
        // The configured server may be scheme-less (e.g. "acme.tpondemand.com/api/v1");
        // without a scheme the browser treats the href as a relative link, so force https.
        if (!/^https?:\/\//i.test(base)) {
            base = `https://${base}`;
        }
        return `${base}/entity/${id}`;
    }

    /**
     * Build the "## Continuous Exploration" section for an epic / portfolio epic
     * home page: a table of the Requests linked to it (the pages written into the
     * sibling `Continuous Exploration/` folder). Returns an empty array when there
     * are no requests, so it can be spread into a `parts` list unconditionally.
     * @param {Array<object>} [requests] - Linked Request records.
     * @returns {string[]}
     */
    buildContinuousExplorationSection(requests = []) {
        if (!requests.length) {
            return [];
        }
        const rows = requests
            .slice()
            .sort((a, b) => md.field(a.Name).localeCompare(md.field(b.Name)))
            .map((request) => [
                md.field(request.Name),
                md.field(this.refName(request.EntityState)),
                md.externalLink(md.field(request.Id), this.tpEntityUrl(request.Id)),
            ]);
        return ['## Continuous Exploration', md.buildTable(['Request', 'State', 'Target Process Id'], rows)];
    }

    /**
     * Build the "## Requirements" section for an epic / portfolio epic / feature
     * home page: a table of the Requirements linked to it (via the
     * RequirementEpics / RequirementPortfolioEpics / RequirementFeatures
     * junctions), showing Name, Description and Type (the requirement's
     * EntityType). Returns an empty array when there are no requirements, so it
     * can be spread into a `parts` list unconditionally.
     * @param {Array<object>} [requirements] - Linked Requirement records.
     * @returns {string[]}
     */
    buildRequirementsSection(requirements = []) {
        if (!requirements.length) {
            return [];
        }
        const rows = requirements
            .slice()
            .sort((a, b) => md.field(a.Name).localeCompare(md.field(b.Name)))
            .map((requirement) => [
                md.field(requirement.Name),
                md.field(this.htmlToText(requirement.Description)),
                md.field(this.refName(requirement.EntityType)),
            ]);
        return ['## Requirements', md.buildTable(['Name', 'Description', 'Type'], rows)];
    }
}

module.exports = ProductBase;
