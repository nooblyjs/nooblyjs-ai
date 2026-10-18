/**
 * @fileoverview Step: retrieve Target Process Requests and cache them.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const RequestsService = require('../services/requestsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new RequestsService(productSettings());
    const requests = await service.retrieve();
    return {
        response: { count: requests.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
