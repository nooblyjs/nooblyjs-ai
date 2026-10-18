/**
 * @fileoverview portfolioEpicReleaseTrainsService — Target Process
 * **PortfolioEpicAgileReleaseTrains** (Portfolio Epic → Agile Release Train map).
 *
 * This is a junction collection: each item maps one PortfolioEpic to one
 * AgileReleaseTrain, e.g.
 *
 *   { Id, AgileReleaseTrain: { Id, Name }, PortfolioEpic: { Id, Name } }
 *
 * It is retrieved and cached to `cache/portfolioepicreleasetrains.json` so the
 * Release Trains content step can list, under each release train, the portfolio
 * epics that belong to it. There is no content of its own — the mapping is data
 * the release train pages consume.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const PORTFOLIO_EPIC_RELEASE_TRAIN_INCLUDE = ['Id', 'PortfolioEpic[Id,Name]', 'AgileReleaseTrain[Id,Name]'];

class PortfolioEpicReleaseTrainsService extends ProductBase {

    /**
     * @param {object} settings - server/username/password/token, datafolder, contentfolder.
     */
    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Portfolio Epic → Release Train mappings and cache them.
     * @returns {Promise<Array<object>>} The mappings.
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('PortfolioEpicAgileReleaseTrains', {
            include: PORTFOLIO_EPIC_RELEASE_TRAIN_INCLUDE,
        });
        super.writeCache('portfolioepicreleasetrains.json', mappings);
        console.log(`[portfolioEpicReleaseTrainsService] retrieved ${mappings.length} portfolio epic → release train mappings`);
        return mappings;
    }
}

module.exports = PortfolioEpicReleaseTrainsService;
