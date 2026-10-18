/**
 * @fileoverview Step: retrieve Target Process PortfolioEpics and cache them.
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const PortfolioEpicsService = require('../services/portfolioEpicsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new PortfolioEpicsService(productSettings());
    const portfolioEpics = await service.retrieve();
    return {
        response: { count: portfolioEpics.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
