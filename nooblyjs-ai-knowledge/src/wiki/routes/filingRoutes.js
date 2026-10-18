/**
 * @fileoverview Wiki Filing Routes
 * Access documents via space-configured filing services
 * Routes through SpaceFilingManager to use provider-specific file access
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

// Module scope: used by rootKeyFor() below. Handlers declare their own local
// `path` binding, which shadows this harmlessly.
const path = require('node:path');
const {
  getPolicy,
  toDerivedRelPath,
  originalCandidatesForMarkdown,
  toContextRelPath,
  fromContextRelPath,
  SYSTEM_DIR
} = require('../../shared/utils/filePolicy');
const { contentRootKey } = require('../../shared/spaces/contentRoot');
const { isValidStatus } = require('../utils/folderTypes');
const {
  applyFileOrder,
  readOrderWith,
  resolveEffectiveOrder
} = require('../utils/fileOrder');
const { templateWriteCheck } = require('../components/spacePermissions');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');
const {
  collectRecentEntries,
  selectRecent,
  normaliseRecentQuery,
  planPinnedScan,
  mergeRecentEntries
} = require('../utils/recentChanges');
const spaceUserStore = require('../components/spaceUserStore');
const userArtifacts = require('../components/userArtifacts');
const readVisit = require('../components/readVisit');

/** Pre-migration per-folder settings directory, still probed when reading. */
const LEGACY_SETTINGS_DIR = '.settings';

/**
 * The system-context group's on-demand build, resolved by name off the workflow
 * bridge. Hardcoded here rather than imported from the file-watcher (which runs
 * the same workflow in targeted mode) to keep routes independent of activities —
 * the same split documentRoutes uses for "Design: Process File". The name must
 * match `system-context/workflow-definition-ondemand.json`.
 */
const CONTEXT_WORKFLOW_NAME = 'Context: Overwrite Context (On-Demand)';

/**
 * Per-AI-call ceiling for a UI-triggered subtree rebuild. Generous compared with
 * the watcher's 120s (nothing is queued behind this run), but NOT unbounded: the
 * build step's own fallback is 0 = wait forever, which on a stalled local model
 * leaves the execution "running" with no way to end it.
 */
const CONTEXT_REBUILD_AI_TIMEOUT_MS =
  Number(process.env.CONTEXT_REBUILD_AI_TIMEOUT_MS) || 300000;

/**
 * How many levels of the folder tree `GET /folder-tree` returns when the caller
 * does not ask for a specific depth.
 *
 * The walk used to be exhaustive, which is fine on a small space and fatal on a
 * large one: the content roots are directories of symlinked git repositories, so
 * "one more folder consolidated into the repo" can add thousands of directories
 * to a walk that already had to finish before the nav rendered anything. Two
 * levels is what the drill-down nav actually paints at the space root (top
 * folders as group headers + their direct children), and every level below that
 * is fetched on demand — see the `path` parameter on the same route.
 *
 * Two is a floor, not a guess: at depth 1 the root view would show group headers
 * with nothing under them.
 */
const DEFAULT_TREE_DEPTH = Math.max(1, Number(process.env.WIKI_TREE_DEPTH) || 2);

/**
 * Absolute ceiling on recursion, applied even when a caller asks for the full
 * tree (`depth=0`).
 *
 * `buildTreeFromFiling` follows symlinks — that is the whole point of the
 * content layout — and nothing in the filing service resolves real paths, so a
 * link that points at one of its own ancestors makes the walk recurse until the
 * process dies. A cap turns "the request never returns" into "the tree is
 * clipped very deep", which is a bug you can see.
 */
const MAX_TREE_DEPTH = Math.max(1, Number(process.env.WIKI_TREE_MAX_DEPTH) || 24);

/**
 * Read the requested tree depth off a request.
 * `depth=0` / `depth=all` / `depth=full` mean "everything", still bounded by
 * MAX_TREE_DEPTH. Anything unparseable falls back to the default.
 * @param {Object} req - Express request
 * @return {number} levels to walk, >= 1
 */
function requestedDepth(req) {
  const raw = req.query && req.query.depth;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TREE_DEPTH;
  if (raw === 'all' || raw === 'full' || raw === '0') return MAX_TREE_DEPTH;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TREE_DEPTH;
  return Math.min(parsed, MAX_TREE_DEPTH);
}

module.exports = (options, eventEmitter, services) => {
  const app = options.app || options['express-app'];
  const { spaceManager, spaceFilingManager, log, dataManager, appBaseDir, treeCache } = services;

  if (!app) {
    log.warn('[Wiki Filing Routes] Express app not found in options');
    return;
  }

  if (!spaceFilingManager) {
    log.warn('[Wiki Filing Routes] SpaceFilingManager not available - filing routes disabled');
    return;
  }

  // Shared raw folder trees (see rawTreeForRoot) must not outlive a change on
  // disk. Same signal TreeCache uses; the wiki event bus is on `global` by the
  // time routes are registered.
  attachRawTreeInvalidation(services.eventBus || global.eventBus, log);

  // =========================================================================
  // Helper: Per-space path visibility (allowedPaths / excludedPaths)
  // =========================================================================

  /**
   * Refuse a read of a path this space does not expose.
   *
   * Answers 404, not 403: a space that hides a subtree should not confirm that
   * the subtree exists, and every caller already handles 404 as "not here".
   * Unrestricted spaces short-circuit, so this costs nothing for them.
   *
   * @param {Object} res - Express response
   * @param {Object} space - space record
   * @param {string} relPath - space-relative path being read
   * @param {'file'|'folder'} kind - folders may also pass as pass-through containers
   * @return {boolean} true when the request has been answered — caller must return
   */
  function denyIfHidden(res, space, relPath, kind = 'file') {
    const visibility = compileVisibility(space);
    if (!visibility.restricted) return false;

    const visible = kind === 'folder'
      ? visibility.isFolderAccessible(relPath)
      : visibility.isFileVisible(relPath);
    if (visible) return false;

    log.warn(`[Wiki Filing] Path hidden by space filter: space=${space.id}, path=${relPath}`);
    res.status(404).json({ success: false, error: 'Not found' });
    return true;
  }

  // =========================================================================
  // Helper: Determine MIME type based on file extension
  // =========================================================================
  function getMimeTypeByExtension(filePath) {
    const path = require('path');
    const ext = path.extname(filePath).toLowerCase();

    const mimeTypes = {
      // Images
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      // PDF
      '.pdf': 'application/pdf',
      // Video
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.avi': 'video/x-msvideo',
      '.mov': 'video/quicktime',
      '.mkv': 'video/x-matroska',
      // Audio
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.flac': 'audio/flac',
      '.aac': 'audio/aac',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
      // Default
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  // =========================================================================
  // Helper: Determine viewer type based on file extension
  // =========================================================================
  function getViewerTypeByExtension(filePath) {
    const path = require('path');
    const ext = path.extname(filePath).toLowerCase();

    // Image files
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'].includes(ext)) {
      return 'image';
    }

    // PDF files
    if (ext === '.pdf') {
      return 'pdf';
    }

    // Video files
    if (['.mp4', '.webm', '.avi', '.mov', '.mkv'].includes(ext)) {
      return 'video';
    }

    // Audio files
    if (['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a'].includes(ext)) {
      return 'audio';
    }

    // Office files
    if (['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'].includes(ext)) {
      return 'download';
    }

    // Markdown files
    if (ext === '.md' || ext === '.markdown') {
      return 'markdown';
    }

    // Code files
    if (['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.cs', '.cpp', '.c', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.sh', '.bash'].includes(ext)) {
      return 'code';
    }

    // Data/config files
    if (['.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.env', '.sql'].includes(ext)) {
      return 'code';
    }

    // Web files
    if (['.html', '.htm', '.css', '.scss', '.less'].includes(ext)) {
      return 'web';
    }

    // Text files
    if (['.txt', '.csv', '.log', '.md', '.rtf'].includes(ext)) {
      return 'text';
    }

    // Default: anything we don't recognise is offered as a download.
    // Returning 'text' here would try to read binary bytes as utf8 and
    // ship them to the browser, which is both wasteful and unreadable.
    return 'download';
  }

  // =========================================================================
  // Helper: Best-effort file timestamps (created/modified) via a directory
  // listing. The disk-backed filing providers (local, git, sync working-store)
  // return created/modified per entry from list() (fs.stat under the hood) —
  // the same source the folder tree relies on. We list the file's parent
  // directory and match by basename. Never throws: on any failure (or a
  // provider like S3 whose list() omits timestamps) the caller simply omits
  // them.
  // =========================================================================
  async function statFileTimes(filingService, docPath) {
    try {
      const slash = docPath.lastIndexOf('/');
      const dir = slash >= 0 ? docPath.slice(0, slash) : '';
      const base = slash >= 0 ? docPath.slice(slash + 1) : docPath;
      const entries = await filingService.list(dir || '.');
      const match = (entries || []).find(e => e && (e.name || e) === base);
      if (match && typeof match === 'object') {
        return { created: match.created, modified: match.modified };
      }
    } catch (err) {
      log.debug(`[Wiki Filing] Could not stat times for ${docPath}: ${err.message}`);
    }
    return {};
  }

  // =========================================================================
  // Helper: Resolve the stored source original for a visible `.md` page. Office
  // documents dropped into a space are converted to a `<name>.md` page with the
  // untouched source relocated to `.system/originals/<name>.<officeext>`; the
  // page's download link should serve that original, not the markdown. Returns
  // { path, name } for the first office-extension candidate present on disk, or
  // null when the page has no stored original (a hand-authored .md). One
  // directory listing, never throws.
  // =========================================================================
  async function resolveStoredOriginal(filingService, documentPath) {
    const candidates = originalCandidatesForMarkdown(documentPath);
    if (candidates.length === 0) return null;
    // All candidates share the same parent dir — list it once and match by name.
    const slash = candidates[0].lastIndexOf('/');
    const dir = candidates[0].slice(0, slash);
    const wanted = new Set(candidates.map(c => c.slice(c.lastIndexOf('/') + 1).toLowerCase()));
    try {
      const entries = await filingService.list(dir);
      for (const e of (entries || [])) {
        const name = (e && (e.name || e)) ? String(e.name || e) : '';
        if (name && wanted.has(name.toLowerCase())) {
          return { path: `${dir}/${name}`, name };
        }
      }
    } catch (err) {
      log.debug(`[Wiki Filing] No stored original for ${documentPath}: ${err.message}`);
    }
    return null;
  }

  // =========================================================================
  // Read Document Content via Space Filing Service
  // =========================================================================

  /**
   * GET /applications/wiki/api/spaces/:spaceId/file-content/*
   *
   * Reads document content using space-configured filing service.
   * This is the key endpoint that replaces direct file access.
   *
   * Query Parameters (optional):
   *   - encoding: 'utf8', 'base64', 'binary' (default: 'utf8')
   *
   * @param spaceId - Space identifier
   * @param documentPath - Path relative to space's baseDir
   * @returns {Object} { success: true, content: string, path: string, metadata: {...} }
   */
  app.get('/applications/wiki/api/spaces/:spaceId/file-content/:documentPath(*)',
    async (req, res) => {
      try {
        const spaceId = parseInt(req.params.spaceId);
        const documentPath = req.params.documentPath;
        const encoding = req.query.encoding || 'utf8';

        if (!spaceId || !documentPath) {
          return res.status(400).json({
            success: false,
            error: 'Space ID and document path are required'
          });
        }

        log.info(`[Wiki Filing] Reading document: space=${spaceId}, path=${documentPath}`);

        // ===== Step 1: Verify space exists =====
        let space;
        try {
          const fs = require('node:fs').promises;
          const path = require('node:path');

          // Direct file read to get spaces (same as spacesRoutes)
          const spacesPath = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
          const spacesData = await fs.readFile(spacesPath, 'utf8');
          const spaces = JSON.parse(spacesData);
          space = spaces.find(s => s.id === spaceId);
        } catch (error) {
          log.error(`[Wiki Filing] Error reading spaces list:`, error.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to read spaces'
          });
        }

        if (!space) {
          log.warn(`[Wiki Filing] Space not found: ${spaceId}`);
          return res.status(404).json({
            success: false,
            error: 'Space not found',
            spaceId
          });
        }

        // ===== Step 2: Check access permissions =====
        if (req.isAuthenticated()) {
          const userEmail = req.user.email;

          // Check if user has access to this space
          const hasAccess =
            space.visibility === 'public' ||
            space.visibility === 'team' ||
            (space.visibility === 'private' &&
             space.allowedUsers &&
             space.allowedUsers.includes(userEmail));

          if (!hasAccess) {
            log.warn(`[Wiki Filing] Access denied for user ${userEmail} to space ${spaceId}`);
            return res.status(403).json({
              success: false,
              error: 'Access denied to this space'
            });
          }
        } else {
          // Unauthenticated users can only access public spaces
          if (space.visibility !== 'public') {
            return res.status(401).json({
              success: false,
              error: 'Authentication required'
            });
          }
        }

        // ===== Step 2b: Check the space actually exposes this path =====
        if (denyIfHidden(res, space, documentPath)) return;

        // ===== Step 3: Get filing service for this space =====
        let filingService;
        try {
          filingService = await spaceFilingManager.getFilingService(spaceId);
        } catch (error) {
          log.error(`[Wiki Filing] Failed to get filing service for space ${spaceId}:`, error.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to initialize filing service for space',
            details: error.message
          });
        }

        if (!filingService) {
          log.error(`[Wiki Filing] No filing service available for space ${spaceId}`);
          return res.status(500).json({
            success: false,
            error: 'Filing service not available'
          });
        }

        // ===== Step 4: Read file via filing service =====

        // Office documents (docx/xls/ppt…) are *viewed* as their derived markdown
        // sidecar, while remaining downloadable as the untouched original. Read
        // the hidden `.system/derived/<path>.md`; if it isn't there yet (conversion
        // pending or unsupported, e.g. .pptx) we fall through to the download
        // response below so the file is never unreachable.
        if (getPolicy(documentPath).view === 'markdown') {
          try {
            const md = await filingService.read(toDerivedRelPath(documentPath), 'utf8');
            const mdContent = Buffer.isBuffer(md) ? md.toString('utf8') : md;
            const filingInstance = spaceFilingManager.filingInstances.get(spaceId);
            const providerType = filingInstance?.providerType || 'unknown';
            // Report the ORIGINAL office file's timestamps, not the derived
            // sidecar's — that's when the user last updated the document.
            const times = await statFileTimes(filingService, documentPath);
            // Count this read in the per-day usage tally (best effort; never
            // blocks or fails the read). Captures MCP/API reads of an office
            // document's derived text — the daemon never reaches this route.
            await readVisit.record({ req, space, viewerType: 'markdown', appBaseDir, log });
            return res.json({
              success: true,
              content: mdContent,
              path: documentPath,
              spaceId: spaceId,
              timestamp: new Date().toISOString(),
              metadata: {
                size: typeof mdContent === 'string' ? mdContent.length : 0,
                provider: providerType,
                encoding: 'utf8',
                viewer: 'markdown',
                derivedFrom: documentPath,
                created: times.created,
                modified: times.modified
              }
            });
          } catch (err) {
            log.info(`[Wiki Filing] No markdown sidecar for ${documentPath} (${err.message}); offering as download`);
            // fall through to the download-only response below
          }
        }

        // For download-only files (unconverted office, zip, unknown binaries…)
        // we skip the content read entirely — reading binary bytes as utf8 is
        // wasteful and produces garbage the frontend never displays.
        const viewerType = getViewerTypeByExtension(documentPath);
        if (viewerType === 'download') {
          let stat = null;
          try {
            if (typeof filingService.stat === 'function') {
              stat = await filingService.stat(documentPath);
            }
          } catch (err) {
            log.debug(`[Wiki Filing] stat() unavailable for ${documentPath}: ${err.message}`);
          }
          const filingInstance = spaceFilingManager.filingInstances.get(spaceId);
          const providerType = filingInstance?.providerType || 'unknown';
          const times = await statFileTimes(filingService, documentPath);
          return res.json({
            success: true,
            content: '',
            path: documentPath,
            spaceId: spaceId,
            timestamp: new Date().toISOString(),
            metadata: {
              size: stat?.size || 0,
              provider: providerType,
              encoding: 'none',
              viewer: 'download',
              created: stat?.created || times.created,
              modified: stat?.modified || times.modified
            }
          });
        }

        // Binary-viewer types must be read as a raw Buffer so res.send ships
        // the bytes verbatim. Passing an encoding makes fs.readFile return a
        // String, which Express re-encodes as utf-8 — corrupting the file.
        const isBinaryViewer = ['image', 'pdf', 'video', 'audio'].includes(viewerType);
        const readEncoding = isBinaryViewer ? undefined : encoding;

        let content;
        try {
          log.debug(`[Wiki Filing] Reading from filing service: ${documentPath}`);
          content = await filingService.read(documentPath, readEncoding);
        } catch (error) {
          // Handle different error types
          const errorCode = error.code || error.message;

          if (errorCode.includes('ENOENT') || errorCode.includes('not found')) {
            log.warn(`[Wiki Filing] Document not found: ${documentPath}`);
            return res.status(404).json({
              success: false,
              error: 'Document not found',
              path: documentPath,
              code: 'ENOENT'
            });
          }

          if (errorCode.includes('EACCES') || errorCode.includes('permission')) {
            log.warn(`[Wiki Filing] Access denied to document: ${documentPath}`);
            return res.status(403).json({
              success: false,
              error: 'Access denied to document',
              code: 'EACCES'
            });
          }

          log.error(`[Wiki Filing] Error reading document: ${documentPath}`, error);
          return res.status(500).json({
            success: false,
            error: 'Failed to read document',
            details: error.message,
            code: error.code || 'UNKNOWN'
          });
        }

        const contentSize = typeof content === 'string' ? content.length : content.byteLength;
        log.info(`[Wiki Filing] Successfully read document: ${documentPath} (${contentSize} bytes)`);

        // Get provider type from filing instance
        const filingInstance = spaceFilingManager.filingInstances.get(spaceId);
        const providerType = filingInstance?.providerType || 'unknown';

        // For binary files (images, PDFs, videos, audio), return raw binary content
        // so browsers can load them directly in img/video/audio/iframe tags
        if (['image', 'pdf', 'video', 'audio'].includes(viewerType)) {
          // Return raw binary content with appropriate headers
          const mimeType = getMimeTypeByExtension(documentPath);
          res.set('Content-Type', mimeType);
          res.set('Content-Length', contentSize);
          res.set('Cache-Control', 'public, max-age=3600');
          return res.send(content);
        }

        // For text-based files, return JSON with content and metadata
        const times = await statFileTimes(filingService, documentPath);

        // A converted office page keeps its untouched source in `.system/originals`;
        // surface it so the frontend's download button serves the original docx/
        // xlsx rather than the markdown page.
        const metadata = {
          size: contentSize,
          provider: providerType,
          encoding: encoding,
          viewer: viewerType,
          created: times.created,
          modified: times.modified
        };
        const storedOriginal = await resolveStoredOriginal(filingService, documentPath);
        if (storedOriginal) {
          metadata.originalDownloadPath = storedOriginal.path;
          metadata.originalName = storedOriginal.name;
        }

        // Count this read in the per-day usage tally (best effort; never blocks
        // or fails the read). `readVisit` only counts readable viewers by an
        // identifiable, non-opted-out caller — so MCP/API reads land here while
        // the daemon (a different route entirely) and binary/download responses
        // above do not.
        await readVisit.record({ req, space, viewerType, appBaseDir, log });

        res.json({
          success: true,
          content: content,
          path: documentPath,
          spaceId: spaceId,
          timestamp: new Date().toISOString(),
          metadata
        });

      } catch (error) {
        log.error('[Wiki Filing] Unexpected error reading document:', error);
        res.status(500).json({
          success: false,
          error: 'Unexpected error',
          details: error.message
        });
      }
    }
  );

  // =========================================================================
  // Download Document (Raw Binary/Text) - Like Filing Service Download Endpoint
  // =========================================================================

  /**
   * GET /applications/wiki/api/spaces/:spaceId/download/*
   *
   * Downloads document content as raw binary or text.
   * This endpoint returns the raw file content directly (not JSON-wrapped).
   * Respects space access permissions.
   *
   * @param spaceId - Space identifier
   * @param documentPath - Path relative to space's baseDir
   * @returns Raw file content with appropriate content-type headers
   */
  app.get('/applications/wiki/api/spaces/:spaceId/download/:documentPath(*)',
    async (req, res) => {
      try {
        const spaceId = parseInt(req.params.spaceId);
        const documentPath = req.params.documentPath;

        if (!spaceId || !documentPath) {
          return res.status(400).json({
            success: false,
            error: 'Space ID and document path are required'
          });
        }

        log.info(`[Wiki Download] Downloading document: space=${spaceId}, path=${documentPath}`);

        // ===== Step 1: Verify space exists =====
        let space;
        try {
          const spaces = await dataManager.read('spaces');
          space = spaces.find(s => s.id === spaceId);
        } catch (error) {
          log.error(`[Wiki Download] Error reading spaces list:`, error.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to read spaces'
          });
        }

        if (!space) {
          log.warn(`[Wiki Download] Space not found: ${spaceId}`);
          return res.status(404).json({
            success: false,
            error: 'Space not found',
            spaceId
          });
        }

        // ===== Step 2: Check access permissions =====
        if (req.isAuthenticated()) {
          const userEmail = req.user.email;

          const hasAccess =
            space.visibility === 'public' ||
            space.visibility === 'team' ||
            (space.visibility === 'private' &&
             space.allowedUsers &&
             space.allowedUsers.includes(userEmail));

          if (!hasAccess) {
            log.warn(`[Wiki Download] Access denied for user ${userEmail} to space ${spaceId}`);
            return res.status(403).json({
              success: false,
              error: 'Access denied to this space'
            });
          }
        } else {
          if (space.visibility !== 'public') {
            return res.status(401).json({
              success: false,
              error: 'Authentication required'
            });
          }
        }

        // ===== Step 2b: Check the space actually exposes this path =====
        // Covers the office-original download too: the visible markdown page
        // and its `.system/originals` source both resolve to the same folder.
        if (denyIfHidden(res, space, documentPath)) return;

        // ===== Step 3: Get filing service for this space =====
        let filingService;
        try {
          filingService = await spaceFilingManager.getFilingService(spaceId);
        } catch (error) {
          log.error(`[Wiki Download] Failed to get filing service for space ${spaceId}:`, error.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to initialize filing service for space',
            details: error.message
          });
        }

        if (!filingService) {
          log.error(`[Wiki Download] No filing service available for space ${spaceId}`);
          return res.status(500).json({
            success: false,
            error: 'Filing service not available'
          });
        }

        // ===== Step 4: Read file via filing service =====
        let content;
        try {
          log.debug(`[Wiki Download] Reading from filing service: ${documentPath}`);
          // No encoding => filingService returns a raw Buffer. Passing 'binary'
          // would make fs.readFile decode the file as latin-1 and return a
          // String, which Express then re-encodes as utf-8 in res.send —
          // corrupting every non-ASCII byte (Word sees the docx as damaged).
          content = await filingService.read(documentPath);
        } catch (error) {
          const errorCode = error.code || error.message;

          if (errorCode.includes('ENOENT') || errorCode.includes('not found')) {
            log.warn(`[Wiki Download] Document not found: ${documentPath}`);
            return res.status(404).json({
              success: false,
              error: 'Document not found',
              path: documentPath,
              code: 'ENOENT'
            });
          }

          if (errorCode.includes('EACCES') || errorCode.includes('permission')) {
            log.warn(`[Wiki Download] Access denied to document: ${documentPath}`);
            return res.status(403).json({
              success: false,
              error: 'Access denied to document',
              code: 'EACCES'
            });
          }

          log.error(`[Wiki Download] Error reading document: ${documentPath}`, error);
          return res.status(500).json({
            success: false,
            error: 'Failed to read document',
            details: error.message,
            code: error.code || 'UNKNOWN'
          });
        }

        const contentSize = typeof content === 'string' ? content.length : content.byteLength;
        log.info(`[Wiki Download] Successfully downloaded document: ${documentPath} (${contentSize} bytes)`);

        // Get MIME type and return raw content
        const mimeType = getMimeTypeByExtension(documentPath);
        res.set('Content-Type', mimeType);
        res.set('Content-Length', contentSize);
        res.set('Cache-Control', 'public, max-age=3600');

        // Check if download parameter is set
        if (req.query.download === 'true') {
          const fileName = documentPath.split('/').pop();
          res.set('Content-Disposition', `attachment; filename="${fileName}"`);
        }

        return res.send(content);

      } catch (error) {
        log.error('[Wiki Download] Unexpected error:', error);
        res.status(500).json({
          success: false,
          error: 'Unexpected error',
          details: error.message
        });
      }
    }
  );

  // =========================================================================
  // Update Document Content via Space Filing Service
  // =========================================================================

  /**
   * POST /applications/wiki/api/spaces/:spaceId/file-content/:documentPath
   *
   * Updates document content using space-configured filing service.
   * Requires authentication and write permissions on space.
   *
   * @body { content: string, reason?: string }
   * @returns { success: true, path: string, size: number }
   */
  app.post('/applications/wiki/api/spaces/:spaceId/file-content/:documentPath(*)',
    async (req, res) => {
      try {
        const spaceId = parseInt(req.params.spaceId);
        const documentPath = req.params.documentPath;
        const { content } = req.body;

        if (!req.isAuthenticated()) {
          return res.status(401).json({
            success: false,
            error: 'Authentication required'
          });
        }

        if (!spaceId || !documentPath || content === undefined) {
          return res.status(400).json({
            success: false,
            error: 'Space ID, document path, and content are required'
          });
        }

        log.info(`[Wiki Filing] Updating document: space=${spaceId}, path=${documentPath}`);

        // ===== Verify space and permissions =====
        let space;
        try {
          const fs = require('node:fs').promises;
          const path = require('node:path');

          // Direct file read to get spaces (same as spacesRoutes)
          const spacesPath = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
          const spacesData = await fs.readFile(spacesPath, 'utf8');
          const spaces = JSON.parse(spacesData);
          space = spaces.find(s => s.id === spaceId);
        } catch (error) {
          return res.status(500).json({
            success: false,
            error: 'Failed to read spaces'
          });
        }

        if (!space) {
          return res.status(404).json({
            success: false,
            error: 'Space not found'
          });
        }

        // Check write permissions
        if (space.permissions === 'read-only') {
          return res.status(403).json({
            success: false,
            error: 'This space is read-only'
          });
        }

        // RBAC for template writes via the editor save path: space-level
        // templates require a space admin; personal templates require ownership.
        const tplCheck = templateWriteCheck(req.user, space, documentPath);
        if (!tplCheck.allowed) {
          return res.status(403).json({ success: false, error: tplCheck.reason });
        }

        // ===== Get filing service =====
        let filingService;
        try {
          filingService = await spaceFilingManager.getFilingService(spaceId);
        } catch (error) {
          return res.status(500).json({
            success: false,
            error: 'Failed to initialize filing service'
          });
        }

        // ===== Update via filing service =====
        try {
          await filingService.update(documentPath, content);
          log.info(`[Wiki Filing] Successfully updated document: ${documentPath}`);

          // Emit event for real-time updates
          if (eventEmitter) {
            eventEmitter.emit('document-updated', {
              spaceId,
              path: documentPath,
              size: content.length,
              author: req.user.email,
              timestamp: new Date().toISOString()
            });
          }

          res.json({
            success: true,
            path: documentPath,
            size: content.length,
            timestamp: new Date().toISOString()
          });

        } catch (error) {
          log.error(`[Wiki Filing] Error updating document: ${documentPath}`, error);
          res.status(500).json({
            success: false,
            error: 'Failed to update document',
            details: error.message
          });
        }

      } catch (error) {
        log.error('[Wiki Filing] Unexpected error updating document:', error);
        res.status(500).json({
          success: false,
          error: 'Unexpected error',
          details: error.message
        });
      }
    }
  );

  // =========================================================================
  // Delete Document via Space Filing Service
  // =========================================================================

  /**
   * DELETE /applications/wiki/api/spaces/:spaceId/file-content/:documentPath
   *
   * Deletes document using space-configured filing service.
   * Requires authentication and write permissions.
   */
  app.delete('/applications/wiki/api/spaces/:spaceId/file-content/:documentPath(*)',
    async (req, res) => {
      try {
        const spaceId = parseInt(req.params.spaceId);
        const documentPath = req.params.documentPath;

        if (!req.isAuthenticated()) {
          return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        if (!spaceId || !documentPath) {
          return res.status(400).json({ success: false, error: 'Space ID and path required' });
        }

        let space;
        try {
          const fs = require('node:fs').promises;
          const path = require('node:path');

          // Direct file read to get spaces (same as spacesRoutes)
          const spacesPath = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
          const spacesData = await fs.readFile(spacesPath, 'utf8');
          const spaces = JSON.parse(spacesData);
          space = spaces.find(s => s.id === spaceId);
        } catch (error) {
          return res.status(500).json({ success: false, error: 'Failed to read spaces' });
        }

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        if (space.permissions === 'read-only') {
          return res.status(403).json({ success: false, error: 'Space is read-only' });
        }

        // RBAC for template deletes via the filing path.
        const tplCheck = templateWriteCheck(req.user, space, documentPath);
        if (!tplCheck.allowed) {
          return res.status(403).json({ success: false, error: tplCheck.reason });
        }

        const filingService = await spaceFilingManager.getFilingService(spaceId);

        try {
          await filingService.delete(documentPath);

          if (eventEmitter) {
            eventEmitter.emit('document-deleted', {
              spaceId,
              path: documentPath,
              author: req.user.email,
              timestamp: new Date().toISOString()
            });
          }

          res.json({ success: true, path: documentPath });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }

      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // =========================================================================
  // List Directory Contents via Space Filing Service
  // =========================================================================

  /**
   * GET /applications/wiki/api/spaces/:spaceId/file-list/:directoryPath
   *
   * Lists contents of directory using space filing service.
   * Returns array of file/directory names.
   */
  app.get('/applications/wiki/api/spaces/:spaceId/file-list/:directoryPath(*)',
    async (req, res) => {
      try {
        const spaceId = parseInt(req.params.spaceId);
        const dirPath = req.params.directoryPath || '';

        let space;
        try {
          const fs = require('node:fs').promises;
          const path = require('node:path');

          // Direct file read to get spaces (same as spacesRoutes)
          const spacesPath = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
          const spacesData = await fs.readFile(spacesPath, 'utf8');
          const spaces = JSON.parse(spacesData);
          space = spaces.find(s => s.id === spaceId);
        } catch (error) {
          return res.status(500).json({ success: false, error: 'Failed to read spaces' });
        }

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        // A folder the space doesn't expose is not listable; a pass-through
        // ancestor IS (the nav can show it), but only its surviving children
        // come back.
        if (denyIfHidden(res, space, dirPath, 'folder')) return;

        const filingService = await spaceFilingManager.getFilingService(spaceId);

        try {
          const files = await filingService.list(dirPath || '.');
          const visible = compileVisibility(space).filterEntries(dirPath, files);
          res.json({ success: true, files: visible, directory: dirPath });
        } catch (error) {
          res.status(500).json({ success: false, error: error.message });
        }

      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // =========================================================================
  // Get Folder Tree via Space Filing Service
  // =========================================================================

  /**
   * GET /applications/wiki/api/spaces/:spaceId/folder-tree
   *
   * Builds a folder tree using the space-configured filing service.
   *
   * LAZY BY DEFAULT. Only `depth` levels are walked (2 unless overridden); a
   * folder below the cut comes back with `children: []` and `truncated: true`,
   * meaning "not listed yet", NOT "empty". The client fetches those on demand by
   * repeating the request with `path` set to the folder it needs. Pass
   * `depth=all` for the old exhaustive walk — on a large content root that is
   * the request that never returns, so it is opt-in.
   *
   * @param spaceId - Space identifier
   * @query {string} [path] - space-relative folder to return the subtree of
   * @query {number|'all'} [depth] - levels to list (default WIKI_TREE_DEPTH, 2)
   * @returns { success: true, tree: Array<folder|document>, path, depth }
   */
  app.get('/applications/wiki/api/spaces/:spaceId/folder-tree',
    async (req, res) => {
      try {
        const spaceId = parseInt(req.params.spaceId);
        const depth = requestedDepth(req);
        // '' and '/' and '.' all mean the space root.
        const subPath = String((req.query || {}).path || '')
          .replace(/\\/g, '/')
          .replace(/^\.$/, '')
          .replace(/^\/+|\/+$/g, '');

        // ===== Step 1: Get space =====
        let space;
        try {
          const fs = require('node:fs').promises;
          const path = require('node:path');

          // Direct file read to get spaces (same as spacesRoutes)
          const spacesPath = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
          const spacesData = await fs.readFile(spacesPath, 'utf8');
          const spaces = JSON.parse(spacesData);
          space = spaces.find(s => s.id === spaceId);
        } catch (error) {
          log.error(`[Wiki Filing] Error reading spaces:`, error.message);
          return res.status(500).json({ success: false, error: 'Failed to read spaces' });
        }

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        // ===== Step 2: Check access =====
        if (req.isAuthenticated()) {
          const userEmail = req.user.email;
          const hasAccess =
            space.visibility === 'public' ||
            space.visibility === 'team' ||
            (space.visibility === 'private' && space.allowedUsers?.includes(userEmail));

          if (!hasAccess) {
            return res.status(403).json({ success: false, error: 'Access denied' });
          }
        } else {
          if (space.visibility !== 'public') {
            return res.status(401).json({ success: false, error: 'Authentication required' });
          }
        }

        // ===== Step 3: Subtree requests — path safety + visibility =====
        if (subPath.split('/').includes('..')) {
          return res.status(400).json({ success: false, error: 'Invalid path' });
        }
        // A folder this space does not expose must not be listable through the
        // lazy loader either — 404, matching every other read of a hidden path.
        if (subPath && denyIfHidden(res, space, subPath, 'folder')) return;

        // ===== Step 4: Cache lookup + ETag validation =====
        // Only the ROOT tree is ETag-cached per space: it is the one every page
        // load asks for, and it is the one the client keeps in localStorage.
        // Subtree fetches are served from the shared raw-tree cache below, which
        // is keyed by (root, path, depth) and invalidated by the same events.
        const cacheable = !subPath;
        const cached = (cacheable && treeCache) ? treeCache.get(spaceId) : null;
        // A cached tree walked to a different depth is a different answer.
        const cacheHit = cached && cached.depth === depth;
        const ifNoneMatch = req.get('If-None-Match');
        if (cacheHit && ifNoneMatch && ifNoneMatch === cached.etag) {
          res.setHeader('ETag', cached.etag);
          res.setHeader('Cache-Control', 'no-cache');
          return res.status(304).end();
        }

        if (cacheHit) {
          res.setHeader('ETag', cached.etag);
          res.setHeader('Cache-Control', 'no-cache');
          return res.json({ success: true, tree: cached.tree, spaceId, path: '', depth });
        }

        // ===== Step 5: Get filing service =====
        let filingService;
        try {
          filingService = await spaceFilingManager.getFilingService(spaceId);
        } catch (error) {
          log.error(`[Wiki Filing] Error getting filing service for space ${spaceId}:`, error.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to initialize filing service'
          });
        }

        // ===== Step 6: Build tree via filing service =====
        let tree;
        try {
          // Shared by CONTENT ROOT, not by space. Several spaces can sit on one
          // root (different curated views of the same files), and the walk that
          // produces the raw tree is a pure function of the directory — so it is
          // done once and each space prunes its own view out of the result.
          // rawTreeForRoot() also coalesces concurrent callers, which matters
          // because a single page load can ask for the same tree two or three
          // times before the first answer lands (space auto-select, deep link),
          // and every one of those used to start its own full walk.
          tree = await rawTreeForRoot(space, filingService, log, { subPath, depth });

          // Prune to what this space exposes BEFORE the tree is cached — the
          // cache is keyed by spaceId and the filter is a pure function of the
          // space, so the cached tree stays correct for every viewer of it.
          const visibility = compileVisibility(space);
          if (visibility.restricted) {
            const beforeCount = tree.length;
            tree = visibility.filterTree(tree);
            log.info(`[Wiki Filing] Space ${spaceId} path filter: ${beforeCount} -> ${tree.length} root items`);
          }

          // Drop everything the client can derive for itself. `path` alone is
          // over 40% of the payload and is implied by the nesting; title,
          // fileName and spaceName are duplicates of name/the response itself.
          // navigationController.rehydrateTree() puts them back in one pass.
          // On a large space this is the difference between a 17 MB response and
          // a 6 MB one — per space, per cache miss.
          tree = leanTree(tree);

          log.info(`[Wiki Filing] Tree built for space ${spaceId} at "${subPath || '/'}": ${tree.length} items`);

          if (tree.length === 0 && !subPath) {
            log.warn(`[Wiki Filing] Space ${spaceId} returned empty tree - checking filing service...`);
            // Try to diagnose why tree is empty
            try {
              const testList = await filingService.list('.');
              log.warn(`[Wiki Filing] Filing service returned ${testList.length} items for root of space ${spaceId}:`, testList.map(e => typeof e === 'string' ? e : e.name));
            } catch (diagError) {
              log.error(`[Wiki Filing] Filing service error for space ${spaceId}:`, diagError.message);
            }
          }
        } catch (error) {
          log.error(`[Wiki Filing] Error building tree for space ${spaceId}:`, error.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to build folder tree',
            details: error.message,
            code: error.code
          });
        }

        // ===== Step 7: Store in cache and respond =====
        if (cacheable && treeCache) {
          const entry = treeCache.set(spaceId, tree, { depth });
          res.setHeader('ETag', entry.etag);
          res.setHeader('Cache-Control', 'no-cache');
        }

        res.json({ success: true, tree, spaceId, path: subPath, depth });

      } catch (error) {
        log.error('[Wiki Filing] Unexpected error building folder tree:', error.message);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // =========================================================================
  // Recent changes in a folder subtree
  // =========================================================================

  /**
   * GET /applications/wiki/api/spaces/:spaceId/recent-changes
   *
   * What changed most recently in one folder and everything beneath it —
   * the answer behind the ```recent-changes``` landing block.
   *
   * Unlike `/folder-tree` this walk is RECURSIVE by default, because "and its
   * underlying folders" is the whole question. The cost that makes the folder
   * tree lazy still applies, so the walk is bounded two ways (depth, and a
   * directory-listing budget) and the result is cached — see
   * `recentEntriesForSpace`. `truncated: true` means the scan hit one of those
   * bounds and something older may be missing, NOT that nothing else changed.
   *
   * @param spaceId - Space identifier
   * @query {string} path - space-relative folder to scan ('' = the space root)
   * @query {number} [days=30] - look-back window; `0`/`all` for no window
   * @query {number} [limit=8] - most items to return (max 60)
   * @query {string} [types=all] - `all` | `documents` | `folders`
   * @query {number|'all'} [depth] - levels to walk (default: the full cap)
   * @returns { success, items, folder, days, limit, truncated, scannedDirs }
   */
  app.get('/applications/wiki/api/spaces/:spaceId/recent-changes',
    async (req, res) => {
      try {
        const spaceId = parseInt(req.params.spaceId);
        // Same normalisation as folder-tree: '', '/' and '.' all mean the root.
        const subPath = String((req.query || {}).path || '')
          .replace(/\\/g, '/')
          .replace(/^\.$/, '')
          .replace(/^\/+|\/+$/g, '');
        const { days, limit, types } = normaliseRecentQuery(req.query || {});
        // A recent-changes block asks about a whole subtree, so the default is
        // the full cap rather than DEFAULT_TREE_DEPTH — but a caller pointing
        // at a very large folder can still trade completeness for speed.
        const rawDepth = (req.query || {}).depth;
        const depth = rawDepth === undefined || rawDepth === '' || rawDepth === null
          ? MAX_TREE_DEPTH
          : requestedDepth(req);

        let space;
        try {
          const fs = require('node:fs').promises;
          const path = require('node:path');
          const spacesPath = path.join(
            appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
          const spaces = JSON.parse(await fs.readFile(spacesPath, 'utf8'));
          space = spaces.find(s => s.id === spaceId);
        } catch (error) {
          log.error('[Wiki Filing] Error reading spaces:', error.message);
          return res.status(500).json({ success: false, error: 'Failed to read spaces' });
        }
        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        // Same access test the folder-tree endpoint applies.
        if (req.isAuthenticated()) {
          const userEmail = req.user.email;
          const hasAccess =
            space.visibility === 'public' ||
            space.visibility === 'team' ||
            (space.visibility === 'private' && space.allowedUsers?.includes(userEmail));
          if (!hasAccess) {
            return res.status(403).json({ success: false, error: 'Access denied' });
          }
        } else if (space.visibility !== 'public') {
          return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        if (subPath.split('/').includes('..')) {
          return res.status(400).json({ success: false, error: 'Invalid path' });
        }
        // A folder this space does not expose is not scannable either — 404,
        // matching every other read of a hidden path.
        if (subPath && denyIfHidden(res, space, subPath, 'folder')) return;

        let filingService;
        try {
          filingService = await spaceFilingManager.getFilingService(spaceId);
        } catch (error) {
          log.error(`[Wiki Filing] Error getting filing service for space ${spaceId}:`, error.message);
          return res.status(500).json({
            success: false, error: 'Failed to initialize filing service'
          });
        }

        const scan = await recentEntriesForSpace(space, filingService, log, { subPath, depth });

        // The folder the block names cannot be listed. Answering "nothing
        // changed" would leave a mistyped or moved path looking like a quiet
        // week; 404 is also exactly what `denyIfHidden` above returns for a
        // folder this space curates away, so the two stay indistinguishable.
        if (scan.missing) {
          log.warn(`[Wiki Filing] Recent changes: folder not listable — space=${spaceId}, path=${subPath}`);
          return res.status(404).json({ success: false, error: 'Folder not found' });
        }

        res.json({
          success: true,
          items: selectRecent(scan.items, { days, limit, types }),
          spaceId,
          spaceName: space.name,
          folder: subPath,
          days,
          limit,
          types,
          depth,
          truncated: scan.truncated,
          scannedDirs: scan.scannedDirs,
          generatedAt: new Date(scan.builtAt).toISOString()
        });

      } catch (error) {
        log.error('[Wiki Filing] Unexpected error scanning recent changes:', error.message);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // =========================================================================
  // Recent changes across the reader's pins
  // =========================================================================

  /**
   * GET /applications/wiki/api/spaces/:spaceId/pinned-recent-changes
   *
   * The same activity feed as `/recent-changes`, but scoped to whatever THIS
   * READER has pinned instead of to a folder the page's author named — the
   * answer behind the ```pinned-recent-changes``` block.
   *
   * PER-USER, so unlike its sibling it always requires a session even in a
   * public space: there is no such thing as an anonymous reader's pins, and
   * answering with somebody else's would be worse than answering with none.
   *
   * Pins are read through `userArtifacts.forSpace`, which drops the legacy
   * space-name stamp and scopes by the space's REAL visibility rules — so a pin
   * on a path this space curates away is not scanned, and a renamed space
   * breaks nothing (see components/userArtifacts.js).
   *
   * @param spaceId - Space identifier
   * @query {number} [days=30] - look-back window; `0`/`all` for no window
   * @query {number} [limit=8] - most items to return (max 60)
   * @query {string} [types=all] - `all` | `documents` | `folders`
   * @query {number|'all'} [depth] - levels to walk below each pinned folder
   * @returns { success, items, pinned:{folders,documents,scanned,skipped}, … }
   */
  app.get('/applications/wiki/api/spaces/:spaceId/pinned-recent-changes',
    async (req, res) => {
      try {
        if (!req.isAuthenticated || !req.isAuthenticated()) {
          return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const spaceId = parseInt(req.params.spaceId);
        const { days, limit, types } = normaliseRecentQuery(req.query || {});
        const rawDepth = (req.query || {}).depth;
        const depth = rawDepth === undefined || rawDepth === '' || rawDepth === null
          ? MAX_TREE_DEPTH
          : requestedDepth(req);

        let space;
        try {
          const fs = require('node:fs').promises;
          const path = require('node:path');
          const spacesPath = path.join(
            appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
          const spaces = JSON.parse(await fs.readFile(spacesPath, 'utf8'));
          space = spaces.find(s => s.id === spaceId);
        } catch (error) {
          log.error('[Wiki Filing] Error reading spaces:', error.message);
          return res.status(500).json({ success: false, error: 'Failed to read spaces' });
        }
        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        const hasAccess =
          space.visibility === 'public' ||
          space.visibility === 'team' ||
          (space.visibility === 'private' && space.allowedUsers?.includes(req.user.email));
        if (!hasAccess) {
          return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Pins live per CONTENT ROOT, keyed by the space's store, and are
        // scoped to what this space exposes before anything is scanned.
        let pins = [];
        try {
          const raw = await spaceUserStore.readJson(
            appBaseDir, space.id, req.user.email, 'pins.json', []);
          pins = userArtifacts.forSpace(space, raw);
        } catch (error) {
          // A reader with no pins file yet is the common case on a first visit,
          // not a failure — answer with an empty feed rather than a 500.
          log.warn(`[Wiki Filing] Could not read pins for ${req.user.email}: ${error.message}`);
        }

        let filingService;
        try {
          filingService = await spaceFilingManager.getFilingService(spaceId);
        } catch (error) {
          log.error(`[Wiki Filing] Error getting filing service for space ${spaceId}:`, error.message);
          return res.status(500).json({
            success: false, error: 'Failed to initialize filing service'
          });
        }

        const startedAt = Date.now();
        const scan = await pinnedRecentEntries(space, filingService, log, pins, { depth });
        log.info(
          `[Wiki Filing] Pinned recent changes for ${req.user.email} in space ${spaceId}: `
          + `${scan.plan.folders.length} folders + ${scan.plan.documentGroups.length} doc groups, `
          + `${scan.scannedDirs} listings in ${Date.now() - startedAt}ms`);

        res.json({
          success: true,
          items: selectRecent(scan.items, { days, limit, types }),
          spaceId,
          spaceName: space.name,
          pinned: {
            folders: scan.plan.pinnedFolders,
            documents: scan.plan.pinnedDocuments,
            scanned: scan.plan.folders.length + scan.plan.documentGroups.length,
            skipped: scan.plan.skipped
          },
          days,
          limit,
          types,
          depth,
          truncated: scan.truncated,
          scannedDirs: scan.scannedDirs,
          generatedAt: new Date(scan.builtAt).toISOString()
        });

      } catch (error) {
        log.error('[Wiki Filing] Unexpected error scanning pinned changes:', error.message);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // =========================================================================
  // Rebuild AI context (folder subtree, or a single file)
  // =========================================================================

  /**
   * Ready the workflow bridge and confirm the context build is deployed here.
   * @param {Object} workflowBridge - From `req.app.get('workflowBridge')`.
   * @return {Promise<string|null>} An error message when unusable, else null.
   */
  async function contextWorkflowUnavailable(workflowBridge) {
    if (!workflowBridge) return 'Workflow engine not available';
    if (workflowBridge.initialized === false && typeof workflowBridge.whenReady === 'function') {
      await workflowBridge.whenReady();
    }
    if (!workflowBridge.resolveWorkflowByName(CONTEXT_WORKFLOW_NAME)) {
      return `Context workflow "${CONTEXT_WORKFLOW_NAME}" is not available`;
    }
    return null;
  }

  /**
   * POST /applications/wiki/api/spaces/:spaceId/context/rebuild
   * Body: { folderPath?: string }  ('' or '/' = space root)
   *
   * Runs the system-context group's on-demand build in FOLDER mode: the step
   * walks the folder's subtree bottom-up (deepest first), rebuilds every child
   * folder's sidecars + `_folder.md` roll-up, and finishes with the folder that
   * was asked for — so its roll-up sees freshly-built children. `force: true`
   * overwrites existing context instead of reusing up-to-date sidecars.
   *
   * Deliberately started ASYNCHRONOUSLY via startWorkflowByName: a subtree
   * rebuild is many AI calls and would blow any HTTP timeout. The caller gets an
   * executionId and polls the shared status endpoint, and the run shows up in
   * the datasources executions log like any other workflow — which is the
   * visibility this exists for.
   *
   * NOTE: this is the same workflow the file-watcher's ContextTrigger runs, but
   * that one passes a `files` list (TARGETED mode, one folder, no recursion).
   * Omitting `files` entirely is what selects the recursive walk.
   */
  app.post('/applications/wiki/api/spaces/:spaceId/context/rebuild', async (req, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const path = require('node:path');
      const fs = require('node:fs').promises;
      const spaceId = parseInt(req.params.spaceId);
      if (Number.isNaN(spaceId)) {
        return res.status(400).json({ success: false, error: 'Invalid space id' });
      }

      // Normalise the folder: the UI uses '/' for the space root, the step wants
      // '' — and it must stay space-RELATIVE (a leading slash would resolve as
      // absolute and escape the space).
      const raw = typeof req.body?.folderPath === 'string' ? req.body.folderPath : '';
      const folder = raw.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

      // Context belongs to real content folders. A hidden folder is app plumbing
      // (`.system`, the chat's `.aicontext`, …) — building context there wastes
      // AI runs and litters a disposable folder. The step guards this too; fail
      // fast here so the user gets a message instead of a "successful" no-op.
      if (folder.split('/').some(segment => segment.startsWith('.'))) {
        return res.status(400).json({
          success: false,
          error: 'Context can only be rebuilt for content folders'
        });
      }

      let space;
      try {
        const spacesPath = path.join(
          appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
        const spaces = JSON.parse(await fs.readFile(spacesPath, 'utf8'));
        space = spaces.find(s => s.id === spaceId);
      } catch (error) {
        return res.status(500).json({ success: false, error: 'Failed to read spaces' });
      }
      if (!space) {
        return res.status(404).json({ success: false, error: 'Space not found' });
      }

      // A folder this space does not expose must not be rebuildable through it.
      if (denyIfHidden(res, space, folder, 'folder')) return;

      const workflowBridge = req.app.get('workflowBridge');
      const unavailable = await contextWorkflowUnavailable(workflowBridge);
      if (unavailable) {
        return res.status(503).json({ success: false, error: unavailable });
      }

      // The workflow's `defaultInput` is used ONLY when the input is entirely
      // empty (workflowBridge.executeWorkflow), never merged — so every field
      // this run needs must be supplied here. In particular appBaseDir must be
      // ABSOLUTE (the step would otherwise resolve a relative default against
      // the worker's cwd) and aiTimeoutMs must be explicit (the step's own
      // fallback is 0 = wait forever, which would hang the run on a stalled call).
      const execution = await workflowBridge.startWorkflowByName(CONTEXT_WORKFLOW_NAME, {
        space: space.name,
        folder,
        force: true,
        appBaseDir: path.resolve(appBaseDir || path.join(process.cwd(), '.application')),
        aiTimeoutMs: CONTEXT_REBUILD_AI_TIMEOUT_MS,
        aiRetries: 3
      });

      log.info(`[Wiki Filing] Context rebuild started for ${space.name}/${folder || '(root)'} `
        + `by ${req.user?.email || 'unknown'} (execution ${execution.executionId})`);

      return res.status(202).json({
        success: true,
        executionId: execution.executionId,
        space: space.name,
        folder
      });
    } catch (error) {
      log.error('[Wiki Filing] Failed to start context rebuild:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /applications/wiki/api/spaces/:spaceId/context/rebuild-file
   * Body: { filePath }    — space-relative path of the SOURCE document, or
   *       { contextPath } — space-relative path of its `.system/context/` sidecar
   *
   * The single-document counterpart of the folder rebuild above. Runs the same
   * workflow but in the step's TARGETED mode (`files: [...]`): it re-summarises
   * exactly this document and then rebuilds its folder's `_folder.md` roll-up
   * from the folder's existing sidecars — two AI calls, no subtree walk, no
   * recursion. This is what the AI Context Manager's per-file Regenerate button
   * calls, so the user can fix one stale or "(summary unavailable)" sidecar
   * without paying for the whole folder.
   *
   * Either identifier is accepted because the two callers hold different things:
   * the Context Manager lists sidecars (it has the `contextPath`), while a
   * document view has the document (`filePath`). `fromContextRelPath` resolves the
   * `x.md` / `x.pdf.md` ambiguity, and returns null for the `_folder.md` roll-up —
   * which has no source document and is therefore rejected with a pointer at the
   * folder rebuild.
   *
   * Asynchronous like the folder rebuild: 202 + executionId, polled by the caller
   * against the shared execution-status endpoint, and visible in the datasources
   * executions log.
   */
  app.post('/applications/wiki/api/spaces/:spaceId/context/rebuild-file', async (req, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const path = require('node:path');
      const fs = require('node:fs').promises;
      const spaceId = parseInt(req.params.spaceId);
      if (Number.isNaN(spaceId)) {
        return res.status(400).json({ success: false, error: 'Invalid space id' });
      }

      const norm = (value) => (typeof value === 'string' ? value : '')
        .replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const rawFile = norm(req.body?.filePath);
      const rawContext = norm(req.body?.contextPath);

      // A context path is translated back to the document it describes; a file
      // path is already that document.
      //
      // The sidecar name is ambiguous by construction — `x.md` describes `x.md`
      // while `x.pdf.md` describes `x.pdf` — and fromContextRelPath resolves it by
      // asking whether anything remains after stripping `.md`. That rule mis-reads
      // a markdown document with a dotted name (`notes.v2.md` → `notes.v2`), so
      // carry the alternative as a second candidate and let the disk decide below.
      const candidates = [];
      if (rawFile) {
        candidates.push(rawFile);
      } else if (rawContext) {
        const primary = fromContextRelPath(rawContext);
        if (!primary) {
          return res.status(400).json({
            success: false,
            error: 'That is a folder roll-up, not a document — rebuild the folder instead'
          });
        }
        candidates.push(primary);

        const ctxSlash = rawContext.lastIndexOf('/');
        const ctxName = ctxSlash >= 0 ? rawContext.slice(ctxSlash + 1) : rawContext;
        const asMarkdown = primary.slice(0, primary.lastIndexOf('/') + 1) + ctxName;
        if (asMarkdown !== primary) candidates.push(asMarkdown);
      }
      if (candidates.length === 0) {
        return res.status(400).json({ success: false, error: 'filePath or contextPath is required' });
      }
      let filePath = candidates[0];

      // Context belongs to real documents in real content folders. Reject any
      // hidden segment: a `.system`/`.aicontext` path is app plumbing, and the
      // step would refuse it anyway — fail here so the user gets a message rather
      // than a "successful" no-op.
      if (filePath.split('/').some(segment => segment.startsWith('.'))) {
        return res.status(400).json({
          success: false,
          error: 'Context can only be rebuilt for documents in content folders'
        });
      }

      // Every candidate lives in the same folder (they differ only in file name).
      const slash = filePath.lastIndexOf('/');
      const folder = slash > 0 ? filePath.slice(0, slash) : '';

      let space;
      try {
        const spacesPath = path.join(
          appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
        const spaces = JSON.parse(await fs.readFile(spacesPath, 'utf8'));
        space = spaces.find(s => s.id === spaceId);
      } catch (error) {
        return res.status(500).json({ success: false, error: 'Failed to read spaces' });
      }
      if (!space) {
        return res.status(404).json({ success: false, error: 'Space not found' });
      }

      // Settle the candidates against the folder's actual contents, and confirm the
      // source is really there: the step would otherwise log "no such file" into a
      // background execution the user never looks at, where a 404 says it in the
      // panel. One directory listing, matched by name (see statFileTimes).
      try {
        const filingService = await spaceFilingManager.getFilingService(spaceId);
        const entries = await filingService.list(folder || '.');
        const names = new Set((entries || []).map(e => String((e && e.name) || e)));
        const found = candidates.find(c => names.has(c.slice(c.lastIndexOf('/') + 1)));
        if (!found) {
          return res.status(404).json({ success: false, error: `Document not found: ${filePath}` });
        }
        filePath = found;
      } catch (error) {
        return res.status(404).json({ success: false, error: `Document not found: ${filePath}` });
      }

      // A document this space does not expose must not be rebuildable through it.
      // Checked on the RESOLVED path (a rule can name a single file) and after the
      // existence check, which is safe because both answer a bare 404 — neither
      // confirms that a hidden document is there.
      if (denyIfHidden(res, space, filePath, 'file')) return;

      const workflowBridge = req.app.get('workflowBridge');
      const unavailable = await contextWorkflowUnavailable(workflowBridge);
      if (unavailable) {
        return res.status(503).json({ success: false, error: unavailable });
      }

      // Same input contract as the folder rebuild — defaultInput is not merged, so
      // appBaseDir must be absolute and aiTimeoutMs explicit — plus `files`, which
      // is what selects targeted mode. `force: true` overwrites the existing
      // sidecar instead of leaving an up-to-date one alone (the whole point of a
      // manual Regenerate).
      const execution = await workflowBridge.startWorkflowByName(CONTEXT_WORKFLOW_NAME, {
        space: space.name,
        folder,
        files: [filePath],
        force: true,
        appBaseDir: path.resolve(appBaseDir || path.join(process.cwd(), '.application')),
        aiTimeoutMs: CONTEXT_REBUILD_AI_TIMEOUT_MS,
        aiRetries: 3
      });

      log.info(`[Wiki Filing] Context rebuild started for file ${space.name}/${filePath} `
        + `by ${req.user?.email || 'unknown'} (execution ${execution.executionId})`);

      return res.status(202).json({
        success: true,
        executionId: execution.executionId,
        space: space.name,
        folder,
        filePath,
        contextPath: toContextRelPath(filePath)
      });
    } catch (error) {
      log.error('[Wiki Filing] Failed to start file context rebuild:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  // =========================================================================
  // Cache Management: Clear the in-memory folder tree cache
  // =========================================================================
  // POST /applications/wiki/api/admin/clear-tree-cache — clear all cached folder trees
  // This is useful when files have been deleted/modified outside the normal API flow
  // (e.g. during a rebuild workflow) and the in-memory cache needs to be purged.
  app.post('/applications/wiki/api/admin/clear-tree-cache', (req, res) => {
    try {
      if (!treeCache) {
        return res.status(500).json({ success: false, error: 'TreeCache not available' });
      }

      treeCache.invalidateAll();
      log.info('[Wiki Admin] Tree cache cleared');
      res.json({ success: true, message: 'Tree cache cleared successfully' });
    } catch (error) {
      log.error('[Wiki Admin] Error clearing tree cache:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // GET /applications/wiki/api/admin/clear-tree-cache — same as POST (for browser convenience)
  app.get('/applications/wiki/api/admin/clear-tree-cache', (req, res) => {
    try {
      if (!treeCache) {
        return res.status(500).json({ success: false, error: 'TreeCache not available' });
      }

      treeCache.invalidateAll();
      log.info('[Wiki Admin] Tree cache cleared');
      res.json({ success: true, message: 'Tree cache cleared successfully' });
    } catch (error) {
      log.error('[Wiki Admin] Error clearing tree cache:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  log.info('✓ Wiki filing routes initialized');
};

/* ==========================================================================
 * Shared raw-tree builds, keyed by CONTENT ROOT
 * ========================================================================== */

/** buildKey -> Promise<rawTree> for a build that is currently running. */
const treeBuildsInFlight = new Map();

/** buildKey -> { tree, builtAt } for the most recent completed build. */
const rawTreeByRoot = new Map();

/** How long a completed raw tree may be reused. Invalidation is event-driven
 *  (see attachRawTreeInvalidation); this is a backstop for anything that
 *  changes the content root without raising a wiki event at all — a git pull
 *  into a symlinked repo folder, for instance. */
const RAW_TREE_MAX_AGE_MS = 60000;

/**
 * How long a completed recent-changes scan is reused.
 *
 * DELIBERATELY NOT wired into `attachRawTreeInvalidation`, unlike the raw tree
 * beside it. The nav tree must drop on every file event because a new document
 * has to appear in the sidebar the moment it lands; a "what changed lately"
 * panel has no such duty, and it is backed by a RECURSIVE walk — the exact walk
 * the lazy folder tree exists to avoid. Clearing it per event would mean a
 * space with a workflow writing files re-walks the subtree for every reader,
 * for a panel nobody can tell is thirty seconds stale.
 */
const RECENT_SCAN_MAX_AGE_MS = Math.max(
  1000, Number(process.env.WIKI_RECENT_SCAN_TTL_MS) || 60000);

/** scanKey -> { items, truncated, scannedDirs, builtAt } */
const recentScanCache = new Map();

/** scanKey -> in-flight scan promise, so concurrent blocks share one walk. */
const recentScansInFlight = new Map();

/** The content root a space's tree is walked from, normalised for comparison. */
function rootKeyFor(space) {
  return contentRootKey(space);
}

/**
 * A folder subtree's entries, newest first — cached, and coalesced across
 * concurrent callers.
 *
 * Keyed by SPACE as well as content root, unlike `rawTreeForRoot`. The raw tree
 * is walked once per root and pruned per space afterwards because the walk is a
 * pure function of the directory; here the pruning happens DURING the walk (a
 * curated space should not pay to descend into a subtree it will discard), so
 * two spaces on one root genuinely produce different scans.
 *
 * The scan itself is time-independent: `days`/`limit`/`types` are applied to
 * the result, so every block pointed at the same folder shares one walk no
 * matter what window each asks for.
 *
 * @param {Object} space
 * @param {Object} filingService - space-scoped filing service
 * @param {Object} log
 * @param {Object} [options]
 * @param {string} [options.subPath] - folder to scan ('' = the space root)
 * @param {number} [options.depth] - levels to walk below `subPath`
 * @return {Promise<{items:Array, truncated:boolean, scannedDirs:number, builtAt:number}>}
 */
async function recentEntriesForSpace(space, filingService, log, options = {}) {
  const subPath = options.subPath || '';
  const depth = options.depth || MAX_TREE_DEPTH;
  const scanKey = `${rootKeyFor(space)}|s${space.id}|${subPath.toLowerCase()}|d${depth}`;

  const cached = recentScanCache.get(scanKey);
  if (cached && Date.now() - cached.builtAt < RECENT_SCAN_MAX_AGE_MS) {
    return cached;
  }

  const running = recentScansInFlight.get(scanKey);
  if (running) {
    log.info(`[Wiki Filing] Joining in-flight recent-changes scan for "${scanKey}"`);
    return running;
  }

  const scan = (async () => {
    const startedAt = Date.now();
    const result = await collectRecentEntries(filingService, {
      subPath,
      depth,
      visibility: compileVisibility(space)
    });
    const entry = Object.assign({ builtAt: Date.now() }, result);
    // Nothing else evicts this map — there is no invalidation event feeding it
    // — so drop what has already gone stale before adding to it. Keys are
    // (root, space, folder, depth) combinations, which a wiki full of landing
    // pages accumulates steadily.
    for (const [key, value] of recentScanCache) {
      if (entry.builtAt - value.builtAt >= RECENT_SCAN_MAX_AGE_MS) recentScanCache.delete(key);
    }
    recentScanCache.set(scanKey, entry);
    log.info(
      `[Wiki Filing] Recent-changes scan "${scanKey}": ${entry.items.length} entries `
      + `from ${entry.scannedDirs} listings in ${Date.now() - startedAt}ms`
      + (entry.truncated ? ' (truncated)' : ''));
    return entry;
  })();

  recentScansInFlight.set(scanKey, scan);
  try {
    return await scan;
  } finally {
    // Always clear, including on failure — a rejected scan must not be handed
    // to every later caller.
    recentScansInFlight.delete(scanKey);
  }
}

/**
 * How many pinned scans run at once.
 *
 * Small on purpose. These are sequential-readdir walks over content roots of
 * symlinked git repositories, so the box is IO-bound, not CPU-bound, and firing
 * a dozen at once mostly buys queueing plus a worse tail for whoever else is
 * loading a folder tree. Three overlaps enough to hide per-walk latency without
 * turning one reader's landing page into the busiest thing on the server.
 */
const PINNED_SCAN_CONCURRENCY = Math.max(
  1, Number(process.env.WIKI_PINNED_SCAN_CONCURRENCY) || 3);

/**
 * Everything that changed lately across a reader's PINS, newest first.
 *
 * Fans out over `planPinnedScan`'s reduced set and reuses
 * `recentEntriesForSpace` for every leg, which is the point: a pinned folder
 * that some other block on the page already scanned costs nothing the second
 * time, and two readers who pin the same folder share one walk.
 *
 * @param {Object} space
 * @param {Object} filingService - space-scoped filing service
 * @param {Object} log
 * @param {Array<Object>} pins - normalised, space-scoped pin records
 * @param {Object} [options]
 * @param {number} [options.depth] - levels to walk below each pinned folder
 * @return {Promise<{items:Array, truncated:boolean, scannedDirs:number,
 *                   plan:Object, builtAt:number}>}
 */
async function pinnedRecentEntries(space, filingService, log, pins, options = {}) {
  const depth = options.depth || MAX_TREE_DEPTH;
  const plan = planPinnedScan(pins);

  // A pinned FOLDER is walked in full. A pinned DOCUMENT is reached by listing
  // its parent one level deep and keeping only the pinned paths — the same
  // walk, the same visibility rules, the same cache, rather than a second way
  // of asking the file system about one file.
  const legs = [
    ...plan.folders.map(folder => ({ subPath: folder, depth, keep: null })),
    ...plan.documentGroups.map(group => ({
      subPath: group.dir, depth: 1, keep: new Set(group.paths)
    }))
  ];

  const results = new Array(legs.length);
  let truncated = false;
  let scannedDirs = 0;
  let next = 0;

  const worker = async () => {
    for (let i = next++; i < legs.length; i = next++) {
      const leg = legs[i];
      const scan = await recentEntriesForSpace(space, filingService, log, {
        subPath: leg.subPath, depth: leg.depth
      });
      // A pin whose target has been deleted is not an error for the panel —
      // the other pins still have news. It simply contributes nothing.
      if (scan.missing) continue;
      truncated = truncated || scan.truncated;
      scannedDirs += scan.scannedDirs;
      results[i] = leg.keep
        ? scan.items.filter(item => leg.keep.has(item.path))
        : scan.items;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PINNED_SCAN_CONCURRENCY, legs.length) }, worker));

  return {
    items: mergeRecentEntries(results),
    // The budget cutting pins is the same kind of "we stopped looking" the
    // depth and listing bounds report, and the UI says so the same way.
    truncated: truncated || plan.skipped > 0,
    scannedDirs,
    plan,
    builtAt: Date.now()
  };
}

/**
 * The UNPRUNED tree for a space's content root, or for one folder inside it.
 *
 * Three savings, all of which matter on a root of several thousand directories:
 *
 *   - DEPTH. The walk stops after `depth` levels; folders below that come back
 *     flagged `truncated` and are fetched by a later call with `subPath` set to
 *     the folder the user opened. This is the difference between a page load
 *     that waits for the entire content root and one that lists a handful of
 *     directories.
 *   - COALESCING. Concurrent callers share one walk. A single page load can ask
 *     for the tree more than once (the space auto-select and a deep link both
 *     route through selectSpace), and the per-space cache below cannot help
 *     because none of those requests has finished yet.
 *   - SHARING. Spaces that sit on the same root get the same raw tree, so the
 *     second space to be opened pays a prune instead of a walk. Safe because the
 *     walk reads only the directory — per-space curation is applied by the
 *     CALLER, after this returns.
 *
 * The last two key off the CONTENT ROOT plus the (subPath, depth) pair, since a
 * shallow tree and a deep one are not interchangeable answers.
 *
 * @param {Object} space
 * @param {Object} filingService space-scoped filing service
 * @param {Object} log
 * @param {Object} [options]
 * @param {string} [options.subPath] space-relative folder to walk from ('' = root)
 * @param {number} [options.depth] levels to list below subPath
 * @return {Promise<Array>} raw (unpruned) tree
 */
async function rawTreeForRoot(space, filingService, log, options = {}) {
  const subPath = options.subPath || '';
  const depth = options.depth || DEFAULT_TREE_DEPTH;
  const rootKey = rootKeyFor(space);
  const buildKey = `${rootKey}|${subPath.toLowerCase()}|d${depth}`;

  const cached = rawTreeByRoot.get(buildKey);
  if (cached && Date.now() - cached.builtAt < RAW_TREE_MAX_AGE_MS) {
    log.info(`[Wiki Filing] Reusing raw tree for "${buildKey}"`);
    return cached.tree;
  }

  const running = treeBuildsInFlight.get(buildKey);
  if (running) {
    log.info(`[Wiki Filing] Joining in-flight tree build for "${buildKey}"`);
    return running;
  }

  const build = (async () => {
    const startedAt = Date.now();
    log.info(`[Wiki Filing] Building tree for space ${space.id} (${space.name}) at "${subPath || '/'}" depth ${depth}`);
    const tree = await buildTreeFromFiling(
      filingService, subPath, space.name, log,
      await inheritedOrderFor(filingService, subPath), depth
    );
    rawTreeByRoot.set(buildKey, { tree, builtAt: Date.now() });
    log.info(`[Wiki Filing] Tree walk for "${buildKey}" took ${Date.now() - startedAt}ms`);
    return tree;
  })();

  treeBuildsInFlight.set(buildKey, build);
  try {
    return await build;
  } finally {
    // Always clear, including on failure — a rejected build must not be handed
    // to every later caller.
    treeBuildsInFlight.delete(buildKey);
  }
}

/**
 * The effective file order a subtree walk starts with.
 *
 * A full-root walk carries each folder's order down the recursion, so a single
 * `.system/file-order.json` at the space root orders the whole space. A subtree
 * walk starts in the middle and has no such history — so it re-derives it by
 * asking each ancestor, nearest-first, for its own order. Deliberately does NOT
 * consult the folder itself: `buildTreeFromFiling` reads that and it must win.
 *
 * At most one read per ancestor level, and only on a lazy subtree fetch. A
 * missing order file is the common case and costs a rejected read.
 *
 * @param {Object} filingService space-scoped filing service
 * @param {string} subPath space-relative folder the walk starts at
 * @return {Promise<string[]|null>} nearest ancestor order, or null
 */
async function inheritedOrderFor(filingService, subPath) {
  if (!subPath) return null;
  const segments = subPath.split('/').filter(Boolean);
  const read = relPath => filingService.read(relPath, 'utf8');

  // Nearest ancestor first — the first order found is the one that cascades.
  for (let i = segments.length - 1; i >= 0; i--) {
    const ancestor = segments.slice(0, i).join('/');
    const order = await readOrderWith(read, ancestor);
    if (Array.isArray(order) && order.length > 0) return order;
  }
  return null;
}

/**
 * Drop the shared raw trees when anything changes on disk. Subscribed to the
 * same event bus TreeCache uses; a change event names one space, and every root
 * that space could be sitting on is dropped (cheap — there are a handful of
 * roots, and the cost of being wrong is one extra walk).
 */
function attachRawTreeInvalidation(eventBus, log) {
  if (!eventBus || typeof eventBus.on !== 'function') return;
  eventBus.on('change', () => {
    if (rawTreeByRoot.size === 0) return;
    rawTreeByRoot.clear();
    if (log && log.debug) log.debug('[Wiki Filing] Raw tree cache cleared by file change');
  });
}

/**
 * Strip every field the client can derive, and nothing else.
 *
 * `path` is implied by the nesting (parent path + '/' + name); `title` and
 * `fileName` are copies of `name`; `spaceName` is constant for the whole
 * response; `status: null` is the default. Rebuilt client-side by
 * navigationController.rehydrateTree(), which is ~40ms for 42k nodes against
 * several seconds of transfer and serialisation saved. Keep the two in step:
 * anything dropped here MUST be restored there, or every consumer of a tree
 * node starts seeing undefined.
 *
 * @param {Array} nodes
 * @return {Array} new nodes, originals untouched (the raw tree is shared)
 */
function leanTree(nodes) {
  const out = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const lean = { type: node.type, name: node.name };
    if (node.status != null) lean.status = node.status;
    if (node.size !== undefined) lean.size = node.size;
    if (node.created !== undefined) lean.created = node.created;
    if (node.modified !== undefined) lean.modified = node.modified;
    // MUST survive: an empty `children` with no flag reads as "this folder is
    // empty", which is a different thing from "not walked yet".
    if (node.truncated) lean.truncated = true;
    if (node.type === 'folder') lean.children = leanTree(node.children || []);
    out[i] = lean;
  }
  return out;
}

/**
 * Helper: Build folder tree recursively using filing service
 */
/**
 * Build a space's folder tree, depth-first.
 *
 * Ordering CASCADES: a folder without its own `.system/file-order.json` is
 * ordered by the nearest ancestor that has one, so a single file at the space
 * root can impose a convention on the whole tree. `inheritedOrder` carries that
 * ancestor's effective order down the recursion; utils/fileOrder.js owns the
 * rules (resolveEffectiveOrder / applyFileOrder).
 *
 * The walk is DEPTH-LIMITED. `depthRemaining` counts the levels still to be
 * listed; a folder reached with none left is emitted with `children: []` and
 * `truncated: true` and is NOT listed at all — so the cost of the walk is the
 * number of directories within the limit, not the size of the space. The client
 * treats `truncated` as "assume children, fetch them when the user goes there"
 * (navigationController.ensureFolderLoaded), which is why the flag has to
 * survive leanTree() and rehydrateTree().
 *
 * @param {Object} filingService     space-scoped filing service
 * @param {string} dirPath           space-relative folder path ('' = root)
 * @param {string} spaceName
 * @param {Object} log
 * @param {string[]|null} inheritedOrder effective order of the parent folder
 * @param {number} depthRemaining    levels still allowed below `dirPath`
 * @return {Promise<Array>} ordered tree nodes
 */
async function buildTreeFromFiling(
  filingService, dirPath, spaceName, log, inheritedOrder = null,
  depthRemaining = MAX_TREE_DEPTH
) {
  const tree = [];
  let entries = [];

  try {
    entries = await filingService.list(dirPath || '.');
  } catch (error) {
    return [];
  }

  // Normalize entries - preserve metadata if available (isDirectory, type,
  // size, created/modified timestamps). The timestamps let the UI show each
  // item's last-updated date in the folder list/card/grid views.
  const normalizedEntries = entries.map(entry => {
    if (typeof entry === 'string') {
      return { name: entry, isDirectory: null }; // unknown, will need to probe
    }
    return {
      name: entry.name || String(entry),
      isDirectory: entry.isDirectory === true || entry.type === 'folder',
      isSymbolicLink: entry.isSymbolicLink === true,
      size: entry.size,
      created: entry.created,
      modified: entry.modified
    };
  });

  // Filter out hidden files/folders (but allow .home.md and the .aicontext cache
  // dir). Context now lives under the hidden .system/context namespace, so
  // .context is no longer surfaced here.
  const filteredEntries = normalizedEntries.filter(entry =>
    !entry.name.startsWith('.') || entry.name.toLowerCase() === '.home.md'
    || entry.name === '.aicontext'
  );

  // Load this folder's child status map (.system/file-types.json). A child
  // folder's status colour is recorded against its name here, in its parent's
  // settings — mirroring how file-order.json records child ordering. Read once
  // per directory, and only when a settings folder actually exists. `.settings` is
  // the pre-migration location and is still probed as a fallback.
  let typeMap = {};
  const settingsDirName = [SYSTEM_DIR, LEGACY_SETTINGS_DIR]
    .find(name => normalizedEntries.some(e => e.name === name));
  if (settingsDirName) {
    try {
      const suffix = `${settingsDirName}/file-types.json`;
      const typesPath = dirPath ? `${dirPath}/${suffix}` : suffix;
      const rawTypes = await filingService.read(typesPath, 'utf8');
      const parsedTypes = typeof rawTypes === 'string' ? JSON.parse(rawTypes) : rawTypes;
      if (parsedTypes && typeof parsedTypes.types === 'object' && parsedTypes.types) {
        typeMap = parsedTypes.types;
      }
    } catch (_) {
      // No/unreadable type file; folders fall back to the default (no status).
    }
  }

  // This folder's own ordering, if it has one. Guarded by the same probe as the
  // type map: a folder with no settings dir costs zero reads, which matters —
  // the tree cache invalidates on every file event, so this walk runs cold
  // often and there are thousands of folders in a large space.
  const ownOrder = settingsDirName
    ? await readOrderWith(
        relPath => filingService.read(relPath, 'utf8'),
        dirPath
      )
    : null;
  // Own order wins; otherwise the nearest ancestor's cascades in — and either
  // way this is what the children below inherit.
  const effectiveOrder = resolveEffectiveOrder(ownOrder, inheritedOrder);

  for (const entry of filteredEntries) {
    const entryPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
    let isDirectory = entry.isDirectory;

    // Only probe if metadata wasn't available from the list() call
    if (isDirectory === null) {
      try {
        await filingService.list(entryPath);
        isDirectory = true;
      } catch (error) {
        isDirectory = false;
      }
    }

    if (isDirectory) {
      // It's a folder - recurse, unless this is where the walk stops. A
      // truncated folder is a promise, not a fact: we have not listed it, so we
      // do not know whether it has children. The client shows it as drillable
      // and finds out when the user opens it — one readdir at click time
      // instead of the whole subtree at page load.
      if (depthRemaining <= 1) {
        tree.push({
          type: 'folder',
          name: entry.name,
          path: entryPath,
          status: isValidStatus(typeMap[entry.name]) ? typeMap[entry.name] : null,
          created: entry.created,
          modified: entry.modified,
          children: [],
          truncated: true
        });
        continue;
      }

      try {
        const children = await buildTreeFromFiling(
          filingService, entryPath, spaceName, log, effectiveOrder, depthRemaining - 1
        );
        tree.push({
          type: 'folder',
          name: entry.name,
          path: entryPath,
          // Navigation accent colour, when one is assigned for this child in the
          // parent's .system/file-types.json. null = default (no accent).
          status: isValidStatus(typeMap[entry.name]) ? typeMap[entry.name] : null,
          created: entry.created,
          modified: entry.modified,
          children: children
        });
      } catch (error) {
        log.error(`[Wiki Filing] Failed to read folder ${entryPath}:`, error.message);
        throw error;
      }
    } else {
      // It's a file
      tree.push({
        type: 'document',
        name: entry.name,
        title: entry.name,
        path: entryPath,
        fileName: entry.name,
        spaceName: spaceName,
        // Navigation accent colour, when one is assigned for this file in the
        // parent's .system/file-types.json (keyed by file name). null = default.
        status: isValidStatus(typeMap[entry.name]) ? typeMap[entry.name] : null,
        size: entry.size,
        created: entry.created,
        modified: entry.modified
      });
    }
  }

  return applyFileOrder(tree, effectiveOrder);
}
