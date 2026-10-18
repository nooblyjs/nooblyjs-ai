/**
 * @fileoverview Step: retrieve the Target Process Portfolio Epic → Agile Release
 * Train mappings (PortfolioEpicAgileReleaseTrains) and cache them.
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const PortfolioEpicReleaseTrainsService = require('../services/portfolioEpicReleaseTrainsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new PortfolioEpicReleaseTrainsService(productSettings());
    const mappings = await service.retrieve();
    return {
        response: { count: mappings.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
