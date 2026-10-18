/**
 * @fileoverview Step: retrieve Target Process Projects and cache them.
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const PortfoliosService = require('../services/portfoliosService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new PortfoliosService(productSettings());
    const projects = await service.retrieve();
    return {
        response: { count: projects.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
