/**
 * @fileoverview requirementPortfolioEpicsService — Target Process
 * **RequirementPortfolioEpics** (Requirement → Portfolio Epic map).
 *
 * Junction collection:
 *
 *   { Id, Requirement: { Id, Name }, PortfolioEpic: { Id, Name } }
 *
 * Cached to `cache/requirementportfolioepics.json` and consumed by
 * releaseTrainsService to list a requirement in the "## Requirements" table on
 * its portfolio epic's home page. Data-only.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const REQUIREMENT_PORTFOLIO_EPIC_INCLUDE = ['Id', 'Requirement[Id,Name]', 'PortfolioEpic[Id,Name]'];

class RequirementPortfolioEpicsService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Requirement → Portfolio Epic mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('RequirementPortfolioEpics', { include: REQUIREMENT_PORTFOLIO_EPIC_INCLUDE });
        super.writeCache('requirementportfolioepics.json', mappings);
        console.log(`[requirementPortfolioEpicsService] retrieved ${mappings.length} requirement → portfolio epic mappings`);
        return mappings;
    }
}

module.exports = RequirementPortfolioEpicsService;
