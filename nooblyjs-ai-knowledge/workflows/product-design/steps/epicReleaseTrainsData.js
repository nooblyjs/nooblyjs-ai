/**
 * @fileoverview Step: retrieve the Target Process Epic → Agile Release Train
 * mappings (EpicAgileReleaseTrains) and cache them.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const EpicReleaseTrainsService = require('../services/epicReleaseTrainsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new EpicReleaseTrainsService(productSettings());
    const mappings = await service.retrieve();
    return {
        response: { count: mappings.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
