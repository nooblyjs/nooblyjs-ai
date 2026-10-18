/**
 * @fileoverview Step 1 of the dashboards workflow — walk the content repository
 * and extract the business-solution records the dashboards are built from.
 *
 * Walks `contentfolder` for every `.home.md`, lifts each page's ```document```
 * block and Status table into a record, and caches the records to JSON so the
 * content step can run independently.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 * @lastupdated 2026-06-08
 */

'use strict';

require('dotenv').config({ path: '../../../.env', quiet: true });

const path = require('node:path');
const DashboardDataClass = require('../services/dashboardData.js');

/** The content repositories walked by default (siblings of this repo). */
const DEFAULT_CONTENT_FOLDERS = [
   '../knowledge-content/enterprise',
   '../knowledge-content/fintech',
   '../knowledge-content/people',
];

/**
 * Resolve the folders the dashboards step works with from the step input and
 * environment, applying sensible defaults. Shared by both dashboard steps.
 *
 * `contentfolder` accepts a single path or an array of paths; `contentfolders`
 * (array) is also accepted directly. The wiki resolves a user's dashboard per
 * space, and each space maps 1:1 to a content repo, so the dashboards are
 * written into EVERY content repo's `.dashboards` folder by default
 * (`dashboardfolders`) — a single `dashboardfolder` override is still honoured.
 * `emailMapFile` points at the name->email-prefix map used to name the files.
 *
 * @param {Object} data - The step input
 * @returns {{contentfolders:string[], dashboardfolders:string[], emailMapFile:string, cachefile:string}}
 */
function resolveSettings(data) {
   let contentfolders = data.contentfolders
      || data.contentfolder
      || (process.env.dashboards_contentfolders
         ? process.env.dashboards_contentfolders.split(',').map((s) => s.trim())
         : null)
      || process.env.dashboards_contentfolder
      || DEFAULT_CONTENT_FOLDERS;
   if (!Array.isArray(contentfolders)) contentfolders = [contentfolders];
   contentfolders = contentfolders.filter(Boolean);

   // Where dashboards are written. Default: each content repo's `.dashboards`
   // (so any space the user opens resolves their file). An explicit
   // dashboardfolder(s) override collapses this to the given location(s).
   let dashboardfolders = data.dashboardfolders
      || data.dashboardfolder
      || process.env.dashboards_dashboardfolder
      || contentfolders.map((folder) => path.join(folder, '.dashboards'));
   if (!Array.isArray(dashboardfolders)) dashboardfolders = [dashboardfolders];
   dashboardfolders = dashboardfolders.filter(Boolean);

   const emailMapFile = data.emailMapFile
      || process.env.dashboards_emailmapfile
      || path.join(__dirname, '..', 'config', 'people-emails.json');

   // The records cache lives alongside the first dashboard folder.
   const cachefile = data.cachefile
      || path.join(dashboardfolders[0], '.dashboards.json');

   return { contentfolders, dashboardfolders, emailMapFile, cachefile };
}

/**
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @param {string} [data.contentfolder] - Root content folder to walk
 * @param {string} [data.dashboardfolder] - Where dashboards / cache live
 * @returns {Promise<Object>} A completion message object
 */
async function run(data) {
   data.settings = resolveSettings(data);

   const dashboardData = new DashboardDataClass(data.settings);
   const records = await dashboardData.retrieve();

   const result = {
      response: {
         message: 'Extracted ' + records.length + ' business solution(s).',
         count: records.length,
         cachefile: data.settings.cachefile,
      },
      receivedData: data,
      processedAt: new Date().toISOString(),
   };
   return result;
}

module.exports = {
   run,
   resolveSettings,
};
