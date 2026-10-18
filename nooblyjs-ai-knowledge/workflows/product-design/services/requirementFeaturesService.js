/**
 * @fileoverview requirementFeaturesService — Target Process **RequirementFeatures**
 * (Requirement → Feature map).
 *
 * Junction collection:
 *
 *   { Id, Requirement: { Id, Name }, Feature: { Id, Name } }
 *
 * Cached to `cache/requirementfeatures.json` and consumed by releaseTrainsService
 * to list a requirement in the "## Requirements" table on its feature's page.
 * Data-only.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const REQUIREMENT_FEATURE_INCLUDE = ['Id', 'Requirement[Id,Name]', 'Feature[Id,Name]'];

class RequirementFeaturesService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Requirement → Feature mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('RequirementFeatures', { include: REQUIREMENT_FEATURE_INCLUDE });
        super.writeCache('requirementfeatures.json', mappings);
        console.log(`[requirementFeaturesService] retrieved ${mappings.length} requirement → feature mappings`);
        return mappings;
    }
}

module.exports = RequirementFeaturesService;
