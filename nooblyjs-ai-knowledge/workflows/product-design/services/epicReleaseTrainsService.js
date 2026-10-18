/**
 * @fileoverview epicReleaseTrainsService — Target Process
 * **EpicAgileReleaseTrains** (Epic → Agile Release Train map).
 *
 * This is a junction collection: each item maps one Epic to one
 * AgileReleaseTrain, e.g.
 *
 *   { Id, AgileReleaseTrain: { Id, Name }, Epic: { Id, Name } }
 *
 * It is retrieved and cached to `cache/epicreleasetrains.json` so the Release
 * Trains content step can list, under each release train, the epics that belong
 * to it. There is no content of its own — the mapping is data the release train
 * pages consume.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const EPIC_RELEASE_TRAIN_INCLUDE = ['Id', 'Epic[Id,Name]', 'AgileReleaseTrain[Id,Name]'];

class EpicReleaseTrainsService extends ProductBase {

    /**
     * @param {object} settings - server/username/password/token, datafolder, contentfolder.
     */
    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Epic → Release Train mappings and cache them.
     * @returns {Promise<Array<object>>} The mappings.
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('EpicAgileReleaseTrains', {
            include: EPIC_RELEASE_TRAIN_INCLUDE,
        });
        super.writeCache('epicreleasetrains.json', mappings);
        console.log(`[epicReleaseTrainsService] retrieved ${mappings.length} epic → release train mappings`);
        return mappings;
    }
}

module.exports = EpicReleaseTrainsService;
