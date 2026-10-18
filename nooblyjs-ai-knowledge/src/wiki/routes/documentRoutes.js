/**
 * @fileoverview Document API routes for Wiki application
 * Handles document CRUD operations, content management, and file operations
 *
 * @author noobly Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';
const path = require('node:path');
const mime = require('mime-types');
const annotationBlocks = require('../components/annotationBlocks');
const userContentBlocks = require('../components/userContentBlocks');
const { templateWriteCheck } = require('../components/spacePermissions');
const reviewBlocks = require('../components/reviewBlocks');
const linkedDocumentBlocks = require('../components/linkedDocumentBlocks');
const sharedLinkVisitBlocks = require('../components/sharedLinkVisitBlocks');
const { toOriginalsRelPath, toDerivedRelPath, needsMarkdownSidecar } = require('../../shared/utils/filePolicy');
const { toDocumentFileName, titleFromFileName, sanitizeFileName } = require('../../shared/utils/fileNaming');
const { ensureSidecar } = require('../utils/derivedSidecar');
const { readContentCache, writeContentCache } = require('../utils/documentContentCache');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');

/**
 * Configures and registers document routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services (dataManager, filing, cache, logger, queue, search)
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {

  const app = options.app;
  const { dataManager, filing, cache, log, queue, search, searchIndexer, documentService, appBaseDir } = services;
  const logger = log; // Alias for backward compatibility

  // Drop the derived caches that front the filesystem-backed document index so a
  // freshly created/changed/removed file is reflected on the next request.
  async function invalidateDocumentCaches(spaceId) {
    try {
      await cache.delete('wiki:documents:list');
      await cache.delete('wiki:documents:recent');
      await cache.delete('wiki:documents:popular');
      await cache.delete('wiki:recent:activity');
      if (spaceId != null && spaceId !== '') {
        await cache.delete(`wiki:space:${spaceId}:documents`);
        if (global.treeCache) global.treeCache.invalidate(parseInt(spaceId));
      }
    } catch (e) {
      logger.warn(`[documentRoutes] cache invalidation failed: ${e.message}`);
    }
  }

  /**
   * Helper function to resolve document paths using space configuration.
   *
   * Applies the space's allowedPaths/excludedPaths filter and throws PATH_HIDDEN
   * for a path the space does not expose.
   *
   * ENFORCEMENT IS ON BY DEFAULT. It used to be opt-in, on the reasoning that
   * "only the read endpoints enforce it for now" — and five endpoints then never
   * opted in, among them `PUT /documents/content` and `POST /documents`. On a
   * shared content root (four spaces sit on `knowledge-content/engineering`) that
   * let a curated space overwrite and create documents anywhere in the root,
   * including subtrees it deliberately does not show. Opting IN to an access
   * boundary means every endpoint written afterwards has to remember it; opting
   * OUT means forgetting is safe and reaching a hidden path is the thing you
   * have to justify.
   *
   * Pass `enforceVisibility: false` only where reaching a hidden path is the
   * point, and say why at the call site.
   *
   * @param {string} spaceName
   * @param {string} documentPath - space-relative (or legacy absolute) path
   * @param {string} appBaseDir
   * @param {{enforceVisibility?: boolean}} [options]
   */
  async function getDocumentAbsolutePath(spaceName, documentPath, appBaseDir, options = {}) {
    // Direct file read to get spaces (bypass dataManager which may not have correct base directory)
    const fs = require('node:fs').promises;
    const spacesPath = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
    const spacesData = await fs.readFile(spacesPath, 'utf8');
    const spaces = JSON.parse(spacesData);
    const space = spaces.find(s => s.name === spaceName);

    if (!space) {
      throw new Error('Space not found');
    }

    let documentsDir, absolutePath;

    if (space.path || space.configuration?.filing?.baseDir) {
      // Use the absolute path from space configuration
      documentsDir = space.path || space.configuration.filing.baseDir;

      // Check if documentPath is already absolute (legacy documents)
      if (path.isAbsolute(documentPath)) {
        absolutePath = documentPath;
      } else {
        // documentPath is relative to space directory
        absolutePath = path.resolve(documentsDir, documentPath);
      }
    } else {
      // Fallback to old behavior for backward compatibility
      documentsDir = path.resolve(__dirname, '../../../documents');
      absolutePath = path.resolve(documentsDir, spaceName, documentPath);
    }

    // Security check: ensure the path is within the designated space directory
    // Normalize both paths to ensure consistent comparison
    const normalizedAbsolutePath = path.normalize(absolutePath);
    const normalizedDocumentsDir = path.normalize(documentsDir);

    // Check if the absolute path is within the documents directory
    // Use relative path to verify - if it starts with '..', it's outside
    const relativePath = path.relative(normalizedDocumentsDir, normalizedAbsolutePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('Access denied: path outside space directory');
    }

    // Per-space curation: the path is inside the space's content root, but the
    // space may not EXPOSE it (allowedPaths / excludedPaths). Checked against
    // the space-relative path, which is what the rules are written in.
    if (options.enforceVisibility !== false) {
      const visibility = compileVisibility(space);
      if (visibility.restricted && !visibility.isFileVisible(relativePath)) {
        const error = new Error('Not found');
        error.code = 'PATH_HIDDEN';
        throw error;
      }
    }

    return { documentsDir: normalizedDocumentsDir, absolutePath: normalizedAbsolutePath };
  }

  /**
   * Map a path-resolution failure onto a response.
   *
   * A path the space hides answers 404 with no detail — telling the caller
   * "access denied" would confirm that the document exists, which is exactly
   * what a curated space is hiding. Returns true when handled.
   */
  function handleHiddenPath(res, error) {
    if (error && error.code === 'PATH_HIDDEN') {
      // `success:false` as well as `error` so this fits both response shapes in
      // this file — the older routes answer { error }, the newer ones
      // { success, message }. A caller checking either field sees a clean miss.
      res.status(404).json({ success: false, error: 'Document not found', message: 'Document not found' });
      return true;
    }
    return false;
  }

  // Utility function to determine file category and viewer type
  function getFileTypeInfo(filePath, mimeType) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);

    // File category mappings
    const categories = {
      // PDF files
      pdf: {
        category: 'pdf',
        viewer: 'pdf',
        extensions: ['.pdf'],
        mimes: ['application/pdf']
      },

      // Images
      image: {
        category: 'image',
        viewer: 'image',
        extensions: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico'],
        mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/svg+xml', 'image/webp', 'image/x-icon']
      },

      // Text files
      text: {
        category: 'text',
        viewer: 'text',
        extensions: ['.txt', '.csv', '.dat', '.log', '.ini', '.cfg', '.conf'],
        mimes: ['text/plain', 'text/csv']
      },

      // Markdown
      markdown: {
        category: 'markdown',
        viewer: 'markdown',
        extensions: ['.md', '.markdown'],
        mimes: ['text/markdown']
      },

      // Code files
      code: {
        category: 'code',
        viewer: 'code',
        extensions: ['.js', '.ts', '.jsx', '.tsx', '.vue', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.go', '.rs', '.swift', '.kt', '.scala', '.r', '.m', '.mm', '.pl', '.sh', '.bash', '.ps1', '.bat', '.cmd'],
        mimes: ['text/javascript', 'application/javascript', 'text/typescript', 'text/x-python', 'text/x-java-source', 'text/x-c', 'text/x-c++', 'text/x-csharp']
      },

      // Web files (HTML, CSS)
      web: {
        category: 'web',
        viewer: 'code',
        extensions: ['.html', '.htm', '.css', '.scss', '.sass', '.less'],
        mimes: ['text/html', 'text/css']
      },

      // Data/Configuration files
      data: {
        category: 'data',
        viewer: 'code',
        extensions: ['.json', '.xml', '.yaml', '.yml', '.toml', '.properties'],
        mimes: ['application/json', 'application/xml', 'text/xml', 'application/yaml', 'application/x-yaml']
      }
    };

    // Check by extension first, then MIME type
    for (const [key, info] of Object.entries(categories)) {
      if (info.extensions.includes(ext) || info.mimes.includes(mimeType)) {
        return {
          category: info.category,
          viewer: info.viewer,
          extension: ext,
          mimeType: mimeType,
          fileName: fileName
        };
      }
    }

    // Default fallback
    return {
      category: 'other',
      viewer: 'default',
      extension: ext,
      mimeType: mimeType,
      fileName: fileName
    };
  }

  // Get all documents
  app.get('/applications/wiki/api/documents', async (req, res) => {
    try {
      // Check cache first
      const cacheKey = 'wiki:documents:list';
      let documents = await cache.get(cacheKey);

      if (!documents) {
        // Load from dataServe using the new container-based approach
        try {
          documents = await documentService.listAll();

          // Cache for 5 minutes
          await cache.put(cacheKey, documents, 300);
          logger.info(`Loaded ${documents.length} documents from filing service and cached`);
        } catch (error) {
          logger.warn('Could not load documents from filing service:', error.message);
          documents = [];
        }
      } else {
        logger.info('Loaded documents from cache');
      }

      res.json(documents);
    } catch (error) {
      logger.error('Error fetching documents:', error);
      res.status(500).json({ error: 'Failed to fetch documents' });
    }
  });

  // Get recent activity (documents and spaces)
  app.get('/applications/wiki/api/recent', async (req, res) => {
    try {
      const cacheKey = 'wiki:recent:activity';
      let recent = await cache.get(cacheKey);

      if (!recent) {
        const documents = await documentService.listAll();
        const spaces = await dataManager.read('spaces');

        // Combine and sort by modification date
        const recentItems = [
          ...documents.map(doc => ({ ...doc, type: 'document' })),
          ...spaces.map(space => ({ ...space, type: 'space' }))
        ].sort((a, b) => new Date(b.modifiedAt || b.updatedAt) - new Date(a.modifiedAt || a.updatedAt))
         .slice(0, 10);

        recent = recentItems;
        await cache.put(cacheKey, recent, 300); // 5 minutes
        logger.info('Generated recent activity list');
      }

      res.json(recent);
    } catch (error) {
      logger.error('Error fetching recent activity:', error);
      res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
  });

  // Read document content by file path (must be before :id route)
  app.get('/applications/wiki/api/documents/content', async (req, res) => {
    try {
      const { path: documentPath, spaceName, metadata, download } = req.query;

      if (!documentPath || !spaceName) {
        return res.status(400).json({ error: 'Document path and space name are required' });
      }

      let documentsDir, absolutePath;
      try {
        ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(
          spaceName, documentPath, appBaseDir, { enforceVisibility: true }));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        logger.warn(`Path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          error: pathError.message
        });
      }

      try {
        const fs = require('node:fs').promises;
        const fsSync = require('fs');
        const stats = await fs.stat(absolutePath);
        const contentType = mime.lookup(absolutePath) || 'application/octet-stream';
        const fileTypeInfo = getFileTypeInfo(documentPath, contentType);

        // If only metadata is requested, return file info without content
        if (metadata === 'true') {
          return res.json({
            ...fileTypeInfo,
            size: stats.size,
            modified: stats.mtime,
            created: stats.birthtime,
            path: documentPath,
            spaceName: spaceName
          });
        }

        // Determine encoding based on file category
        let encoding = null;
        const isTextBased = ['text', 'markdown', 'code', 'web', 'data'].includes(fileTypeInfo.category) ||
            contentType.startsWith('text/') ||
            contentType === 'application/json' ||
            contentType === 'application/xml';

        if (isTextBased) {
          encoding = 'utf8';
        }

        // Check cache for text-based files. A hit only counts when it still
        // matches this file's mtime/size — the key is a path, but one physical
        // file can have several paths in a symlinked space (see
        // utils/documentContentCache.js).
        const cacheKey = `${spaceName}-${documentPath}`;
        let content = null;

        if (isTextBased && !download) {
          content = await readContentCache(cache, cacheKey, stats);
        }

        // Return enhanced response with metadata
        if (req.query.enhanced === 'true') {
          // Not cached, or the file changed under it — read from the file system.
          if (content === null) {
            content = await fs.readFile(absolutePath, { encoding });

            if (isTextBased && encoding) {
              await writeContentCache(cache, cacheKey, content, stats);
            }
          }

          res.json({
            content: encoding ? content : content.toString('base64'),
            metadata: {
              ...fileTypeInfo,
              size: stats.size,
              modified: stats.mtime,
              created: stats.birthtime,
              path: documentPath,
              spaceName: spaceName,
              encoding: encoding || 'base64'
            }
          });
        } else {
          // Handle streaming for binary files (video, audio, images, etc.)
          // This supports HTTP Range requests for seeking in video/audio
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', stats.size);
          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Cache-Control', 'public, max-age=86400');

          // Handle download functionality
          if (download === 'true') {
            res.setHeader('Content-Disposition', `attachment; filename="${fileTypeInfo.fileName}"`);
          }

          // Handle Range requests (essential for video/audio seeking)
          const range = req.headers.range;
          if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
            const chunksize = (end - start) + 1;

            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
            res.setHeader('Content-Length', chunksize);

            const stream = fsSync.createReadStream(absolutePath, { start: start, end: end });
            stream.pipe(res);
          } else {
            // No range request - send entire file
            const stream = fsSync.createReadStream(absolutePath);
            stream.pipe(res);
          }
        }
      } catch (fileError) {
        // Use debug level for ENOENT (expected for optional files like .aicontext)
        if (fileError.code === 'ENOENT') {
          logger.debug?.(`File not found: ${documentPath}`) || logger.info(`File not found: ${documentPath}`);
        } else {
          logger.warn(`Failed to read file ${documentPath}: ${fileError.message}`);
        }

        if (metadata === 'true' || req.query.enhanced === 'true') {
          return res.status(404).json({
            error: 'File not found',
            message: `The file ${documentPath} could not be found or read.`,
            details: fileError.message
          });
        }

        // Return a friendly error message as markdown content
        const errorContent = `# File Not Found\n\nThe requested document \
${documentPath}\
 could not be found or read.\n\n**Possible reasons:**\n- File has been moved or deleted\n- Permission issues\n- File path is incorrect\n\nPlease check the file location and try again.`;

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(404).send(errorContent);
      }
    } catch (error) {
      logger.error('Error in document content endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Generate PDF preview thumbnail
  app.get('/applications/wiki/api/documents/pdf-preview', async (req, res) => {
    try {
      const { path: documentPath, spaceName, page = 1 } = req.query;

      if (!documentPath || !spaceName) {
        return res.status(400).json({ error: 'Document path and space name are required' });
      }

      logger.info(`Generating PDF preview for: ${documentPath} in space: ${spaceName}`);

      let documentsDir, absolutePath;
      try {
        ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(
          spaceName, documentPath, appBaseDir, { enforceVisibility: true }));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        logger.warn(`Path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          error: pathError.message
        });
      }

      // Verify it's a PDF file
      const ext = path.extname(absolutePath).toLowerCase();
      if (ext !== '.pdf') {
        return res.status(400).json({ error: 'File is not a PDF' });
      }

      try {
        const fs = require('node:fs').promises;
        const { pdf } = require('pdf-to-img');

        // Check if file exists
        await fs.stat(absolutePath);

        // Generate preview thumbnail (first page, scale 2 for quality)
        const document = await pdf(absolutePath, { scale: 2 });
        const pageBuffer = await document.getPage(parseInt(page));

        // Send the image
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(pageBuffer);

        logger.info(`Successfully generated PDF preview for ${documentPath}`);
      } catch (error) {
        logger.error(`Failed to generate PDF preview: ${error.message}`);
        res.status(500).json({
          error: 'Failed to generate PDF preview',
          message: error.message
        });
      }
    } catch (error) {
      logger.error('Error in PDF preview endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get recent documents
  app.get('/applications/wiki/api/documents/recent', async (req, res) => {
    try {
      const cacheKey = 'wiki:documents:recent';
      let recentDocs = await cache.get(cacheKey);

      if (!recentDocs) {
        const documents = await documentService.listAll();
        recentDocs = documents
          .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
          .slice(0, 10);

        await cache.put(cacheKey, recentDocs, 300); // 5 minutes
        logger.info('Generated recent documents list');
      }

      res.json(recentDocs);
    } catch (error) {
      logger.error('Error fetching recent documents:', error);
      res.status(500).json({ error: 'Failed to fetch recent documents' });
    }
  });

  // Get popular documents
  app.get('/applications/wiki/api/documents/popular', async (req, res) => {
    try {
      const cacheKey = 'wiki:documents:popular';
      let popularDocs = await cache.get(cacheKey);

      if (!popularDocs) {
        // Views are no longer tracked (no JSON index); use most-recently modified.
        const documents = await documentService.listAll();
        popularDocs = documents
          .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt))
          .slice(0, 10);

        await cache.put(cacheKey, popularDocs, 600); // 10 minutes - less frequent updates
        logger.info('Generated popular documents list');
      }

      res.json(popularDocs);
    } catch (error) {
      logger.error('Error fetching popular documents:', error);
      res.status(500).json({ error: 'Failed to fetch popular documents' });
    }
  });

  // ==========================================================================
  // Derived markdown sidecar — read/write the extracted text of a binary doc
  // ==========================================================================
  //
  // A PDF is shown, linked and downloaded as itself, but everything that reads
  // its TEXT — search, AI context, chat grounding — reads
  // `<its folder>/.system/derived/<name>.pdf.md` instead (see filePolicy.js).
  // Extraction is automatic and imperfect: a scanned page, a multi-column layout
  // or a table can come out garbled, and until now there was no way to correct it
  // short of editing the file on the server's disk.
  //
  // These two routes address the sidecar by its ORIGINAL document's path, so no
  // caller has to know the `.system/derived/<name>.<ext>.md` naming rule — that
  // stays owned by filePolicy.
  //
  // Both resolve the ORIGINAL through getDocumentAbsolutePath with
  // enforceVisibility, so a document a space curates away cannot have its
  // extracted text read or rewritten through the side door.

  /**
   * Resolve a request's original-document path to its sidecar, applying every
   * check both routes share. Writes the error response itself and returns null
   * when the request cannot proceed.
   * @returns {Promise<{originalAbs: string, sidecarAbs: string, sidecarRel: string, spaceRoot: string}|null>}
   */
  async function resolveDerivedTarget(req, res, documentPath, spaceName) {
    if (!documentPath || !spaceName) {
      res.status(400).json({ error: 'Document path and space name are required' });
      return null;
    }

    // Only files whose policy says their text lives in a sidecar — PDFs and
    // office documents. Asking for the "derived content" of a markdown page is a
    // caller bug, not an empty result.
    if (!needsMarkdownSidecar(documentPath)) {
      res.status(400).json({
        error: 'This document type has no derived markdown',
        detail: `${path.extname(documentPath) || 'This file'} is indexed and displayed from its own content.`
      });
      return null;
    }

    let documentsDir, absolutePath;
    try {
      ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(
        spaceName, documentPath, appBaseDir, { enforceVisibility: true }));
    } catch (pathError) {
      if (handleHiddenPath(res, pathError)) return null;
      logger.warn(`Path resolution failed: ${pathError.message}`);
      res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
        error: pathError.message
      });
      return null;
    }

    // The sidecar is derived from the ORIGINAL's space-relative path, so compute
    // it from that rather than from whatever the caller sent (which may be a
    // legacy absolute path).
    const originalRel = path.relative(documentsDir, absolutePath).replace(/\\/g, '/');
    const sidecarRel = toDerivedRelPath(originalRel);

    return {
      originalAbs: absolutePath,
      originalRel,
      sidecarAbs: path.join(documentsDir, sidecarRel),
      sidecarRel,
      spaceRoot: documentsDir
    };
  }

  /**
   * Read the derived markdown for a binary document.
   *
   * `exists: false` is a normal answer, not an error — the sidecar may never have
   * been generated (`.pptx` has no Node-side converter) or extraction may have
   * failed. The editor opens on an empty document in that case, and saving
   * creates the file.
   */
  app.get('/applications/wiki/api/documents/derived', async (req, res) => {
    try {
      const { path: documentPath, spaceName } = req.query;
      const target = await resolveDerivedTarget(req, res, documentPath, spaceName);
      if (!target) return;

      const fs = require('node:fs').promises;
      let content = '';
      let exists = false;
      let modified = null;

      try {
        content = await fs.readFile(target.sidecarAbs, 'utf8');
        const stats = await fs.stat(target.sidecarAbs);
        exists = true;
        modified = stats.mtime;
      } catch (readError) {
        if (readError.code !== 'ENOENT') {
          logger.warn(`Could not read derived markdown for ${documentPath}: ${readError.message}`);
        }
      }

      // Whether the extraction predates the source, which is the usual reason
      // the text on screen doesn't match the PDF.
      let sourceModified = null;
      try {
        sourceModified = (await fs.stat(target.originalAbs)).mtime;
      } catch { /* the original may be gone; not this route's problem */ }

      // Never cached: the point of this view is to show what is on disk right
      // now, including edits another tab or a rebuild just made.
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        success: true,
        exists,
        content,
        path: documentPath,
        spaceName,
        derivedPath: target.sidecarRel,
        modified,
        sourceModified,
        stale: !!(exists && modified && sourceModified && sourceModified > modified)
      });
    } catch (error) {
      logger.error('Error reading derived markdown:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Save hand-corrected derived markdown.
   *
   * Re-indexing here is MANDATORY, not an optimisation. `.system` is in the file
   * watcher's IGNORED_SEGMENT (it has to be — the watcher writes sidecars itself,
   * and watching them would loop), so writing this file raises no event and
   * nothing else would ever notice. Without the explicit call the user's
   * correction sits on disk while search keeps answering from the old text.
   *
   * The search entry is keyed by the ORIGINAL's path, so re-indexing that path is
   * what refreshes it — the sidecar is never a document in its own right.
   *
   * Writing also makes the sidecar newer than its source, so the indexer's
   * staleness check treats it as current and a later rebuild will not overwrite
   * the correction. Editing the PDF itself still supersedes it, which is right.
   */
  app.put('/applications/wiki/api/documents/derived', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to edit derived content'
        });
      }

      const { path: documentPath, spaceName, content } = req.body;
      if (content === undefined || content === null) {
        return res.status(400).json({ error: 'Content is required' });
      }

      const target = await resolveDerivedTarget(req, res, documentPath, spaceName);
      if (!target) return;

      const fs = require('node:fs').promises;
      await fs.mkdir(path.dirname(target.sidecarAbs), { recursive: true });
      await fs.writeFile(target.sidecarAbs, String(content), 'utf8');
      const stats = await fs.stat(target.sidecarAbs);

      logger.info(`Saved derived markdown for ${spaceName}/${target.originalRel}`);

      // Push the correction into the live search index (see the note above).
      let reindexed = false;
      if (searchIndexer && typeof searchIndexer.updateFileInSpace === 'function') {
        try {
          await searchIndexer.updateFileInSpace(spaceName, target.originalRel);
          reindexed = true;
        } catch (indexError) {
          logger.warn(`Could not re-index ${target.originalRel} after a derived-content edit: ${indexError.message}`);
        }
      }

      // Search responses are cached for 5 minutes; drop them so the next query
      // sees the corrected text rather than a cached page of old hits.
      if (cache) {
        await cache.delete('wiki:search:*').catch(() => {});
        await cache.delete('wiki:suggestions:*').catch(() => {});
      }

      res.json({
        success: true,
        path: documentPath,
        derivedPath: target.sidecarRel,
        modified: stats.mtime,
        size: stats.size,
        reindexed
      });
    } catch (error) {
      logger.error('Error saving derived markdown:', error);
      res.status(500).json({ error: 'Failed to save derived content' });
    }
  });

  /**
   * Re-extract the sidecar from its source, discarding whatever is there.
   *
   * The escape hatch for the other direction: a correction that went wrong, or a
   * sidecar produced by an older/worse converter. `force` is required because a
   * hand-edited sidecar is newer than its source and would otherwise be judged
   * current and left alone.
   */
  app.post('/applications/wiki/api/documents/derived/regenerate', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to regenerate derived content'
        });
      }

      const { path: documentPath, spaceName } = req.body;
      const target = await resolveDerivedTarget(req, res, documentPath, spaceName);
      if (!target) return;

      const result = await ensureSidecar(target.spaceRoot, target.originalRel, { force: true, log: logger });
      if (!result.written) {
        return res.status(422).json({
          success: false,
          error: result.error || `Could not extract text from this document (${result.status})`
        });
      }

      const fs = require('node:fs').promises;
      const content = await fs.readFile(target.sidecarAbs, 'utf8');

      if (searchIndexer && typeof searchIndexer.updateFileInSpace === 'function') {
        await searchIndexer.updateFileInSpace(spaceName, target.originalRel).catch(() => {});
      }
      if (cache) {
        await cache.delete('wiki:search:*').catch(() => {});
        await cache.delete('wiki:suggestions:*').catch(() => {});
      }

      logger.info(`Regenerated derived markdown for ${spaceName}/${target.originalRel}`);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, content, derivedPath: target.sidecarRel });
    } catch (error) {
      logger.error('Error regenerating derived markdown:', error);
      res.status(500).json({ error: 'Failed to regenerate derived content' });
    }
  });

  // NOTE: the legacy numeric-id routes (GET /documents/:id and PUT /documents)
  // were removed. Documents are addressed by path and stored on disk via the
  // filing service; read and save content through GET/PUT /documents/content.

  // Save document content by file path
  app.put('/applications/wiki/api/documents/content', async (req, res) => {
    try {
      // Require authentication to save document content
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to save documents'
        });
      }

      const { path: documentPath, spaceName, content } = req.body;

      if (!documentPath || !spaceName || content === undefined) {
        return res.status(400).json({ error: 'Document path, space name, and content are required' });
      }

      // RBAC for template writes: space-level templates require a space admin;
      // personal templates require the path's owner to be the caller.
      {
        const spaces = await dataManager.read('spaces').catch(() => []);
        const space = spaces.find(s => s.name === spaceName) || null;
        const tplCheck = templateWriteCheck(req.user, space, documentPath);
        if (!tplCheck.allowed) {
          return res.status(403).json({ error: tplCheck.reason });
        }
      }

      logger.info(`Saving document content to path: ${documentPath} in space: ${spaceName}`);

      let documentsDir, absolutePath;
      try {
        ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(spaceName, documentPath, appBaseDir));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        logger.warn(`Path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          error: pathError.message
        });
      }

      try {
        const fs = require('node:fs').promises;

        // Ensure the directory exists
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });

        // Carry inline annotations over when content is regenerated wholesale
        // (e.g. a workflow rewrite). Interactive saves round-trip the blocks,
        // so the Id-dedupe inside preserveAnnotations makes this a no-op there.
        // Best-effort — a failure here must never block a save.
        let finalContent = content;
        const ext = path.extname(documentPath).toLowerCase();
        if (ext === '.md' || ext === '.markdown') {
          const previous = await fs.readFile(absolutePath, 'utf8').catch(() => '');
          try {
            if (previous && previous.includes('```annotation')) {
              const { content: merged, reanchored, orphaned } = annotationBlocks.preserveAnnotations(previous, finalContent);
              finalContent = merged;
              if (reanchored.length || orphaned.length) {
                logger.info(`[Annotations] preserved on save of ${documentPath}: ${reanchored.length} re-anchored, ${orphaned.length} orphaned`);
              }
            }
          } catch (preserveErr) {
            logger.warn(`[Annotations] preserve failed for ${documentPath}: ${preserveErr.message}`);
          }
          // Carry inline "Add Content" contributions across a wholesale rewrite,
          // exactly like annotations (Id-dedupe makes interactive saves a no-op).
          try {
            if (previous && previous.includes('```user-content')) {
              const { content: merged, reanchored, orphaned } = userContentBlocks.preserveUserContent(previous, finalContent);
              finalContent = merged;
              if (reanchored.length || orphaned.length) {
                logger.info(`[UserContent] preserved on save of ${documentPath}: ${reanchored.length} re-anchored, ${orphaned.length} orphaned`);
              }
            }
          } catch (preserveErr) {
            logger.warn(`[UserContent] preserve failed for ${documentPath}: ${preserveErr.message}`);
          }
          // Likewise carry the ```reviews``` block across a wholesale rewrite.
          try {
            if (previous && previous.includes('```reviews')) {
              const { content: merged, carried } = reviewBlocks.preserveReviews(previous, finalContent);
              finalContent = merged;
              if (carried) logger.info(`[Reviews] preserved on save of ${documentPath}: ${carried} carried`);
            }
          } catch (preserveErr) {
            logger.warn(`[Reviews] preserve failed for ${documentPath}: ${preserveErr.message}`);
          }
          // And the ```linked-documents``` block. These are hand-curated
          // relationships, most often authored on a folder home — exactly the
          // kind of page a workflow regenerates wholesale — so without this a
          // single rebuild silently erases them.
          try {
            if (previous && previous.includes('```linked-documents')) {
              const { content: merged, carried } = linkedDocumentBlocks.preserveLinkedDocuments(previous, finalContent);
              finalContent = merged;
              if (carried) logger.info(`[LinkedDocuments] preserved on save of ${documentPath}: ${carried} carried`);
            }
          } catch (preserveErr) {
            logger.warn(`[LinkedDocuments] preserve failed for ${documentPath}: ${preserveErr.message}`);
          }
        }

        // Write the file content
        await fs.writeFile(absolutePath, finalContent, 'utf8');

        // Update cache for text-based files
        const fileTypeInfo = getFileTypeInfo(documentPath, mime.lookup(absolutePath) || 'text/plain');
        const isTextBased = ['text', 'markdown', 'code', 'web', 'data'].includes(fileTypeInfo.category);

        if (isTextBased) {
          const cacheKey = `${spaceName}-${documentPath}`;
          // Stamp the entry with the file we just wrote, so the read path can
          // confirm it is still current (see utils/documentContentCache.js).
          await writeContentCache(cache, cacheKey, finalContent, await fs.stat(absolutePath));
          logger.info(`Updated cache after save: ${cacheKey}`);
        }

        // Get file stats for response
        const stats = await fs.stat(absolutePath);

        logger.info(`Successfully saved document to ${documentPath}`);

        // Emit event through EventBus for document update
        if (global.eventBus) {
          const spaces = await dataManager.read('spaces');
          const space = spaces.find(s => s.name === spaceName);
          global.eventBus.emitChange('update', 'file', {
            spaceId: space?.id || null,
            spaceName: spaceName,
            name: path.basename(documentPath),
            path: documentPath,
            modified: stats.mtime.toISOString(),
            size: stats.size,
            source: 'api',
            userId: req.user?.id || req.user?.username || 'unknown',
            userName: req.user?.username || 'unknown'
          });
        }

        // Update search index for searchable files
        if (isTextBased) {
          // Clear search cache to refresh results
          await cache.delete('wiki:search:*');

          // Re-index this document in the LIVE index. (This previously built a
          // throwaway SearchIndexer with no token service or filing wrapper —
          // it indexed into a private in-memory map and discarded it, so the
          // live index never saw the save.)
          if (searchIndexer) {
            setImmediate(() => {
              searchIndexer.updateFileInSpace(spaceName, documentPath).catch(indexError => {
                logger.warn('Failed to update search index for saved file:', indexError.message);
              });
            });
          }
        }

        res.json({
          success: true,
          message: 'File saved successfully',
          metadata: {
            size: stats.size,
            modified: stats.mtime,
            path: documentPath,
            spaceName: spaceName
          }
        });
      } catch (fileError) {
        logger.error(`Failed to save file ${documentPath}:`, fileError);
        res.status(500).json({
          error: 'Failed to save file',
          message: fileError.message
        });
      }
    } catch (error) {
      logger.error('Error in save document content endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Append a deep-link visit to a single rolling ```SharedLinkVisits``` block at EOF.
  // Creates the block if absent, appends a line if present. Markdown only.
  app.post('/applications/wiki/api/documents/share-visit', async (req, res) => {
    try {
      const { spaceName, path: documentPath, sharedBy } = req.body || {};

      if (!spaceName || !documentPath) {
        return res.status(400).json({ success: false, message: 'spaceName and path are required' });
      }

      if (!/\.(md|markdown)$/i.test(documentPath)) {
        return res.json({ success: true, skipped: 'non-markdown' });
      }

      const visitor = req.user?.email || req.user?.username || 'anonymous';
      const sharedByValue = (typeof sharedBy === 'string' && sharedBy.trim())
        ? sharedBy.trim()
        : '(direct)';
      const timestamp = new Date().toISOString();
      const line = `${timestamp}  ${visitor}  (sharedBy: ${sharedByValue})`;

      let absolutePath;
      try {
        ({ absolutePath } = await getDocumentAbsolutePath(spaceName, documentPath, appBaseDir));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          success: false, message: pathError.message
        });
      }

      const fs = require('node:fs').promises;
      let content;
      try {
        content = await fs.readFile(absolutePath, 'utf8');
      } catch (readErr) {
        if (readErr.code === 'ENOENT') {
          return res.status(404).json({ success: false, message: 'Document not found' });
        }
        throw readErr;
      }

      // COALESCE, don't append. A wholesale rewrite by a content workflow (or a
      // hand edit) can leave SEVERAL SharedLinkVisits blocks behind, and a
      // first-match append then grows whichever comes first while the rest sit
      // there — the page renders a stack of identical collapsed "Shared link
      // visits" strips, and the duplicate entries feed search and AI context as
      // noise. See components/sharedLinkVisitBlocks.js.
      const { content: updated, merged } = sharedLinkVisitBlocks.recordVisit(content, line);
      if (merged) {
        logger.info(`[SharedLinkVisits] merged ${merged} duplicate block(s) in ${spaceName}/${documentPath}`);
      }

      await fs.writeFile(absolutePath, updated, 'utf8');

      const cacheKey = `${spaceName}-${documentPath}`;
      try { await writeContentCache(cache, cacheKey, updated, await fs.stat(absolutePath)); } catch (_) { /* non-fatal */ }

      logger.info(`Logged share-link visit: ${spaceName}/${documentPath} visitor=${visitor} sharedBy=${sharedByValue}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Error logging share-link visit:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Enhanced document creation to support templates and folder paths
  app.post('/applications/wiki/api/documents', async (req, res) => {
    try {
      // Require authentication to create documents
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to create documents'
        });
      }
      const { title, content, spaceId, tags, folderPath, template, path: documentPath, fileName } = req.body;

      // `fileName` is the name the user TYPED and is honoured verbatim; `title`
      // is display text. They were one field, which is how the slug below came
      // to rename files — see shared/utils/fileNaming.js. An explicit `path`
      // needs neither: it already says where the document goes, and its title
      // falls back to the base name.
      if (!fileName && !title && !documentPath) {
        return res.status(400).json({ success: false, message: 'Document name is required' });
      }

      // Find space name if spaceId provided
      let spaceName = 'Personal';
      let space = null;
      if (spaceId) {
        const spaces = await dataManager.read('spaces');
        space = spaces.find(s => s.id === parseInt(spaceId)) || null;
        spaceName = space ? space.name : 'Unknown Space';
      }

      // Determine the file path - if it's a template, use the provided path
      let finalPath = documentPath;
      let finalContent = content;
      let documentTitle = title;

      if (!finalPath) {
        // Build the path from the name the user typed and the folder they chose.
        //
        // This used to slugify the title — lowercase, non-alphanumerics to
        // hyphens — which meant `.Engineering.md` was written as `engineering.md`.
        // A file name is not a URL slug: case, spaces and above all the LEADING
        // DOT are part of the identity the user asked for, and a hidden
        // `.<space>.md` at the root is how each space sharing a content root
        // keeps its own landing page. So the name is now taken as typed and only
        // genuinely unstorable names are rejected.
        let safeName;
        try {
          safeName = toDocumentFileName(fileName || title);
        } catch (nameError) {
          if (nameError.code === 'INVALID_FILE_NAME') {
            return res.status(400).json({ success: false, message: nameError.message });
          }
          throw nameError;
        }
        finalPath = folderPath ? `${folderPath}/${safeName}` : safeName;
        if (!documentTitle) documentTitle = titleFromFileName(safeName);
      }

      if (!documentTitle) documentTitle = path.basename(finalPath);

      // RBAC for template writes: space-level (.system/templates/) requires a space
      // admin; personal (.system/useractivity/<prefix>/templates/) requires the path's
      // owner to be the caller. Non-template paths pass through unchanged.
      const createTplCheck = templateWriteCheck(req.user, space, finalPath);
      if (!createTplCheck.allowed) {
        return res.status(403).json({ success: false, message: createTplCheck.reason });
      }

      // If no content provided but has template, load template content
      if (!finalContent && template) {
        finalContent = '# ' + documentTitle + '\n\nYour content goes here...';
      }

      // Create the file on disk
      let documentsDir, absolutePath;
      try {
        ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(spaceName, finalPath, appBaseDir));
      } catch (pathError) {
        // A path the space curates away answers 404 on READ with no detail, and
        // that is right there: a distinguishable error lets a caller map the
        // hidden tree by probing paths one at a time.
        //
        // A CREATE is a different question, and the shared answer was actively
        // harmful. The user was told the document they are trying to MAKE "was
        // not found" — which is not a thing that can be true — while
        // `handleHiddenPath` returned before the warn below, so the rejection
        // left no trace on the server either: no path, no space, no rule.
        // Diagnosing one meant reconstructing the exclusion lists by hand.
        //
        // So the create case answers for itself. What it discloses is the
        // path the CALLER JUST SUPPLIED and the fact that the SPACE'S OWN
        // config excludes it — not whether anything exists on disk, which is
        // what curation actually hides. The STATUS stays 404 for exactly the
        // reason it always was: a 403 would confirm the path is real.
        if (pathError && pathError.code === 'PATH_HIDDEN') {
          logger.warn(
            `[Create] Refused (curated away): "${finalPath}" in space "${spaceName}" ` +
            `for ${req.user?.email || 'unknown'} — check configuration.excludedPaths/allowedPaths`
          );
          return res.status(404).json({
            success: false,
            reason: 'PATH_NOT_PERMITTED',
            path: finalPath,
            error: 'Path not permitted',
            message: `The "${spaceName}" space does not allow files at "${finalPath}". `
              + 'Choose a different name or location, or ask an administrator to '
              + "adjust this space's allowed paths."
          });
        }
        logger.warn(`Path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          success: false,
          message: pathError.message
        });
      }

      try {
        const fs = require('node:fs').promises;

        // POST CREATES; it never overwrites. `fs.writeFile` truncates, so this
        // endpoint used to replace an existing document with a blank one and
        // report success — the caller saw "File created successfully" and the
        // previous content was simply gone, with no copy anywhere. Updating an
        // existing document is `PUT /documents/content`, which is what every
        // editor already uses; the split between the two verbs is the guard.
        //
        // Checked BEFORE mkdir so a rejected create leaves no empty folders,
        // and via stat rather than an `access` try/catch so that a real error
        // (EACCES, EIO) surfaces instead of being read as "does not exist".
        let existing = null;
        try {
          existing = await fs.stat(absolutePath);
        } catch (statError) {
          if (statError.code !== 'ENOENT') throw statError;
        }
        if (existing) {
          logger.info(`Refused to overwrite existing ${existing.isDirectory() ? 'folder' : 'file'}: ${finalPath} in space: ${spaceName}`);
          return res.status(409).json({
            success: false,
            message: `"${path.basename(finalPath)}" already exists here. Choose another name, or open the existing document to edit it.`,
            path: finalPath,
            exists: true
          });
        }

        // Ensure directory exists
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });

        // Write the file
        await fs.writeFile(absolutePath, finalContent || `# ${documentTitle}\n\nYour content goes here...`, 'utf8');

        logger.info(`Created document file: ${finalPath} in space: ${spaceName}`);

        // For templates, we don't need to add to documents list (space-level
        // .system/templates/ and personal .system/useractivity/<prefix>/templates/).
        const isTemplate = finalPath.startsWith('.system/templates/')
          || /^\.system\/useractivity\/[^/]+\/templates\//.test(finalPath);

        let newDocument = {
          success: true,
          message: isTemplate ? 'Template created successfully' : 'Document created successfully',
          path: finalPath,
          spaceName: spaceName
        };

        if (!isTemplate) {
          // The file on disk is the record. Build a descriptor for the response
          // (path is the identity now — no numeric id, no JSON index).
          const docMetadata = {
            id: finalPath,
            title: documentTitle,
            spaceId: spaceId ? parseInt(spaceId) : null,
            spaceName,
            path: finalPath,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString()
          };

          // Add to search index (space-relative path — updateFile(absolutePath)
          // mis-keyed named spaces via _getBaseDir's legacy-space fallback).
          if (searchIndexer) {
            await searchIndexer.updateFileInSpace(spaceName, finalPath);
            logger.info(`Added document to search index: ${finalPath}`);
          }

          // Refresh derived caches + tree cache so the new file shows immediately.
          await invalidateDocumentCaches(spaceId);

          newDocument.document = docMetadata;

          logger.info(`Created new document: ${documentTitle} (${finalPath})`);

          // Emit event through EventBus
          if (global.eventBus) {
            const spaces = await dataManager.read('spaces');
            const space = spaces.find(s => s.id === parseInt(spaceId));
            global.eventBus.emitChange('create', 'file', {
              spaceId: space?.id || null,
              spaceName: spaceName,
              name: path.basename(finalPath),
              path: finalPath,
              parentPath: path.dirname(finalPath) === '.' ? '' : path.dirname(finalPath),
              created: docMetadata.createdAt,
              modified: docMetadata.modifiedAt,
              source: 'api',
              userId: req.user?.id || req.user?.username || 'unknown',
              userName: req.user?.username || 'unknown'
            });
          }
        }

        res.json(newDocument);
      } catch (fileError) {
        logger.error(`Failed to create file ${finalPath}:`, fileError);
        res.status(500).json({
          success: false,
          message: 'Failed to create file: ' + fileError.message
        });
      }
    } catch (error) {
      logger.error('Error creating document:', error);
      res.status(500).json({ success: false, message: 'Failed to create document' });
    }
  });

  // Check if a document exists without reading it (useful for optional files like home.md)
  app.post('/applications/wiki/api/documents/exists', async (req, res) => {
    try {
      const { path: documentPath, spaceName } = req.body;

      if (!documentPath || !spaceName) {
        return res.status(400).json({ error: 'Document path and space name are required' });
      }

      let documentsDir, absolutePath;
      try {
        // A path the space hides reports "does not exist" — same answer the
        // caller gets for a genuinely missing file, which is the point.
        ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(
          spaceName, documentPath, appBaseDir, { enforceVisibility: true }));
      } catch (pathError) {
        return res.json({ exists: false });
      }

      try {
        const fs = require('node:fs').promises;
        await fs.access(absolutePath);
        res.json({ exists: true });
      } catch (error) {
        res.json({ exists: false });
      }
    } catch (error) {
      logger.error('Error checking document existence:', error);
      res.json({ exists: false });
    }
  });

  // Get document content with template support (POST version)
  app.post('/applications/wiki/api/documents/content', async (req, res) => {
    try {
      const { path: documentPath, spaceName } = req.body;

      if (!documentPath || !spaceName) {
        return res.status(400).json({ error: 'Document path and space name are required' });
      }

      logger.info(`Reading document content from path: ${documentPath} in space: ${spaceName}`);

      let documentsDir, absolutePath;
      try {
        ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(
          spaceName, documentPath, appBaseDir, { enforceVisibility: true }));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        logger.warn(`Path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          error: pathError.message
        });
      }

      try {
        const fs = require('node:fs').promises;

        // Stat FIRST: the cache is keyed by path but describes a file, and one
        // physical file can have several paths in a symlinked space — so a hit is
        // only trusted when it still matches this file's mtime/size. (fs.stat
        // follows symlinks, so every path validates against the same target.)
        const cacheKey = `${spaceName}-${documentPath}`;
        const stats = await fs.stat(absolutePath);

        let content = await readContentCache(cache, cacheKey, stats);
        if (content === null) {
          content = await fs.readFile(absolutePath, 'utf8');
          await writeContentCache(cache, cacheKey, content, stats);
        }

        // Extract title from first line if it's a markdown heading
        let title = path.basename(documentPath, '.md');
        const firstLine = content.split('\n')[0];
        if (firstLine.startsWith('# ')) {
          title = firstLine.substring(2).trim();
        }

        const document = {
          title: title,
          content: content,
          path: documentPath,
          spaceName: spaceName,
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
          metadata: {
            viewer: documentPath.endsWith('.md') ? 'markdown' : 'text'
          }
        };

        logger.info(`Successfully read document: ${documentPath}`);
        res.json(document);
      } catch (fileError) {
        if (fileError.code === 'ENOENT') {
          logger.warn(`File not found: ${documentPath}`);
          res.status(404).json({ error: 'Document not found' });
        } else {
          logger.error(`Error reading file ${documentPath}:`, fileError);
          res.status(500).json({ error: 'Failed to read document' });
        }
      }
    } catch (error) {
      logger.error('Error in document content endpoint:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // File upload endpoint
  const multer = require('multer');
  const fs = require('node:fs').promises;

  // Configure multer for memory storage (we'll handle file writing ourselves)
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB limit
    }
  });

  app.post('/applications/wiki/api/documents/upload', upload.single('file'), async (req, res) => {
    try {
      // Require authentication to upload documents
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to upload documents'
        });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file provided' });
      }

      const { spaceId, folderPath = '' } = req.body;

      if (!spaceId) {
        return res.status(400).json({ success: false, error: 'Space ID is required' });
      }

      // Get space information
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === parseInt(spaceId));

      if (!space) {
        return res.status(404).json({ success: false, error: 'Space not found' });
      }

      // Determine the target directory
      let targetDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        targetDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        targetDir = path.resolve(documentsDir, space.name);
      }

      // The uploaded file name is client-supplied: validate it as a single path
      // SEGMENT (no separators, no '..', no illegal chars) before it ever
      // reaches the filesystem. Rejecting is safer than taking the basename,
      // which would silently file the upload somewhere other than asked.
      let fileName;
      try {
        fileName = sanitizeFileName(req.file.originalname);
      } catch (err) {
        return res.status(400).json({
          success: false,
          error: err.code === 'INVALID_FILE_NAME' ? err.message : 'Invalid file name'
        });
      }

      // Resolve the final location through the space-aware resolver, which
      // contains folderPath + fileName inside the space root (path.relative
      // guard) and applies space visibility. This replaces the previous
      // unguarded path.resolve(targetDir, folderPath/fileName).
      const documentPath = folderPath ? `${folderPath}/${fileName}` : fileName;
      let absolutePath;
      try {
        ({ absolutePath } = await getDocumentAbsolutePath(space.name, documentPath, appBaseDir));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        logger.warn(`Upload path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          success: false,
          error: pathError.message.includes('Space not found') ? 'Space not found' : 'Access denied'
        });
      }

      // Ensure the containing directory exists, then write the file.
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, req.file.buffer);

      logger.info(`File uploaded: ${fileName} to ${path.dirname(absolutePath)}`);

      // The written file is the source of truth — no JSON index to maintain.
      await invalidateDocumentCaches(spaceId);

      res.json({
        success: true,
        message: 'File uploaded successfully',
        fileName: fileName,
        path: documentPath,
        size: req.file.size
      });

    } catch (error) {
      logger.error('Error uploading file:', error);
      res.status(500).json({ success: false, error: 'Failed to upload file' });
    }
  });

  // Convert-and-import endpoint: run a dropped document through the
  // design-documents "Design: Process File" workflow (convert -> AI clean) and
  // save the resulting markdown as a wiki page. (`upload`, `fs` and `multer`
  // are declared above.)
  app.post('/applications/wiki/api/documents/convert', upload.single('file'), async (req, res) => {
    let stagingDir;
    try {
      // Require authentication to convert documents
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to convert documents'
        });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No file provided' });
      }

      const { spaceId, folderPath = '' } = req.body;

      if (!spaceId) {
        return res.status(400).json({ success: false, error: 'Space ID is required' });
      }

      // Resolve the workflow engine (shared across the unified app by datasources)
      const workflowBridge = req.app.get('workflowBridge');
      if (!workflowBridge) {
        return res.status(503).json({ success: false, error: 'Workflow engine not available' });
      }
      if (workflowBridge.initialized === false && typeof workflowBridge.whenReady === 'function') {
        await workflowBridge.whenReady();
      }

      const workflow = workflowBridge.resolveWorkflowByName('Design: Process File');
      if (!workflow) {
        return res.status(503).json({
          success: false,
          error: 'Processing workflow "Design: Process File" is not available'
        });
      }

      // Get space information
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === parseInt(spaceId));

      if (!space) {
        return res.status(404).json({ success: false, error: 'Space not found' });
      }

      // Stage the uploaded file on disk so the worker-thread step can read it by path
      const baseDir = appBaseDir || path.join(process.cwd(), '.application');
      stagingDir = path.join(baseDir, 'staging', require('node:crypto').randomUUID());
      await fs.mkdir(stagingDir, { recursive: true });

      const originalName = sanitizeFileName(req.file.originalname);
      const baseName = originalName.replace(/\.[^/.]+$/, ''); // strip extension
      const markdownName = `${baseName}.md`;
      const sourceDocument = path.join(stagingDir, originalName);
      const outputDocument = path.join(stagingDir, markdownName);
      await fs.writeFile(sourceDocument, req.file.buffer);

      // Run the design-documents process workflow (convert -> clean), awaited.
      const execution = await workflowBridge.executeWorkflow(workflow.id, {
        settings: { sourceDocument, outputDocument }
      });

      // "Design: Process File" runs two steps: convert-document then
      // clean-document. The convert step (steps[0]) must have produced markdown;
      // a workflow can "succeed" while a step reports a soft failure (e.g. an
      // unsupported file type), so check the convert step explicitly.
      const steps = execution?.result?.steps || [];
      const convertData = steps[0]?.data;
      if (!execution || execution.outcome !== 'success' || !convertData || convertData.success === false) {
        const message = convertData?.error || execution?.error || 'Document conversion failed';
        logger.error('Document processing workflow failed:', message);
        return res.status(500).json({ success: false, error: message });
      }

      // The clean step writes the cleaned markdown back to outputDocument in
      // place, so the file on disk is the final converted + cleaned result.
      // Fall back to the convert step's raw markdown if the file is unreadable.
      let markdown;
      try {
        markdown = await fs.readFile(outputDocument, 'utf8');
      } catch {
        markdown = convertData.markdown;
      }
      if (typeof markdown !== 'string' || markdown.length === 0) {
        markdown = convertData.markdown || '';
      }

      // Resolve the final wiki-page location through the space-aware resolver,
      // which contains folderPath + markdownName inside the space root and
      // applies visibility — same guard the upload route uses.
      const documentPath = folderPath ? `${folderPath}/${markdownName}` : markdownName;
      let finalPath;
      try {
        ({ absolutePath: finalPath } = await getDocumentAbsolutePath(space.name, documentPath, appBaseDir));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        logger.warn(`Convert path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          success: false,
          error: pathError.message.includes('Space not found') ? 'Space not found' : 'Access denied'
        });
      }

      await fs.mkdir(path.dirname(finalPath), { recursive: true });
      await fs.writeFile(finalPath, markdown, 'utf8');

      logger.info(`File converted to markdown: ${markdownName} in ${path.dirname(finalPath)}`);

      // The written markdown file is the source of truth — no JSON index.
      const markdownSize = Buffer.byteLength(markdown, 'utf8');
      await invalidateDocumentCaches(spaceId);

      res.json({
        success: true,
        message: 'File converted successfully',
        fileName: markdownName,
        path: documentPath,
        title: baseName,
        spaceName: space.name,
        size: markdownSize
      });

    } catch (error) {
      logger.error('Error converting file:', error);
      res.status(500).json({ success: false, error: 'Failed to convert file' });
    } finally {
      // Best-effort cleanup of the staging directory
      if (stagingDir) {
        try {
          await fs.rm(stagingDir, { recursive: true, force: true });
        } catch (cleanupErr) {
          logger.warn(`Failed to clean staging dir ${stagingDir}: ${cleanupErr.message}`);
        }
      }
    }
  });

  // Toggle TODO checkbox in markdown files
  app.post('/applications/wiki/api/documents/toggle-todo', async (req, res) => {
    try {
      // Require authentication to toggle TODO items
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to modify documents'
        });
      }

      const { path: documentPath, spaceName, lineNumber } = req.body;

      if (!documentPath || !spaceName || lineNumber === undefined) {
        return res.status(400).json({ success: false, error: 'Document path, space name, and line number are required' });
      }

      logger.info(`Toggling TODO at line ${lineNumber} in ${documentPath} (space: ${spaceName})`);

      let documentsDir, absolutePath;
      try {
        ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(spaceName, documentPath, appBaseDir));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        logger.warn(`Path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          success: false,
          error: pathError.message
        });
      }

      try {
        const fs = require('node:fs').promises;

        // Read the file content
        const content = await fs.readFile(absolutePath, 'utf8');
        const lines = content.split('\n');

        // Validate line number
        if (lineNumber < 0 || lineNumber >= lines.length) {
          return res.status(400).json({ success: false, error: 'Invalid line number' });
        }

        const line = lines[lineNumber];

        // Check if this line contains a TODO checkbox
        const uncheckedMatch = line.match(/^(\s*[-*])\s+\[\s\]/);
        const checkedMatch = line.match(/^(\s*[-*])\s+\[x\]/i);

        if (!uncheckedMatch && !checkedMatch) {
          return res.status(400).json({ success: false, error: 'Line does not contain a TODO checkbox' });
        }

        // Toggle the checkbox
        if (uncheckedMatch) {
          // Change [ ] to [x]
          lines[lineNumber] = line.replace(/\[\s\]/, '[x]');
        } else {
          // Change [x] to [ ]
          lines[lineNumber] = line.replace(/\[x\]/i, '[ ]');
        }

        // Write the updated content back to the file
        const updatedContent = lines.join('\n');
        await fs.writeFile(absolutePath, updatedContent, 'utf8');

        // Update cache for text-based files
        const cacheKey = `${spaceName}-${documentPath}`;
        await writeContentCache(cache, cacheKey, updatedContent, await fs.stat(absolutePath));
        logger.info(`Updated cache after TODO toggle: ${cacheKey}`);

        logger.info(`Successfully toggled TODO at line ${lineNumber} in ${documentPath}`);

        // Trigger search re-indexing asynchronously (live index — see the
        // save handler above for why a throwaway indexer was wrong here).
        if (searchIndexer) {
          setImmediate(() => {
            searchIndexer.updateFileInSpace(spaceName, documentPath).catch(indexError => {
              logger.warn('Failed to update search index after TODO toggle:', indexError.message);
            });
          });
        }

        // Emit document change event for any listeners
        eventEmitter.emit('document:changed', {
          path: documentPath,
          spaceName: spaceName,
          absolutePath: absolutePath,
          type: 'todo-toggle'
        });

        res.json({
          success: true,
          message: 'TODO toggled successfully',
          lineNumber: lineNumber,
          newContent: lines[lineNumber]
        });

      } catch (fileError) {
        logger.error(`Failed to toggle TODO in ${documentPath}:`, fileError);
        res.status(500).json({
          success: false,
          error: 'Failed to toggle TODO: ' + fileError.message
        });
      }
    } catch (error) {
      logger.error('Error in toggle-todo endpoint:', error);
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  });

  // Convert Office documents to Markdown
  app.post('/applications/wiki/api/documents/convert-to-markdown', async (req, res) => {
    try {
      // Require authentication to convert documents
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to convert documents'
        });
      }

      const { path: documentPath, spaceName } = req.body;

      if (!documentPath || !spaceName) {
        return res.status(400).json({ success: false, error: 'Document path and space name are required' });
      }

      logger.info(`Converting document to markdown: ${documentPath} in space: ${spaceName}`);

      // Get the absolute path to the document
      let documentsDir, absolutePath;
      try {
        ({ documentsDir, absolutePath } = await getDocumentAbsolutePath(spaceName, documentPath, appBaseDir));
      } catch (pathError) {
        if (handleHiddenPath(res, pathError)) return;
        logger.warn(`Path resolution failed: ${pathError.message}`);
        return res.status(pathError.message.includes('Space not found') ? 404 : 403).json({
          success: false,
          error: pathError.message
        });
      }

      // Check if file exists
      try {
        await fs.access(absolutePath);
      } catch (error) {
        return res.status(404).json({ success: false, error: 'File not found' });
      }

      // Determine file type and use appropriate processor
      const ext = path.extname(absolutePath).toLowerCase();
      let markdown = '';
      let processor = null;

      try {
        if (ext === '.docx' || ext === '.doc') {
          processor = require('../processing/docxprocessor');
          markdown = await processor.convertToMarkdown(absolutePath);
        } else if (ext === '.xlsx' || ext === '.xls') {
          processor = require('../processing/xlsxprocessor');
          markdown = await processor.convertToMarkdown(absolutePath);
        } else if (ext === '.pptx' || ext === '.ppt') {
          processor = require('../processing/pptxprocessor');
          markdown = await processor.convertToMarkdown(absolutePath);
        } else if (ext === '.pdf') {
          processor = require('../processing/pdfprocessor');
          markdown = await processor.convertToMarkdown(absolutePath);
        } else {
          return res.status(400).json({ success: false, error: 'Unsupported file type for conversion' });
        }
      } catch (conversionError) {
        logger.error(`Conversion failed: ${conversionError.message}`);
        return res.status(500).json({ success: false, error: `Conversion failed: ${conversionError.message}` });
      }

      // Relocate the untouched source into the hidden `.system/originals` folder,
      // mirroring its space-relative path (e.g. `sub/report.docx` ->
      // `.system/originals/sub/report.docx`). The sibling `<name>.md` page's
      // download link resolves back to this via filePolicy.originalCandidatesForMarkdown.
      const originalBackupPath = path.join(documentsDir, toOriginalsRelPath(documentPath));
      await fs.mkdir(path.dirname(originalBackupPath), { recursive: true });
      await fs.copyFile(absolutePath, originalBackupPath);

      logger.info(`Backed up original file to: ${originalBackupPath}`);

      // Create markdown file with same name but .md extension
      const fileNameWithoutExt = path.basename(documentPath, ext);
      const markdownFileName = `${fileNameWithoutExt}.md`;
      const markdownPath = path.join(path.dirname(absolutePath), markdownFileName);

      // Write markdown content
      await fs.writeFile(markdownPath, markdown, 'utf8');

      logger.info(`Created markdown file: ${markdownPath}`);

      // Delete the original file
      await fs.unlink(absolutePath);

      logger.info(`Deleted original file: ${absolutePath}`);

      // Calculate the relative path for the markdown file
      const relativePath = path.relative(documentsDir, markdownPath);
      const markdownRelativePath = relativePath.split(path.sep).join('/');

      res.json({
        success: true,
        message: 'Document converted to markdown successfully',
        markdownPath: markdownRelativePath,
        originalBackupPath: path.relative(documentsDir, originalBackupPath).split(path.sep).join('/')
      });

    } catch (error) {
      logger.error('Error converting document to markdown:', error);
      res.status(500).json({ success: false, error: 'Failed to convert document' });
    }
  });
};
