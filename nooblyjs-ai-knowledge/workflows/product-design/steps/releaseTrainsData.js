/**
 * @fileoverview Step: retrieve Target Process Agile Release Trains and cache them.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const ReleaseTrainsService = require('../services/releaseTrainsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new ReleaseTrainsService(productSettings());
    const releaseTrains = await service.retrieve();
    return {
        response: { count: releaseTrains.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
