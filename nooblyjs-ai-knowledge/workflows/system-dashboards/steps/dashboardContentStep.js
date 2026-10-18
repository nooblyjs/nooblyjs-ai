/**
 * @fileoverview Step 2 of the dashboards workflow — build the executive, HOD and
 * solution-architect dashboard files from the extracted records.
 *
 * Reads the records from the cache the data step wrote; if the cache is missing
 * (the content step was run on its own) it re-walks the content folder first so
 * the step is safe to run standalone.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @lastupdated 2026-06-08
 */

'use strict';

require('dotenv').config({ path: '../../../.env' });

const DashboardDataClass = require('../services/dashboardData.js');
const DashboardContentClass = require('../services/dashboardContent.js');
const { resolveSettings } = require('./dashboardDataStep.js');

/**
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @param {string} [data.contentfolder] - Root content folder to walk
 * @param {string} [data.dashboardfolder] - Where the dashboards are written
 * @returns {Promise<Object>} A completion message object
 */
async function run(data) {
   data.settings = resolveSettings(data);

   const dashboardData = new DashboardDataClass(data.settings);

   // Prefer the cache the data step produced; re-walk when run standalone.
   let records = dashboardData.readCache();
   if (records == null) {
      records = await dashboardData.retrieve();
   }

   const dashboardContent = new DashboardContentClass(data.settings);
   const summary = dashboardContent.build(records);

   const result = {
      response: {
         message: 'Built ' + summary.files + ' dashboard file(s) for '
            + summary.people + ' people across ' + summary.folders.length + ' folder(s).',
         files: summary.files,
         people: summary.people,
         byRole: summary.byRole,
         dashboardfolders: summary.folders,
      },
      receivedData: data,
      processedAt: new Date().toISOString(),
   };
   return result;
}

module.exports = {
   run,
};
