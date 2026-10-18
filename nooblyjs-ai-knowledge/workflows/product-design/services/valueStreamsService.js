/**
 * @fileoverview valueStreamsService — Target Process **ValueStreams**.
 *
 * Retrieves the ValueStreams collection (cached to `cache/valuestreams.json`).
 * A value stream sits between an Agile Release Train and its epics / portfolio
 * epics in the Product tree:
 *
 *   Product > Agile Release Train > Value Stream > { Epic | Portfolio Epic > Feature }
 *
 * The train→value-stream link is the AgileReleaseTrainValueStreams junction, and
 * the value-stream→epic / value-stream→portfolio-epic links are the
 * ValueStreamEpics / ValueStreamPortfolioEpics junctions. This is a data-only
 * service; the tree itself is assembled by releaseTrainsService from these caches.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const VALUE_STREAM_INCLUDE = ['Id', 'Name', 'Description', 'Project[Id,Name]'];

class ValueStreamsService extends ProductBase {

    /**
     * @param {object} settings - server/username/password/token, datafolder, contentfolder.
     */
    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Value Streams and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const valueStreams = await this.tp.retrieveAll('ValueStreams', { include: VALUE_STREAM_INCLUDE });
        super.writeCache('valuestreams.json', valueStreams);
        console.log(`[valueStreamsService] retrieved ${valueStreams.length} value streams`);
        return valueStreams;
    }
}

module.exports = ValueStreamsService;
