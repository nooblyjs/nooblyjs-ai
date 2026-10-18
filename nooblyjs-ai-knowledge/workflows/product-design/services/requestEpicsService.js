/**
 * @fileoverview requestEpicsService — Target Process **RequestEpics**
 * (Request → Epic map).
 *
 * Junction collection:
 *
 *   { Id, Request: { Id, Name }, Epic: { Id, Name } }
 *
 * Cached to `cache/requestepics.json` and consumed by releaseTrainsService to
 * place a request as a Continuous Exploration page beneath its epic. Data-only.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const REQUEST_EPIC_INCLUDE = ['Id', 'Request[Id,Name]', 'Epic[Id,Name]'];

class RequestEpicsService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Request → Epic mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('RequestEpics', { include: REQUEST_EPIC_INCLUDE });
        super.writeCache('requestepics.json', mappings);
        console.log(`[requestEpicsService] retrieved ${mappings.length} request → epic mappings`);
        return mappings;
    }
}

module.exports = RequestEpicsService;
