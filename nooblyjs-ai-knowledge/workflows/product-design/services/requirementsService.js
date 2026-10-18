/**
 * @fileoverview requirementsService — Target Process **Requirements**.
 *
 * Retrieves the Requirements collection (cached to `cache/requirements.json`),
 * where the release-train content build reads it to populate the "## Requirements"
 * table on each Epic / Portfolio Epic / Feature home page (linked via the
 * RequirementEpics / RequirementPortfolioEpics / RequirementFeatures junctions).
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

// "Type" on the Requirements table maps to the entity's EntityType — Target
// Process has no RequirementType field (including it is a 400).
const REQUIREMENT_INCLUDE = ['Id', 'Name', 'Description', 'EntityType[Name]', 'EntityState[Name]', 'Project[Id,Name]'];

class RequirementsService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Requirements and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const requirements = await this.tp.retrieveAll('Requirements', { include: REQUIREMENT_INCLUDE });
        super.writeCache('requirements.json', requirements);
        console.log(`[requirementsService] retrieved ${requirements.length} requirements`);
        return requirements;
    }
}

module.exports = RequirementsService;
