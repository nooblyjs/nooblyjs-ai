
/**
 * Runs the code extraction task
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @returns {Promise<Object>} A promise that resolves with a completion message object
 */
/**
 * @fileoverview This activity will review a code repository and create markdown foles
 *   
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';
const fs = require('fs');
const path = require('path');

const serviceRegistry = require('nooblyjs-core');

const CodeProcessorClass = require('../services/codeProcessor');
// Resolves a configured AI agent from the Agents registry (global.aiInstances).
const { resolveExpert } = require('../../../src/shared/ai/expertResolver');
const { libraryFor } = require('../../common/prompts/prompts');

/**
 * Mirror the main app's APP_BASE_DIR resolution. The worker inherits the
 * parent's env, so APP_BASE_DIR carries through; otherwise fall back to the
 * shared .application dir alongside the repos (…/work-dt/.application). Both the
 * Agents file and the prompt library are resolved from here.
 * @returns {string} Absolute application base directory.
 */
function resolveAppBaseDir() {
    return process.env.APP_BASE_DIR
        ? path.resolve(process.env.APP_BASE_DIR)
        : path.resolve(__dirname, '../../../.application');
}

async function run(data) {

    // Data to pass to the processor. The architect persona and renderer rules
    // come from the prompt library, resolved off the same application base dir
    // the Agents file uses.
    data.settings = {
        sourceFolder: data.sourceFolder,
        markdownFolder: data.markdownFolder,
        prompts: libraryFor(resolveAppBaseDir())
    };

    let result = {
        'message': '',
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };

    // Get logger from service registry
    const logger = serviceRegistry.logger();

    // Log the job being run
    logger.info('Code analysis being started:', data);

    try {
        //Instantiate Code Processor
        const codeProcessor = new CodeProcessorClass(data.settings);

        // Resolve a configured agent from the Agents registry (provider/model
        // come from whatever the agent was set up with in the Agents screen).
        const expert = resolveExpert({
            usage: 'Code Processing',
            agentName: data.agent,
            logger,
            label: 'Code Processing'
        });
        data.settings.expert = expert;
        
        // Execute the process
        let result = await codeProcessor.process()
    } catch (error) {
        logger.error('Error initializing AI expert or during processing:', error.message);
        console.log(error);
        process.exit(1);
    }

    result = {
        'message': result,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };

    return result;
}

module.exports = {
    run,
};
