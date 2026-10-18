/**
 * @fileoverview Step: retrieve the Target Process Request → Feature mappings
 * (RequestFeatures) and cache them.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const RequestFeaturesService = require('../services/requestFeaturesService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new RequestFeaturesService(productSettings());
    const mappings = await service.retrieve();
    return {
        response: { count: mappings.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
