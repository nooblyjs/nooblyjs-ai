/**
 * @fileoverview Build the Product Design settings object from environment
 * variables (the `product_design_*` keys in the knowledge repo's `.env`).
 *
 * When executed by the backend WorkflowExecutor the variables are already in
 * `process.env`; for standalone runs we also best-effort load the sibling
 * knowledge repo's `.env` (dotenv does not override variables already set).
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const path = require('node:path');

// When executed by the backend the `product_design_*` vars are already in
// process.env, so loading dotenv here is only a convenience for standalone runs.
// It is best-effort: a missing/unresolvable dotenv must not crash the step.
try {
    // product-design/utilities -> ../../../.env
    require('dotenv').config({
        path: path.resolve(__dirname, '../../../.env'),
    });
} catch (error) {
    console.warn('[product-design] dotenv not loaded (' + error.message + '); relying on process.env');
}

/**
 * Trim a raw environment value, tolerating undefined. Guards against trailing
 * whitespace and stray carriage returns (e.g. when the .env was saved with
 * CRLF line endings) leaking into URLs, credentials and paths.
 * @param {string|undefined} value
 * @returns {string|undefined}
 */
function clean(value) {
    return typeof value === 'string' ? value.replace(/[\r\n]+/g, '').trim() : value;
}

/**
 * @returns {object} settings consumed by the services (server/credentials,
 *   contentfolder, datafolder, tempfolder, archivefolder).
 */
function productSettings() {
    return {
        server: clean(process.env.product_design_server),
        username: clean(process.env.product_design_username),
        password: clean(process.env.product_design_password),
        token: clean(process.env.product_design_token) || null,
        // Apptio Front Door API keys. When present, the Target Process client
        // exchanges them for a short-lived apptio-opentoken and sends it as a
        // request header (preferred over Basic auth / access_token query param).
        frontdoorPublicKey: clean(process.env.TP_PUBLIC_KEY) || null,
        frontdoorPrivateKey: clean(process.env.TP_PRIVATE_KEY) || null,
        frontdoorUrl: clean(process.env.TP_FRONTDOOR_URL) || 'https://frontdoor.apptio.com/service/apikeylogin',
        contentfolder: clean(process.env.product_design_contentfolder),
        datafolder: clean(process.env.product_design_datafolder),
        tempfolder: clean(process.env.product_design_tempfolder),
        archivefolder: clean(process.env.product_design_archivefolder),
    };
}

module.exports = { productSettings };
