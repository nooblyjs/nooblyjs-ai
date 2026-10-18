/**
 * @fileoverview requirementEpicsService — Target Process **RequirementEpics**
 * (Requirement → Epic map).
 *
 * Junction collection:
 *
 *   { Id, Requirement: { Id, Name }, Epic: { Id, Name } }
 *
 * Cached to `cache/requirementepics.json` and consumed by releaseTrainsService to
 * list a requirement in the "## Requirements" table on its epic's home page.
 * Data-only.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const REQUIREMENT_EPIC_INCLUDE = ['Id', 'Requirement[Id,Name]', 'Epic[Id,Name]'];

class RequirementEpicsService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Requirement → Epic mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('RequirementEpics', { include: REQUIREMENT_EPIC_INCLUDE });
        super.writeCache('requirementepics.json', mappings);
        console.log(`[requirementEpicsService] retrieved ${mappings.length} requirement → epic mappings`);
        return mappings;
    }
}

module.exports = RequirementEpicsService;
