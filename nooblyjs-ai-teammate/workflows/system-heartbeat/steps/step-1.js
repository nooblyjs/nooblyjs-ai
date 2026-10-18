
/**
 * Sample Workflow
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

const serviceRegistry = require('digital-technologies-core');

async function run(data) {

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
        logger.debug("Step Executing",data);
        result.data = "Step executed"
    } catch (error) {
        logger.error('Error initializing CodeExpert or during processing:', error.message);
        console.log(error);
        process.exit(1);
    }

    result = {
        'message': result,
        'receivedData': data,
        'processedAt': new Date().toISOString()
    };

}

module.exports = {
    run,
};
