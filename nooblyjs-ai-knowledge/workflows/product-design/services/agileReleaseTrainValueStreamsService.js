/**
 * @fileoverview agileReleaseTrainValueStreamsService — Target Process
 * **AgileReleaseTrainValueStreams** (Agile Release Train → Value Stream map).
 *
 * Junction collection linking a release train to the value streams it contains:
 *
 *   { Id, AgileReleaseTrain: { Id, Name }, ValueStream: { Id, Name } }
 *
 * Cached to `cache/agilereleasetrainvaluestreams.json` and consumed by
 * releaseTrainsService to nest value streams under their release train. Data-only.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const ART_VALUE_STREAM_INCLUDE = ['Id', 'AgileReleaseTrain[Id,Name]', 'ValueStream[Id,Name]'];

class AgileReleaseTrainValueStreamsService extends ProductBase {

    /**
     * @param {object} settings - server/username/password/token, datafolder, contentfolder.
     */
    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Release Train → Value Stream mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('AgileReleaseTrainValueStreams', { include: ART_VALUE_STREAM_INCLUDE });
        super.writeCache('agilereleasetrainvaluestreams.json', mappings);
        console.log(`[agileReleaseTrainValueStreamsService] retrieved ${mappings.length} release train → value stream mappings`);
        return mappings;
    }
}

module.exports = AgileReleaseTrainValueStreamsService;
