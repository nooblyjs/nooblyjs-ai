/**
 * @fileoverview valueStreamEpicsService — Target Process **ValueStreamEpics**
 * (Value Stream → Epic map).
 *
 * Junction collection:
 *
 *   { Id, ValueStream: { Id, Name }, Epic: { Id, Name } }
 *
 * Cached to `cache/valuestreamepics.json` and consumed by releaseTrainsService to
 * nest epics under their value stream. Data-only.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const VALUE_STREAM_EPIC_INCLUDE = ['Id', 'ValueStream[Id,Name]', 'Epic[Id,Name]'];

class ValueStreamEpicsService extends ProductBase {

    /**
     * @param {object} settings - server/username/password/token, datafolder, contentfolder.
     */
    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Value Stream → Epic mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('ValueStreamEpics', { include: VALUE_STREAM_EPIC_INCLUDE });
        super.writeCache('valuestreamepics.json', mappings);
        console.log(`[valueStreamEpicsService] retrieved ${mappings.length} value stream → epic mappings`);
        return mappings;
    }
}

module.exports = ValueStreamEpicsService;
