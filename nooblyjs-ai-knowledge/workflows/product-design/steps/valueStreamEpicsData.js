/**
 * @fileoverview Step: retrieve the Target Process Value Stream → Epic mappings
 * (ValueStreamEpics) and cache them.
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const ValueStreamEpicsService = require('../services/valueStreamEpicsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new ValueStreamEpicsService(productSettings());
    const mappings = await service.retrieve();
    return {
        response: { count: mappings.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
