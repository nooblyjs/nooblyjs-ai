/**
 * @fileoverview Step: retrieve Target Process Features and cache them.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const FeaturesService = require('../services/featuresService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new FeaturesService(productSettings());
    const features = await service.retrieve();
    return {
        response: { count: features.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
