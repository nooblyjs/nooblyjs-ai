/**
 * @fileoverview epicsService — Target Process **Epics**.
 *
 * Retrieves the Epics collection (cached to `cache/epics.json`) and exposes
 * {@link EpicsService#buildEpicHome}, the epic `.home.md` page builder reused by
 * the release-train content build. The epic page lists the epic's Features (read
 * from `cache/features.json`, so the Features *Retrieve* step should run first
 * for a fully-populated list).
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');
const md = require('../utilities/markdown.js');

const EPIC_INCLUDE = ['Id', 'Name', 'Description', 'EntityState[Name]', 'Project[Id,Name]', 'PortfolioEpic[Id,Name]'];

class EpicsService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Epics and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const epics = await this.tp.retrieveAll('Epics', { include: EPIC_INCLUDE });
        const active = epics.filter((epic) => !this.isCancelled(epic));
        super.writeCache('epics.json', active);
        console.log(`[epicsService] retrieved ${epics.length} epics (${active.length} after dropping ${epics.length - active.length} cancelled)`);
        return active;
    }

    /**
     * Build a single epic's detail page.
     * @param {object} epic
     * @param {Array<object>} features - Features belonging to this epic.
     * @param {Array<object>} [requests] - Requests linked to this epic (Continuous Exploration).
     * @param {Array<object>} [requirements] - Requirements linked to this epic.
     * @param {Array<object>} [enablerFeatures] - Enabler features whose Epic is this epic.
     * @returns {string}
     */
    buildEpicHome(epic, features, requests = [], requirements = [], enablerFeatures = []) {
        const parts = [
            md.buildHero(epic.Name),
        ];

        const description = this.htmlToText(epic.Description);
        if (description) {
            parts.push(description);
        }

        parts.push(...this.buildRequirementsSection(requirements));
        parts.push(...this.buildEnablerFeaturesSection(enablerFeatures));
        parts.push(...this.buildContinuousExplorationSection(requests));

        return parts.join('\n\n') + '\n';
    }

    /**
     * Build the "## Enabler Features" section for an epic home page: a table of the
     * Enabler Features linked to it (an enabler feature carries an `Epic` reference,
     * so they are grouped under their parent epic). Returns an empty array when
     * there are none, so it can be spread into a `parts` list unconditionally.
     * @param {Array<object>} [enablerFeatures] - Enabler features whose Epic is this epic.
     * @returns {string[]}
     */
    buildEnablerFeaturesSection(enablerFeatures = []) {
        if (!enablerFeatures.length) {
            return [];
        }
        const rows = enablerFeatures
            .slice()
            .sort((a, b) => md.field(a.Name).localeCompare(md.field(b.Name)))
            .map((enabler) => [
                md.field(enabler.Name),
                md.field(this.refName(enabler.EntityState)),
                md.field(enabler.Effort),
                md.field(this.htmlToText(enabler.Description)),
                md.externalLink(md.field(enabler.Id), this.tpEntityUrl(enabler.Id)),
            ]);
        return ['## Enabler Features', md.buildTable(['Name', 'State', 'Effort', 'Description', 'Target Process Id'], rows)];
    }
}

module.exports = EpicsService;
