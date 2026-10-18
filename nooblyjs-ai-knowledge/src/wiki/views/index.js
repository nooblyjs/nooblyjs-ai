/**
 * @fileoverview Wiki service views module for noobly framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the Wiki service. It registers static routes to serve
 * Wiki-related view files and templates through the Express application.
 * 
 * @author noobly Team
 * @version 1.0.0
 * @module Wiki
 */

'use strict';

const path = require('node:path');
const express = require('express');

/**
 * Wiki service views module for nnoobly framework.
 * This module provides Express.js view registration and static file serving 
 * capabilities for the Wiki service. It registers static routes to serve
 * Wiki-related view files and templates through the Express application.
 * 
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} services - noobly Core services (dataServe, filing, cache, logger, queue, search)
 * @returns {void}
 */
module.exports = (options, eventEmitter, services) => {

  const app = options.app;
  const { logger } = services;

  // Get authservice for auth middleware
  const authservice = app.get('authservice');

  // Check if authentication is required based on security config
  const securityConfig = app.get('securityConfig');
  const requireLogin = securityConfig?.servicesAuth?.requireLogin !== false;

  // Create authentication middleware that redirects unauthenticated users to login
  // Only apply if login is required (app-noauth.js disables this)
  if (requireLogin) {
    const requireAuth = authservice.createAuthMiddleware({
      loginPath: '/services/authservice/views/login.html',
      saveReferer: true
    });
    // Protect the wiki application with authentication middleware
    // Unauthenticated users will be redirected to login page with returnUrl parameter
    app.use('/applications/wiki', requireAuth, express.static(path.join(__dirname)));
  } else {
    // No authentication required - serve views directly
    app.use('/applications/wiki', express.static(path.join(__dirname)));
  }

};