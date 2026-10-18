/**
 * @fileoverview enablerFeaturesService — Target Process **Enabler Features**.
 *
 * Retrieves the EnablerFeatures collection (cached to `cache/enablerfeatures.json`).
 * An enabler feature is a technical/architectural enabler that sits under an Epic
 * (unlike a Feature it carries no PortfolioEpic reference — see
 * https://acme.tpondemand.com/api/v1/EnablerFeatures/meta). It links up to its
 * parents through:
 *   - `Epic` — the immediate parent epic, e.g.
 *       <Epic ResourceType="Epic" Id="161730" Name="Rex Trails"/>
 *   - `AgileReleaseTrain` — the train it belongs to.
 *
 * The enabler features are surfaced as a "## Enabler Features" section on the
 * parent Epic's `.home.md` page (built in epicsService) — there is a link to the
 * epic on every enabler feature, so they are grouped under it.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const ENABLER_FEATURE_INCLUDE = [
    'Id', 'Name', 'Description', 'EntityState[Name]', 'Effort', 'Project[Id,Name]',
    // The field that links an enabler feature up to its parent epic:
    'Epic[Id,Name]',
    // An enabler feature also carries its release train.
    'AgileReleaseTrain[Id,Name]',
];

class EnablerFeaturesService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Enabler Features and cache them (cancelled ones dropped so they
     * are excluded from every downstream content build).
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const enablerFeatures = await this.tp.retrieveAll('EnablerFeatures', { include: ENABLER_FEATURE_INCLUDE });
        const active = enablerFeatures.filter((enabler) => !this.isCancelled(enabler));
        super.writeCache('enablerfeatures.json', active);
        console.log(`[enablerFeaturesService] retrieved ${enablerFeatures.length} enabler features (${active.length} after dropping ${enablerFeatures.length - active.length} cancelled)`);
        return active;
    }
}

module.exports = EnablerFeaturesService;
