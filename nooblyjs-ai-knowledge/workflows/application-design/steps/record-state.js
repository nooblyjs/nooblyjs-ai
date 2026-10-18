/**
 * @fileoverview Step 3 (git pipeline) - Record State: persist the commit that
 * was just successfully documented, so the next run only diffs from here.
 *
 * This step runs last. The workflow engine stops on the first failure, so it
 * only runs when the Process step succeeded — which keeps lastProcessedSha
 * pointing at a commit whose documentation actually completed. A failed run
 * leaves the marker untouched, so its commits are retried next time.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';
const serviceRegistry = require('nooblyjs-core');
const GitService = require('../services/gitService');

/**
 * Step 3 - Record State
 *
 * @param {Object} data - Workflow context (enriched by Steps 1 & 2)
 * @returns {Promise<Object>} Result confirming the recorded SHA
 */
async function run(data) {
    const logger = serviceRegistry.logger();

    // Fetch Code is step 1 — its output carries the folder and the commit.
    const fetchOutput = (data.steps && data.steps[0]) ? data.steps[0].data : {};
    const targetFolder = fetchOutput.workingDestination || data.workingDestination;
    const currentSha = fetchOutput.currentSha || data.currentSha;

    if (!targetFolder || !currentSha) {
        throw new Error('Record State: missing targetFolder or currentSha from the Fetch Code step');
    }

    GitService.writeLastProcessedSha(targetFolder, currentSha);
    logger.info('Step 3 - Record State: recorded last processed commit', {
        targetFolder,
        currentSha
    });

    return {
        message: `Recorded last processed commit ${currentSha}`,
        lastProcessedSha: currentSha,
        processedAt: new Date().toISOString()
    };
}

module.exports = { run };
