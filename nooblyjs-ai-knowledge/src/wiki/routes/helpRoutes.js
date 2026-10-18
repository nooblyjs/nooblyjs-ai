/**
 * @fileoverview Help system API routes for the Wiki application.
 *
 * Backs a single, global, admin-maintained help document stored on disk at
 *   <APP_BASE_DIR>/content/help.md
 * (relocated 2026-07-22 from <APP_BASE_DIR>/.system/.help/help.md, which is
 * still read as a fallback — see shared/content/contentPaths.js)
 *
 * Any authenticated user may READ the help (it drives the right-side help
 * drawer). Only users carrying the global 'admin' role may WRITE it (edited
 * from the Profile screen).
 *
 * An optional leading frontmatter block carries non-content settings (currently
 * just `support:` — the Contact-support button target). The frontmatter is
 * split off server-side so the drawer renders clean markdown and the editor
 * never has to round-trip the `---` delimiters; it is reassembled on save.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-25
 */

'use strict';

const path = require('node:path');
const { rolesOf } = require('../components/spacePermissions');
const { readContent, writeContent } = require('../../shared/content/contentPaths');

/** Default help seeded the first time the file is read. The view-named
 *  headings let the drawer's "Help for this page" matching work out of the box. */
const DEFAULT_HELP = `---
support: mailto:support@example.com
---

# noobly Wiki help

Welcome! This guide is maintained by your administrators. Use the search box
above to jump to a topic, or pick a heading from the list.

## Getting started

Browse spaces from the left navigation, open a document to read it, and use the
view switcher in the top bar to change how the workspace is laid out.

## Detailed view

The Detailed view shows the full space tree on the left so you can navigate
folders and documents directly.

## Content view

The Content view puts browsing first — cards and rails surface documents without
the full tree.

## Search view

The Search view starts you at the search bar. Type to find files, spaces and
people across the repository.

## Chat view

The Chat view gives you a full-page AI assistant grounded on your space.

## Pinning & bookmarking

Pin documents you return to often — they appear in your sidebar and on your
profile for one-click access.
`;

/**
 * Split a leading YAML-ish frontmatter block from raw file content.
 * Only simple `key: value` lines are understood (no nested YAML).
 * @param {string} raw
 * @returns {{ meta: Object, body: string }}
 */
function splitFrontmatter(raw) {
  let text = String(raw || '');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // strip UTF-8 BOM
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  m[1].split('\n').forEach((line) => {
    const mm = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (mm) meta[mm[1].toLowerCase()] = mm[2].trim();
  });
  return { meta, body: text.slice(m[0].length) };
}

/** Reassemble the on-disk file from a markdown body and optional support target. */
function buildFile(body, support) {
  const lines = [];
  if (support && String(support).trim()) lines.push(`support: ${String(support).trim()}`);
  const fm = lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
  return fm + (body || '');
}

/**
 * Registers the help routes with the Express application.
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

  // GET — read the help document. Any authenticated user (the global wiki-api
  // guard already rejects unauthenticated callers). Seeds a default on first read.
  app.get('/applications/wiki/api/help', async (req, res) => {
    try {
      // Canonical location, then the legacy one. Absent from both → seed the
      // default into the canonical location. A legacy file is left where it is
      // (the migration script relocates it); the next admin save moves it.
      let { content: raw } = await readContent(dataDirectory, 'help');
      if (raw === null) {
        await writeContent(dataDirectory, 'help', DEFAULT_HELP);
        raw = DEFAULT_HELP;
      }
      const { meta, body } = splitFrontmatter(raw);
      res.json({
        success: true,
        content: body,
        support: meta.support || '',
        canEdit: isAdmin(req)
      });
    } catch (err) {
      log.error('[helpRoutes] GET failed:', err);
      res.status(500).json({ success: false, error: 'Failed to load help' });
    }
  });

  // PUT — save the help document. Admin only.
  app.put('/applications/wiki/api/help', async (req, res) => {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, error: 'Admin role required' });
    }
    const { content, support } = req.body || {};
    if (content === undefined || content === null) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }
    try {
      await writeContent(dataDirectory, 'help', buildFile(content, support));
      res.json({ success: true });
    } catch (err) {
      log.error('[helpRoutes] PUT failed:', err);
      res.status(500).json({ success: false, error: 'Failed to save help' });
    }
  });
};
