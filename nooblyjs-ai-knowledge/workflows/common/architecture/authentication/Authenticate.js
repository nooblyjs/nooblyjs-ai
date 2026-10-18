/**
 * @fileoverview Perform authentication methods.
 * @method authenticate : Authenticate agains the ARIS system by using the username and password and returning a token
 * @method isAuthenticated : Determine if a token is still valid
 *
 * @author NooblyJS Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';

const ModelBase = require('../models/modelBase');

/**
 * This class is used for authentication methods
 * 
 * @method authenticate - Authenticate the passed user. Note that this uses caching as the token is valid for 45mins
 * @method isAuthenticated - Check if the token is still valid. This methods querys the available databases to check if the token is valid
 */
class AuthenticateClass extends ModelBase {

    /**
     * Constructor
     */
    constructor(settings) {
        super(settings);
        this.settings = settings
    }

    /**
     * Authenticate against the ARIS system.
     *
     * @async
     * @function authenticate
     * @param refresh - Ignore the cached data and get a new token
     * @returns {Promise<Object>} A promise that resolves with a completion message object
     */
    async authenticate(refresh) {

        // Determine if the cached token can be used
        if (super.cacheExists('authtoken.json') && this.isAuthenticated() && !refresh) {
            let data = super.readCache('authtoken.json'); 
            return data;
        }

        // Re-authenticating token
        try {
            const response = await fetch(`http://${this.settings.server}/umc/api/v2/tokens?tenant=default&name=${this.settings.username}&password=${this.settings.password}`,
                {
                    method: 'POST'
                }
            );
            const data = await response.json()
            super.writeCache('authtoken.json', data)
            return data;
        }
        catch (error) {
            return error;
        }
    }

    /**
     * Verify the token
     * @async
     * @function  isAuthenticated
     * @returns {boolean} Check if the token is valid by calling the datbase endpoint
     */
    isAuthenticated() {

        // If there is no autoken then return false
        if (!super.cacheExists('authtoken.json')) {
            return false
        }

        // retrieve the cached token
        let token = super.readCache('authtoken.json')

        // if thre is no expiry or no token return false
        if (token.expires_in == null || token.token == null) {
            return false;
        }
        // Determine if the token is in the future
        if (Number(token.expires_in) < Math.floor(Date.now()/1000)) {
            return false
        } else {
            return true
        }
    }
}

module.exports = AuthenticateClass;
