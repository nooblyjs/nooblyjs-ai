'use strict';

/**
 * Datasources web frontend — mount module.
 *
 * Loaded by the root launcher (../../../app.js). Mounting is two-phase so the
 * canonical bundle wins over the backend's legacy ./views static mounts while
 * the API still wins over any SPA fallback:
 *   - serveStatic()      runs BEFORE the backend's init() (static bundle).
 *   - serveSpaFallback() runs AFTER init() (none here — datasources serves from
 *     its mount root, no client-side deep-link routing).
 */
const path = require('node:path');

module.exports = {
  /** @param {import('express').Express} app @param {typeof import('express')} express */
  serveStatic(app, express) {
    app.use('/applications/datasources', express.static(path.join(__dirname, 'public')));
  }
};
