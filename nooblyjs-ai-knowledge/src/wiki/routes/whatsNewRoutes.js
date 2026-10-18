/**
 * @fileoverview "What's New" API routes for the Wiki application.
 *
 * Backs a single, global, admin-maintained markdown announcement stored on disk
 * at
 *   <APP_BASE_DIR>/content/whatsnew.md
 * (relocated 2026-07-22 from <APP_BASE_DIR>/.system/.whatsnew/whatsnew.md,
 * which is still read as a fallback — see shared/content/contentPaths.js)
 *
 * The content drives a centered "What's New" modal (same styling as the
 * onboarding wizard) shown to a user when they log in. Any authenticated user
 * may READ it; only users carrying the global 'admin' role may WRITE it (edited
 * from the Profile screen, alongside the help content).
 *
 * Each response carries a `version` — a short hash of the (trimmed) content.
 * The client remembers the version it last dismissed; the modal reappears only
 * when the version changes (i.e. an admin edited the message), then is
 * suppressed again once dismissed. Empty content → empty version → no modal.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-26
 */

'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { rolesOf } = require('../components/spacePermissions');
const { readContent, writeContent } = require('../../shared/content/contentPaths');

/** Content-derived version: a short sha1 of the trimmed content, or '' when
 *  there is no message to show. */
function versionOf(content) {
  const text = String(content == null ? '' : content).trim();
  if (!text) return '';
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 12);
}

/**
 * Registers the What's New routes with the Express application.
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

  // GET — read the What's New message. Any authenticated user (the global
  // wiki-api guard already rejects unauthenticated callers). Missing file →
  // empty message (a valid "nothing to announce" state — no default seeded).
  app.get('/applications/wiki/api/whats-new', async (req, res) => {
    try {
      // Missing in both the canonical and legacy locations → empty message,
      // a valid "nothing to announce" state (no default is ever seeded).
      const content = (await readContent(dataDirectory, 'whatsnew')).content || '';
      res.json({
        success: true,
        content,
        version: versionOf(content),
        canEdit: isAdmin(req)
      });
    } catch (err) {
      log.error('[whatsNewRoutes] GET failed:', err);
      res.status(500).json({ success: false, error: 'Failed to load What\'s New' });
    }
  });

  // PUT — save the What's New message. Admin only. An empty body clears it
  // (no modal will be shown until a new message is added).
  app.put('/applications/wiki/api/whats-new', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Admin role required' });
    }
    const { content } = req.body || {};
    if (content === undefined || content === null) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    try {
      await writeContent(dataDirectory, 'whatsnew', String(content));
      res.json({ success: true, version: versionOf(content) });
    } catch (err) {
      log.error('[whatsNewRoutes] PUT failed:', err);
      res.status(500).json({ success: false, error: 'Failed to save What\'s New' });
    }
  });
};
