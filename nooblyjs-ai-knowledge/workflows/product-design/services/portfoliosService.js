/**
 * @fileoverview portfoliosService — Target Process **Projects**.
 *
 * Retrieves the Projects (portfolios) collection and caches it to
 * `cache/projects.json`, where the release-train content build reads it.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const ProductBase = require('../base/productBase.js');
const TargetProcess = require('../utilities/targetProcess.js');

const PROJECT_INCLUDE = ['Id', 'Name', 'Description', 'Abbreviation', 'Program[Id,Name]', 'Process[Id,Name]'];

class PortfoliosService extends ProductBase {

    /**
     * @param {object} settings - server/username/password/token, datafolder, contentfolder.
     */
    constructor(settings) {
        super(settings);
        this.tp = new TargetProcess(settings);
    }

    /**
     * Retrieve all Projects and cache them.
     * @returns {Promise<Array<object>>} The projects.
     */
    async retrieve() {
        const projects = await this.tp.retrieveAll('Projects', { include: PROJECT_INCLUDE });
        super.writeCache('projects.json', projects);
        console.log(`[portfoliosService] retrieved ${projects.length} projects`);
        return projects;
    }
}

module.exports = PortfoliosService;
