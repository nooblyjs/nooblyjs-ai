/**
 * @fileoverview Step: retrieve Target Process Enabler Features and cache them.
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const EnablerFeaturesService = require('../services/enablerFeaturesService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new EnablerFeaturesService(productSettings());
    const enablerFeatures = await service.retrieve();
    return {
        response: { count: enablerFeatures.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
