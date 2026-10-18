/**
 * @fileoverview Headline banner API routes for the Wiki application.
 *
 * Backs a single, global, admin-maintained headline string stored on disk at
 *   <APP_BASE_DIR>/content/headline.txt
 * (relocated 2026-07-22 from <APP_BASE_DIR>/.system/.headline/headline.txt,
 * which is still read as a fallback — see shared/content/contentPaths.js)
 *
 * The headline drives the full-width announcement banner shown directly under
 * the topbar. Any authenticated user may READ it (to render the banner); only
 * users carrying the global 'admin' role may WRITE it (edited from the Profile
 * screen, alongside the help content).
 *
 * The headline is a plain single-line string. An empty string means "no
 * headline" — the banner is hidden. No default is ever seeded, so a fresh
 * install shows no banner until an admin sets one.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-26
 */

'use strict';

const path = require('node:path');
const { rolesOf } = require('../components/spacePermissions');
const { readContent, writeContent } = require('../../shared/content/contentPaths');

/** Collapse any whitespace (incl. stray newlines) to single spaces and trim. */
function oneLine(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/**
 * Registers the headline routes with the Express application.
 * @param {Object} options - { app }
 * @param {Object} eventEmitter
 * @param {Object} services - Core services (expects log, appBaseDir)
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.app;
  const { log, appBaseDir } = services;

  const dataDirectory = appBaseDir || path.join(process.cwd(), '.application');

  function isAdmin(req) {
    return req.isAuthenticated && req.isAuthenticated() && rolesOf(req.user).includes('admin');
  }

  // GET — read the headline. Any authenticated user (the global wiki-api guard
  // already rejects unauthenticated callers). Missing file → empty headline.
  app.get('/applications/wiki/api/headline', async (req, res) => {
    try {
      // Missing in both the canonical and legacy locations → empty headline,
      // which is a valid "no banner" state.
      const { content } = await readContent(dataDirectory, 'headline');
      res.json({ success: true, headline: oneLine(content || ''), canEdit: isAdmin(req) });
    } catch (err) {
      log.error('[headlineRoutes] GET failed:', err);
      res.status(500).json({ success: false, error: 'Failed to load headline' });
    }
  });

  // PUT — save the headline. Admin only. An empty value clears the banner.
  app.put('/applications/wiki/api/headline', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Admin role required' });
    }
    const { headline } = req.body || {};
    if (headline === undefined || headline === null) {
      return res.status(400).json({ success: false, error: 'headline is required' });
    }
    try {
      await writeContent(dataDirectory, 'headline', oneLine(headline));
      res.json({ success: true });
    } catch (err) {
      log.error('[headlineRoutes] PUT failed:', err);
      res.status(500).json({ success: false, error: 'Failed to save headline' });
    }
  });
};
