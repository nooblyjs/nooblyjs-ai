/**
 * @fileoverview requestsService — Target Process **Requests**.
 *
 * A Request represents an Idea, Issue or Question raised against the portfolio.
 * In the Product tree they are the **Continuous Exploration** inputs that sit
 * beneath the Epic / Portfolio Epic they are linked to (via the RequestEpics /
 * RequestPortfolioEpics junctions).
 *
 * Retrieves the Requests collection (cached to `cache/requests.json`) and
 * exposes {@link RequestsService#buildRequestContent}, the per-request markdown
 * page builder reused by the release-train content build.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');
const md = require('../utilities/markdown.js');

const REQUEST_INCLUDE = [
    'Id', 'Name', 'Description', 'EntityState[Name]', 'Project[Id,Name]',
    'RequestType[Name]', 'Priority[Name]',
    // Used to place a request that is not linked to any Epic / Portfolio Epic
    // directly under its Agile Release Train (Continuous Exploration).
    'AgileReleaseTrain[Id,Name]',
];

// Request workflow states that should never be loaded into the content tree.
const EXCLUDED_REQUEST_STATES = new Set(['de-scoped', 'cancelled']);

// Used when a Request has no resolvable workflow state — its Continuous
// Exploration state-grouping folder falls back to this name.
const REQUEST_NO_STATE = 'No State';

// Fine-grained Target Process states collapsed into a single Continuous
// Exploration folder. Keyed by the lower-cased state name; any state not listed
// keeps its own name. Keeps the state grouping in one editable place.
const REQUEST_STATE_GROUPS = new Map([
    ['implementing', 'Build'],
    ['releasing', 'Build'],
    ['deployed to prod', 'Build'],
    ['blocked', 'Waiting'],
    ['on hold', 'Waiting'],
    ['program backlog', 'Backlog'],
]);

// Preferred left-to-right ordering of the Continuous Exploration state-grouping
// folders, written to each CE folder's `.settings/file-order.json`. Names must
// match stateFolderName() output (grouped names included). Any state folder not
// listed here (e.g. "Waiting", "No State") sorts after these, alphabetically.
const REQUEST_STATE_ORDER = ['Funnel', 'Roadmap', 'Analysing', 'Backlog', 'Build', 'Done'];

class RequestsService extends ProductBase {

    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Requests and cache them.
     * @returns {Promise<Array<object>>}
     */
    async retrieve() {
        const requests = await this.tp.retrieveAll('Requests', { include: REQUEST_INCLUDE });
        const active = requests.filter((request) => !this.isExcludedState(request));
        super.writeCache('requests.json', active);
        console.log(`[requestsService] retrieved ${requests.length} requests (${active.length} after dropping ${requests.length - active.length} de-scoped/cancelled)`);
        return active;
    }

    /**
     * Whether a Request is in a workflow state that excludes it from the content
     * tree (De-scoped or Cancelled).
     * @param {object} request - A request carrying an `EntityState[Name]`.
     * @returns {boolean}
     */
    isExcludedState(request) {
        return EXCLUDED_REQUEST_STATES.has(this.refName(request && request.EntityState).trim().toLowerCase());
    }

    /**
     * The Continuous Exploration folder name a Request is grouped under: its
     * workflow state, with several fine-grained states collapsed into a shared
     * bucket (see {@link REQUEST_STATE_GROUPS}) — e.g. Implementing / Releasing /
     * Deployed to Prod → "Build"; Blocked / On Hold → "Waiting"; Program Backlog
     * → "Backlog".
     * Falls back to {@link REQUEST_NO_STATE} when the request has no state.
     * @param {object} request - A request carrying an `EntityState[Name]`.
     * @returns {string}
     */
    stateFolderName(request) {
        const state = this.refName(request && request.EntityState).trim();
        if (!state) {
            return REQUEST_NO_STATE;
        }
        return REQUEST_STATE_GROUPS.get(state.toLowerCase()) || state;
    }

    /**
     * The preferred ordering of the Continuous Exploration state-grouping folders,
     * for writing to a folder's `.settings/file-order.json`. Names match
     * {@link RequestsService#stateFolderName} output.
     * @returns {string[]}
     */
    stateFolderOrder() {
        return REQUEST_STATE_ORDER.slice();
    }

    /**
     * Build a single request's markdown page (a Continuous Exploration item).
     * @param {object} request - Full record, or the {Id, Name} mapping ref.
     * @returns {string}
     */
    buildRequestContent(request) {
        const parts = [
            `# ${md.field(request.Name)}`,
            `**Target Process Id:** ${md.externalLink(md.field(request.Id), this.tpEntityUrl(request.Id))}`,
        ];

        const description = this.htmlToText(request.Description);
        parts.push('## Description', description || '_No description provided._');

        return parts.join('\n\n') + '\n';
    }
}

module.exports = RequestsService;
