/**
 * @fileoverview requestPortfolioEpicsService — Target Process
 * **RequestPortfolioEpics** (Request → Portfolio Epic map).
 *
 * Junction collection:
 *
 *   { Id, Request: { Id, Name }, PortfolioEpic: { Id, Name } }
 *
 * Cached to `cache/requestportfolioepics.json` and consumed by
 * releaseTrainsService to place a request as a Continuous Exploration page
 * beneath its portfolio epic. Data-only.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const REQUEST_PORTFOLIO_EPIC_INCLUDE = ['Id', 'Request[Id,Name]', 'PortfolioEpic[Id,Name]'];

class RequestPortfolioEpicsService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Request → Portfolio Epic mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('RequestPortfolioEpics', { include: REQUEST_PORTFOLIO_EPIC_INCLUDE });
        super.writeCache('requestportfolioepics.json', mappings);
        console.log(`[requestPortfolioEpicsService] retrieved ${mappings.length} request → portfolio epic mappings`);
        return mappings;
    }
}

module.exports = RequestPortfolioEpicsService;
