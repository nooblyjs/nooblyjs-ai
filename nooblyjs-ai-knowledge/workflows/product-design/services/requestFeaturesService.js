/**
 * @fileoverview requestFeaturesService — Target Process **RequestFeatures**
 * (Request → Feature map).
 *
 * Junction collection:
 *
 *   { Id, Request: { Id, Name }, Feature: { Id, Name } }
 *
 * Cached to `cache/requestfeatures.json`. Retrieved for completeness alongside
 * the Request → Epic / Portfolio Epic junctions; features are leaf `.md` pages
 * (not folders) so they do not carry a Continuous Exploration folder of their
 * own. Data-only.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const REQUEST_FEATURE_INCLUDE = ['Id', 'Request[Id,Name]', 'Feature[Id,Name]'];

class RequestFeaturesService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Request → Feature mappings and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const mappings = await this.tp.retrieveAll('RequestFeatures', { include: REQUEST_FEATURE_INCLUDE });
        super.writeCache('requestfeatures.json', mappings);
        console.log(`[requestFeaturesService] retrieved ${mappings.length} request → feature mappings`);
        return mappings;
    }
}

module.exports = RequestFeaturesService;
