/**
 * @fileoverview Shared helpers for workflow step bootstraps. Every step assembles
 * the same ARIS credential block into its `settings` object and (for the data /
 * content steps) authenticates before calling its service class. These helpers
 * remove that repetition so a step file only has to declare what is unique to
 * it: which datafolder / contentfolder env vars it reads, its cache defaults,
 * and which service method it calls.
 *
 * The per-domain datafolder / contentfolder env vars are intentionally NOT set
 * here — they differ per project (design_solution_*, design_process_*,
 * design_infrastructure_*) and each step must set its own.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

/**
 * The ARIS connection credentials shared by every step, read from the
 * environment. Spread into a step's `settings` object, then add the
 * per-domain datafolder / contentfolder and cache settings.
 * @returns {{server: string, username: string, password: string, database: string}}
 */
function arisCredentials() {
    return {
        server: process.env.aris_server,
        username: process.env.aris_username,
        password: process.env.aris_password,
        database: encodeURIComponent('Acme Architecture Modeling'),
    };
}

/**
 * Authenticate against ARIS and store the token on the settings object.
 * Returns the raw authentication response (also used by the authToken step).
 * @param {object} settings - The step's settings (must carry the credentials)
 * @returns {Promise<object>} The authentication response ({ token, ... })
 */
async function authenticate(settings) {
    const AuthenticateClass = require('./Authenticate');
    const auth = new AuthenticateClass(settings);
    const response = await auth.authenticate();
    settings.token = response.token;
    return response;
}

module.exports = { arisCredentials, authenticate };
