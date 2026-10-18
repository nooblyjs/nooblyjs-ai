'use strict';

/**
 * Wiki web frontend — mount module.
 *
 * Loaded by the root launcher (../../../app.js). Mounting is two-phase:
 *   - serveStatic()      runs BEFORE the backend's init() so this bundle takes
 *     precedence over the wiki module's legacy ./views static mounts
 *     (src/wiki/initialize.js + views/index.js).
 *   - serveSpaFallback() runs AFTER init() so /applications/wiki/api/* (registered
 *     during init) is matched before the deep-link catch-all below.
 */
const path = require('node:path');

const publicDir = path.join(__dirname, 'public');

module.exports = {
  /** @param {import('express').Express} app @param {typeof import('express')} express */
  serveStatic(app, express) {
    app.use('/applications/wiki', express.static(publicDir));
  },

  /** @param {import('express').Express} app */
  serveSpaFallback(app) {
    // Serve index.html for extension-less /applications/wiki/* deep links so the
    // SPA can handle client-side routing. Static files (mounted above) and API
    // routes (registered by the backend) are matched first.
    app.get(/^\/applications\/wiki\/(?!.*\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|json|html)$)/, (req, res) => {
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }
};
