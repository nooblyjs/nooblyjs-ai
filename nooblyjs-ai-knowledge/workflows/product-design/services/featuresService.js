/**
 * @fileoverview featuresService — Target Process **Features**.
 *
 * Retrieves the Features collection (cached to `cache/features.json`) and
 * exposes {@link FeaturesService#buildFeatureContent}, the per-feature markdown
 * page builder reused by the release-train content build — which writes one page
 * per feature into the parent's `Features/` folder.
 *
 * A feature links up to its parents through two Target Process reference fields,
 * both carried in the feed:
 *   - `PortfolioEpic` — the grandparent portfolio epic, e.g.
 *       <PortfolioEpic ResourceType="PortfolioEpic" Id="6680" Name="Insights Platform (Acme Retail)"/>
 *   - `Epic` — the immediate parent epic, e.g.
 *       <Epic ResourceType="Epic" Id="161730" Name="Rex Trails"/>
 *
 * They are NOT printed on the page — they decide where the page is FILED. The
 * release-train build reads them to place each feature under its epic (or, for a
 * feature with no epic, under its portfolio epic or straight under the train), so
 * the folder path already tells a reader everything the old metadata table did.
 * Keep them in FEATURE_INCLUDE: dropping them would strand every feature.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');
const md = require('../utilities/markdown.js');

const FEATURE_INCLUDE = [
    'Id', 'Name', 'Description', 'EntityState[Name]', 'Effort', 'Project[Id,Name]',
    // The two fields that link a feature up to its parents:
    'PortfolioEpic[Id,Name]', // grandparent portfolio epic
    'Epic[Id,Name]',          // immediate parent epic
    // A feature can also map straight to a release train with no epic / portfolio
    // epic — those are placed directly under the train (e.g. Enterprise eCommerce).
    'AgileReleaseTrain[Id,Name]',
];

class FeaturesService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Features and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const features = await this.tp.retrieveAll('Features', { include: FEATURE_INCLUDE });
        const active = features.filter((feature) => !this.isCancelled(feature));
        super.writeCache('features.json', active);
        console.log(`[featuresService] retrieved ${features.length} features (${active.length} after dropping ${features.length - active.length} cancelled)`);
        return active;
    }

    /**
     * The wiki badge for a feature's workflow state. A few states get a
     * meaningful colour; anything else is rendered informationally under its own
     * name. Returns '' for a feature with no state, so the caller can append it
     * to a heading unconditionally.
     * @param {object} feature - A feature carrying an `EntityState[Name]`.
     * @returns {string}
     */
    stateBadge(feature) {
        const state = this.refName(feature && feature.EntityState).trim();
        const stateLower = state.toLowerCase();
        if (!stateLower) {
            return '';
        }
        if (stateLower === 'done') {
            return '[badge:success Complete]';
        }
        if (stateLower === 'in progress' || stateLower === 'in-progress') {
            return '[badge:primary In Progress]';
        }
        if (stateLower === 'roadmap') {
            return '[badge:info Roadmap]';
        }
        return `[badge:info ${state}]`;
    }

    /**
     * Build a single feature's markdown page — one page per feature under the
     * parent's `Features/` folder. The Target Process Id is a live link back to
     * the record so a reader can act on it.
     *
     * The page opens the same way a Continuous Exploration item does
     * ({@link RequestsService#buildRequestContent}): heading, then the Target
     * Process Id link on its own line. It used to carry a Field/Value table of
     * Project / Portfolio Epic / Epic / State / Effort above the description, which
     * was dropped — the state already shows as a badge on the heading, the parent
     * epic and project are the folders the page sits in, and the rest pushed the
     * description below the fold for metadata nobody was reading.
     * @param {object} feature
     * @param {Array<object>} [requirements] - Requirements linked to this feature.
     * @returns {string}
     */
    buildFeatureContent(feature, requirements = []) {
        const badge = this.stateBadge(feature);

        const parts = [
            `# ${md.field(feature.Name)}${badge ? ` ${badge}` : ''}`,
            `**Target Process Id:** ${md.externalLink(md.field(feature.Id), this.tpEntityUrl(feature.Id))}`,
        ];

        const description = this.htmlToText(feature.Description);
        parts.push('## Description', description || '_No description provided._');

        parts.push(...this.buildRequirementsSection(requirements));

        return parts.join('\n\n') + '\n';
    }
}

module.exports = FeaturesService;
