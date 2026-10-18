/**
 * @fileoverview Step: retrieve Target Process Requirements and cache them.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const RequirementsService = require('../services/requirementsService');

/**
 * @param {object} [data] - Workflow context (unused).
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const service = new RequirementsService(productSettings());
    const requirements = await service.retrieve();
    return {
        response: { count: requirements.length },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
