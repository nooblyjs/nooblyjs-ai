/**
 * @fileoverview valueStreamPortfolioEpicsService — Target Process
 * **ValueStreamPortfolioEpics** (Value Stream → Portfolio Epic map).
 *
 * Junction collection:
 *
 *   { Id, ValueStream: { Id, Name }, PortfolioEpic: { Id, Name } }
 *
 * Cached to `cache/valuestreamportfolioepics.json` and consumed by
 * releaseTrainsService to nest portfolio epics under their value stream. Data-only.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const VALUE_STREAM_PORTFOLIO_EPIC_INCLUDE = ['Id', 'ValueStream[Id,Name]', 'PortfolioEpic[Id,Name]'];

class ValueStreamPortfolioEpicsService extends ProductBase {

    /**
     * @param {object} settings - server/username/password/token, datafolder, contentfolder.
     */
    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Value Stream → Portfolio Epic mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('ValueStreamPortfolioEpics', { include: VALUE_STREAM_PORTFOLIO_EPIC_INCLUDE });
        super.writeCache('valuestreamportfolioepics.json', mappings);
        console.log(`[valueStreamPortfolioEpicsService] retrieved ${mappings.length} value stream → portfolio epic mappings`);
        return mappings;
    }
}

module.exports = ValueStreamPortfolioEpicsService;
