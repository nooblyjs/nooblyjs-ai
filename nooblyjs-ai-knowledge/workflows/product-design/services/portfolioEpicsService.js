/**
 * @fileoverview portfolioEpicsService — Target Process **PortfolioEpics**.
 *
 * Retrieves the PortfolioEpics collection and caches it to
 * `cache/portfolioepics.json`, where the release-train content build reads it.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const PORTFOLIO_EPIC_INCLUDE = ['Id', 'Name', 'Description', 'EntityState[Name]', 'Project[Id,Name]'];

class PortfolioEpicsService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all PortfolioEpics and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const portfolioEpics = await this.tp.retrieveAll('PortfolioEpics', { include: PORTFOLIO_EPIC_INCLUDE });
        const active = portfolioEpics.filter((portfolioEpic) => !this.isCancelled(portfolioEpic));
        super.writeCache('portfolioepics.json', active);
        console.log(`[portfolioEpicsService] retrieved ${portfolioEpics.length} portfolio epics (${active.length} after dropping ${portfolioEpics.length - active.length} cancelled)`);
        return active;
    }
}

module.exports = PortfolioEpicsService;
