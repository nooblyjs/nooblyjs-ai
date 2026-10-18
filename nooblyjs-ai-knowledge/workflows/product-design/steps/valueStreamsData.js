/**
 * @fileoverview Step: retrieve Target Process Value Streams and cache them.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const ValueStreamsService = require('../services/valueStreamsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new ValueStreamsService(productSettings());
    const valueStreams = await service.retrieve();
    return {
        response: { count: valueStreams.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
