/**
 * @fileoverview Step: build a folder (with a .home.md detail page) per Agile
 * Release Train. Requires the Release Trains data step to have run first.
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const { productSettings } = require('../utilities/settings');
const ReleaseTrainsService = require('../services/releaseTrainsService');

/**
 * Build the release-train Product tree. Two optional workflow inputs let a
 * filtered slice be routed to its own space (mirrors the design-solution
 * filter/contentfolder pattern):
 *
 *   - `data.filter`        — release-train filter, e.g.
 *                            [{ "Release Train": "Fintech" }]. Omit to build
 *                            every train.
 *   - `data.contentfolder` — overrides the default `product_design_contentfolder`
 *                            so the matched trains write into a different space.
 *
 * @param {object} [data] - Workflow context.
 * @param {Array<object>} [data.filter] - Release-train filter (see above).
 * @param {string} [data.contentfolder] - Destination content folder override.
 * @returns {Promise<object>}
 */
async function run(data = {}) {
    const settings = productSettings();
    if (data && data.contentfolder) {
        settings.contentfolder = data.contentfolder;
    }

    const service = new ReleaseTrainsService(settings);
    const messages = await service.createReleaseTrainFolders(data && data.filter);
    return {
        response: { count: messages.length, messages },
        receivedData: data,
        processedAt: new Date().toISOString(),
    };
}

module.exports = { run };
