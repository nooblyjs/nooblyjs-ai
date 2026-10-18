/**
 * @fileoverview Step: retrieve Target Process Epics and cache them.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const EpicsService = require('../services/epicsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new EpicsService(productSettings());
    const epics = await service.retrieve();
    return {
        response: { count: epics.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
