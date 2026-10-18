/**
 * @fileoverview Documentation API routes for serving markdown documentation files
 * Provides endpoints for listing and retrieving documentation from /public/docs folder
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { containedPath, handlePathError, isInside } = require('../../shared/utils/pathSafety');

/**
 * Configures and registers documentation routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.app;
  const { log } = services;

  // Get docs directory path (both locations supported)
  let docsDir = path.join(process.cwd(), 'public', 'docs');
  if (!fs.existsSync(docsDir)) {
    docsDir = path.join(process.cwd(), 'docs');
  }

  /**
   * Load published documentation list from published.json
   * @returns {Array} Array of published filenames
   */
  const getPublishedDocs = () => {
    try {
      const publishedPath = path.join(docsDir, 'published.json');
      if (fs.existsSync(publishedPath)) {
        const content = fs.readFileSync(publishedPath, 'utf-8');
        const published = JSON.parse(content);
        return Array.isArray(published) ? published : [];
      }
    } catch (error) {
      log.warn('Error reading published.json:', error);
    }
    return [];
  };

  /**
   * GET /applications/wiki/api/documentation/list
   * Returns list of published documentation files with metadata
   */
  app.get('/applications/wiki/api/documentation/list', (req, res) => {
    try {
      if (!fs.existsSync(docsDir)) {
        return res.json({ success: false, docs: [] });
      }

      // Get list of published documents from published.json
      const publishedDocs = getPublishedDocs();
      const docs = [];

      // Only process published files
      publishedDocs.forEach(docEntry => {
        // Support both array of strings and array of objects with file/description
        const filename = typeof docEntry === 'string' ? docEntry : docEntry.file;
        const description = typeof docEntry === 'string' ? undefined : docEntry.description;

        let fileToProcess = filename;
        if (!fileToProcess.endsWith('.md')) {
          fileToProcess = fileToProcess + '.md';
        }

        const filePath = path.join(docsDir, fileToProcess);

        // Verify file exists and is within docs directory (published.json is
        // server-owned, but contain it anyway so a bad entry cannot escape).
        if (fs.existsSync(filePath) && isInside(docsDir, filePath)) {
          try {
            const stat = fs.statSync(filePath);

            if (stat.isFile()) {
              const content = fs.readFileSync(filePath, 'utf-8');

              // Extract first heading or first 200 chars for preview
              const headingMatch = content.match(/^#\s+(.+)$/m);
              const title = headingMatch ? headingMatch[1] : filename.replace(/\.md$/, '');

              // Get excerpt (first 200 chars without markdown syntax)
              const excerpt = content
                .replace(/[#*_\[\]()]/g, '')
                .substring(0, 200)
                .trim();

              docs.push({
                id: filename.replace(/\.md$/, ''),
                title: title,
                filename: fileToProcess,
                description: description || excerpt,
                excerpt: excerpt,
                size: stat.size,
                modified: stat.mtime
              });
            }
          } catch (error) {
            log.warn(`Error processing file ${filename}:`, error);
          }
        }
      });

      res.json({
        success: true,
        docs: docs.sort((a, b) => b.modified - a.modified)
      });
    } catch (error) {
      log.error('Error reading documentation directory:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /applications/wiki/api/documentation/:docId
   * Returns the full markdown content of a specific documentation file
   */
  app.get('/applications/wiki/api/documentation/:docId', (req, res) => {
    try {
      // A docId is a FLAT name, never a path: strip any directory component the
      // client tried to smuggle in, then confirm containment as a backstop.
      const docId = path.basename(String(req.params.docId));
      let docPath;
      try {
        docPath = containedPath(docsDir, `${docId}.md`);
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      if (!fs.existsSync(docPath)) {
        return res.status(404).json({ success: false, error: 'Documentation not found' });
      }

      const content = fs.readFileSync(docPath, 'utf-8');

      // Extract title from first heading
      const headingMatch = content.match(/^#\s+(.+)$/m);
      const title = headingMatch ? headingMatch[1] : docId;

      res.json({
        success: true,
        id: docId,
        title: title,
        content: content
      });
    } catch (error) {
      log.error('Error reading documentation file:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /applications/wiki/api/documentation/preview/:docId
   * Returns a preview (excerpt) of a documentation file without the full content
   */
  app.get('/applications/wiki/api/documentation/preview/:docId', (req, res) => {
    try {
      // A docId is a FLAT name, never a path (see the :docId route above).
      const docId = path.basename(String(req.params.docId));
      let docPath;
      try {
        docPath = containedPath(docsDir, `${docId}.md`);
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      if (!fs.existsSync(docPath)) {
        return res.status(404).json({ success: false, error: 'Documentation not found' });
      }

      const content = fs.readFileSync(docPath, 'utf-8');
      const stat = fs.statSync(docPath);

      // Extract title from first heading
      const headingMatch = content.match(/^#\s+(.+)$/m);
      const title = headingMatch ? headingMatch[1] : docId;

      // Get first 500 chars for preview (remove markdown syntax)
      const preview = content
        .replace(/[#*_\[\]()]/g, '')
        .substring(0, 500)
        .trim();

      res.json({
        success: true,
        id: docId,
        title: title,
        preview: preview,
        size: stat.size,
        modified: stat.mtime,
        wordCount: content.split(/\s+/).length
      });
    } catch (error) {
      log.error('Error reading documentation preview:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
};
