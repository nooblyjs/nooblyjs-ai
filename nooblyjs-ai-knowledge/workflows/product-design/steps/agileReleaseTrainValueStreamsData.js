/**
 * @fileoverview Step: retrieve the Target Process Agile Release Train → Value
 * Stream mappings (AgileReleaseTrainValueStreams) and cache them.
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const AgileReleaseTrainValueStreamsService = require('../services/agileReleaseTrainValueStreamsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new AgileReleaseTrainValueStreamsService(productSettings());
    const mappings = await service.retrieve();
    return {
        response: { count: mappings.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
