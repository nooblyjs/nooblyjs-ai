/**
 * @fileoverview Real-time file system watcher for wiki documents
 * Monitors file changes and emits Socket.IO events for live UI updates
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-10
 */

'use strict';

const chokidar = require('chokidar');
const path = require('node:path');
const fs = require('node:fs').promises;
const { isTextFile, generateCacheKey } = require('../../shared/utils/fileTypeUtils');
const {
  getPolicy,
  toOriginalsRelPath,
  ORIGINALS_DIR
} = require('../../shared/utils/filePolicy');
const { convertToMarkdown, canConvert } = require('../../shared/processors/documentConverter');
const { ensureSidecar } = require('../utils/derivedSidecar');
const { writeContentCache } = require('../utils/documentContentCache');
const { ContextTrigger, CONTEXT_WORKFLOW_NAME, CONTEXT_ON_CHANGE_ENABLED, CONTEXT_DEBOUNCE_MS } = require('./contextTrigger');
const { startArtifactCleanup } = require('./artifactCleanup');
const { isPathVisible } = require('../../shared/spaces/spacePaths');

// Binary document types the watcher processes when one is dropped into a watched
// space. The handling splits by file-handling policy (see filePolicy.js):
//   - PDF ("view original"): the original stays as the visible, natively-rendered
//     document; a folder-local `.system/derived/<name>.pdf.md` sidecar is
//     generated beside it so search and context can read it.
//   - Office ("view markdown"): the converted markdown becomes the VISIBLE page
//     (`report.docx` → `report.md`) and the untouched source is relocated to
//     `.system/originals/report.docx` for the page's download link.
// PPTX is excluded: its converter needs a browser `window` and fails under Node.
const CONVERTIBLE_EXT = new Set(['.docx', '.pdf', '.xlsx', '.xls']);

// Legacy sibling folder that earlier versions moved converted sources into. We
// no longer archive (originals stay put), but keep ignoring it so any files left
// behind by a previous build never re-trigger the watcher.
const ARCHIVE_DIR_NAME = '.archive';

// On-demand AI context rebuild (ContextTrigger, ./contextTrigger.js) is shared with
// the delete-side cleanup subscriber, so its workflow name, env kill-switch and
// debounce live there — one serialized queue serves both.

// Path segments the watcher must never surface or descend into. `.system` matters
// most: it is the folder-local namespace every folder carries, holding that
// folder's `derived/`, `originals/` and `context/` artifacts plus its
// file-order/file-types metadata — and, at the space root only, the space-scoped
// `templates/` and `useractivity/`. Ignoring it is MANDATORY, not cosmetic: the
// watcher writes derived sidecars itself, and a sidecar is a plain `.md` whose
// basename is NOT dot-prefixed, so isContextEligible() would accept it and
// schedule a context rebuild — a write→event→rebuild feedback loop. The same
// applies to the context sidecars the context workflow writes.
// `.settings` is the pre-migration location of file-order/file-types and stays in
// the pattern so any not-yet-migrated folder keeps its metadata hidden.
//
// NOTE: chokidar v4 dropped glob-string support for `ignored` — it now accepts
// only a function, regex, or path. The previous `['**/.git/**', …]` array was
// silently ineffective. This predicate is the real ignore and is reused as a
// defensive guard inside every event handler.
// The legacy pre-`.system` folder names are kept in the pattern as a defensive
// fallback so any not-yet-migrated leftovers still stay hidden.
const IGNORED_SEGMENT = /(^|[\\/])(node_modules|\.git|\.settings|\.system|\.archive|\.derived|\.useractivity|\.continuous-explorations)([\\/]|$)/;
// `.home.md` is deliberately NOT ignored here, even though it is machine-written
// in bulk (the system-context build's ContextProcessor.ensureFolderHome and the
// application-design Code Processor each seed one per folder, so a single run
// rewrites thousands). It is the one dot-file the rest of the platform admits as
// a real, user-visible document — filingServiceWrapper.buildFileTree,
// dataManager, filingRoutes and isSearchIndexablePath below all carry the same
// explicit exception — and the watcher is the ONLY thing that feeds the
// incremental search index. Ignoring it here made every generated folder home
// unsearchable until a full rebuild.
//
// The churn it produces is cache/index/broadcast work, never AI work: `.home.md`
// is excluded from context rebuilds one layer down, by name, in
// isContextEligible(). That is the correct seam — this predicate decides what the
// watcher SURFACES, isContextEligible decides what costs an AI run.
function isIgnoredPath(targetPath) {
  return IGNORED_SEGMENT.test(targetPath) || /[\\/](?:\.DS_Store|Thumbs\.db)$/.test(targetPath);
}

/**
 * File change event debouncer to prevent duplicate events
 */
class ChangeDebouncer {
  constructor(delay = 500) {
    this.delay = delay;
    this.timers = new Map();
  }

  debounce(key, callback) {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      callback();
    }, this.delay);

    this.timers.set(key, timer);
  }
}

/**
 * True when an added/changed file should trigger an AI context rebuild for its
 * folder. Context is generated for markdown pages and for the binaries that
 * produce searchable derived/original content (PDF, office).
 *
 * Takes a SPACE-RELATIVE path, not an absolute one: every segment is checked for
 * a leading dot, and an absolute path routinely contains one (the default space
 * lives under `.application/`), which would make every file ineligible.
 *
 * Rejecting the whole path — rather than just the file name — matters because a
 * plumbing file inside a dot-folder usually has an ordinary name. The chat's
 * retrieval cache writes `<folder>/.aicontext/<Source>-summary.md`, whose BASENAME
 * has no leading dot; a name-only check let it through, so every chat message
 * scheduled a context build for the `.aicontext` folder itself and the workflow
 * dutifully wrote `.aicontext/.system/context/_folder.md` and seeded
 * `.aicontext/.home.md` — burning an AI run per chat turn and polluting a cache
 * folder that is meant to be disposable. `.aicontext` deliberately stays OUT of
 * IGNORED_SEGMENT (its summaries are search-indexed, and the watcher is the only
 * thing that feeds the incremental index), so this is the gate that must hold.
 * The same is now true of `.home.md` — see the by-name exclusion below.
 * @private
 */
function isContextEligible(relativePath) {
  const segments = String(relativePath || '').split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) return false;

  // `.home.md` is excluded BY NAME, ahead of the general dot-segment rule, and
  // the redundancy is deliberate. It is the one dot-file the rest of the
  // platform treats as a visible document (isSearchIndexablePath,
  // buildFileTree, dataManager, filingRoutes all special-case it), so anyone
  // harmonising this function with those would relax the dot rule for it and
  // reintroduce a genuine feedback loop: `.home.md` is written by the context
  // build itself, as a verbatim copy of the folder's `.system/context/_folder.md`
  // roll-up (ContextProcessor.ensureFolderHome). Letting it schedule a rebuild
  // means build → write `.home.md` → rebuild, forever.
  if (/^\.home\.md$/i.test(segments[segments.length - 1])) return false;

  if (segments.some(segment => segment.startsWith('.'))) return false;
  const ext = path.extname(segments[segments.length - 1]).toLowerCase();
  return ext === '.md' || CONVERTIBLE_EXT.has(ext);
}

/**
 * Start file system watcher for real-time updates
 * @param {Object} services - noobly services object
 */
function startFileWatcher(services) {
  const { dataManager, filing, cache, log, io, appBaseDir } = services;
  const debouncer = new ChangeDebouncer(1000);

  // On-demand AI context rebuild trigger (debounced per folder, serialized).
  // Attached to the shared services object so every event handler — and the
  // delete-side cleanup subscriber below — reaches the SAME instance, which is
  // what keeps concurrent AI runs off the queue. Disabled by CONTEXT_ON_CHANGE=false.
  services.contextTrigger = CONTEXT_ON_CHANGE_ENABLED
    ? new ContextTrigger(services, { debounceMs: CONTEXT_DEBOUNCE_MS })
    : null;
  if (services.contextTrigger) {
    log.info(`[FileWatcher] On-demand context rebuild enabled (debounce ${CONTEXT_DEBOUNCE_MS}ms) via "${CONTEXT_WORKFLOW_NAME}"`);
  }

  // Delete-side cleanup: removes a deleted document's derived/originals/context
  // artifacts and rebuilds its folder's context. Driven off the event bus rather
  // than the unlink handler below, so API deletes are covered by the same code.
  startArtifactCleanup(services);

  // Initialize global suppression set for API-triggered rename/move operations
  // When API routes perform rename/move, they register affected paths here
  // so fileWatcher skips the duplicate unlink+add events that chokidar generates
  if (!global.fileWatcherSuppressed) {
    global.fileWatcherSuppressed = new Set();
  }

  log.info('Starting file watcher for real-time updates...');

  // Get all space paths to watch.
  // The returned promise settles when chokidar emits 'ready' — i.e. after it has
  // walked and stat'd every file under every watched space. `ignoreInitial: true`
  // suppresses the initial EVENTS, not the walk, so on a large space tree this is
  // a substantial piece of startup work. Callers may ignore the promise (nothing
  // depended on a return value before); the startup profiler awaits it to time
  // the walk. See src/shared/startup/startupRunner.js.
  return (async () => {
    try {
      const spaces = await dataManager.read('spaces');
      // Map of path -> space data. SEVERAL spaces may share one path (they are
      // different curated views of the same content root), and this map used to
      // be keyed so the last one silently won — every earlier space on that path
      // then received no change events at all, so its cached folder tree went
      // stale and never refreshed until a restart. The primary space still
      // drives the per-event work; `siblingSpaceIds` carries the rest so their
      // trees are invalidated too (see invalidateSiblingTrees).
      const watchedPaths = new Map();

      for (const space of spaces) {
        let spacePath = space.path || space.configuration?.filing?.baseDir;
        if (spacePath) {
          // Convert relative paths to absolute paths for matching
          // (chokidar sends absolute paths, so we need to match them)
          if (!path.isAbsolute(spacePath)) {
            // Resolve relative to the application base directory
            const baseDir = appBaseDir || path.join(process.cwd(), '.application');
            spacePath = path.resolve(baseDir, spacePath);
          }
          // Normalize path separators for consistent matching across platforms
          spacePath = path.normalize(spacePath);

          const existing = watchedPaths.get(spacePath);
          if (existing) {
            existing.siblingSpaceIds.push(space.id);
            existing.spaces.push(space);
            log.info(`[FileWatcher] Space "${space.name}" shares ${spacePath} with "${existing.space.name}" — its tree cache will be invalidated alongside`);
          } else {
            // `spaces` keeps the whole group, primary first. The per-event WORK
            // (caches, search index) is done once for the primary — it is
            // per-content-root and repeating it would be waste — but the EVENT
            // has to be raised once per space that can see the path. See
            // emitChangeForSpaces.
            watchedPaths.set(spacePath, { space, siblingSpaceIds: [], spaces: [space] });
            log.info(`[FileWatcher] Watching space "${space.name}" at ${spacePath}`);
          }
        }
      }

      if (watchedPaths.size === 0) {
        log.warn('No space paths found to watch');
        return;
      }

      // Initialize watcher for all space paths
      const watcher = chokidar.watch(Array.from(watchedPaths.keys()), {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 500,
          pollInterval: 100
        },
        // chokidar v4: must be a function/regex/path, not glob strings.
        ignored: isIgnoredPath
      });

      // Handle file/folder added
      watcher.on('add', async (filePath) => {
        debouncer.debounce(`add:${filePath}`, async () => {
          try {
            await handleFileAdded(filePath, watchedPaths, services);
          } catch (error) {
            log.error(`Error handling file add: ${filePath}`, error);
          }
        });
      });

      // Handle folder added
      watcher.on('addDir', async (dirPath) => {
        debouncer.debounce(`addDir:${dirPath}`, async () => {
          try {
            await handleFolderAdded(dirPath, watchedPaths, services);
          } catch (error) {
            log.error(`Error handling folder add: ${dirPath}`, error);
          }
        });
      });

      // Handle file changed
      watcher.on('change', async (filePath) => {
        debouncer.debounce(`change:${filePath}`, async () => {
          try {
            await handleFileChanged(filePath, watchedPaths, services);
          } catch (error) {
            log.error(`Error handling file change: ${filePath}`, error);
          }
        });
      });

      // Handle file/folder deleted
      watcher.on('unlink', async (filePath) => {
        debouncer.debounce(`unlink:${filePath}`, async () => {
          try {
            await handleFileDeleted(filePath, watchedPaths, services);
          } catch (error) {
            log.error(`Error handling file delete: ${filePath}`, error);
          }
        });
      });

      watcher.on('unlinkDir', async (dirPath) => {
        debouncer.debounce(`unlinkDir:${dirPath}`, async () => {
          try {
            await handleFolderDeleted(dirPath, watchedPaths, services);
          } catch (error) {
            log.error(`Error handling folder delete: ${dirPath}`, error);
          }
        });
      });

      // Handle watcher errors
      watcher.on('error', (error) => {
        log.error('File watcher error:', error);
      });

      // Log watcher ready. Awaited so the initial tree walk is included in this
      // function's promise (and therefore in the startup profile).
      await new Promise((resolve) => {
        watcher.on('ready', () => {
          log.info(`File watcher initialized. Watching ${watchedPaths.size} content root(s)`);
          for (const [spacePath, entry] of watchedPaths) {
            const shared = entry.siblingSpaceIds.length
              ? ` (+${entry.siblingSpaceIds.length} space(s) sharing this root)`
              : '';
            log.info(`  - Watching: ${spacePath} (${entry.space.name})${shared}`);
          }
          resolve();
        });
      });

    } catch (error) {
      log.error('Failed to start file watcher:', error);
    }
  })();
}

/**
 * Clear all relevant caches when folder structure changes
 * Invalidates folder, space, and search caches
 * @private
 */
async function invalidateFolderCaches(relativePath, space, cache, log) {
  try {
    const parentPath = path.dirname(relativePath);

    // Clear the file content cache if this is a file (not just a folder)
    await cache.delete(`${space.name}-${relativePath}`);

    // Clear caches for the parent folder and all ancestors
    let currentPath = parentPath;
    while (currentPath && currentPath !== '.') {
      // Folder structure cache for this path
      await cache.delete(`wiki:folder:${space.id}:${currentPath}`);
      await cache.delete(`wiki:folder:${space.name}:${currentPath}`);

      // Move up the directory tree
      const lastSlash = currentPath.lastIndexOf('/');
      currentPath = lastSlash === -1 ? '.' : currentPath.substring(0, lastSlash);
    }

    // Clear root folder cache
    await cache.delete(`wiki:folder:${space.id}:`);
    await cache.delete(`wiki:folder:${space.name}:`);

    // Clear general folder/document list caches
    await cache.delete('wiki:documents:list');
    await cache.delete('wiki:documents:recent');
    await cache.delete('wiki:recent:activity');
    await cache.delete(`wiki:space:${space.id}:documents`);

    // Clear search caches
    await cache.delete('wiki:search:*');

    log.info(`[Cache] Invalidated folder caches for: ${space.name}/${relativePath}`);
  } catch (error) {
    log.warn(`Failed to invalidate folder caches:`, error.message);
  }
}

/**
 * True when a space-relative path would be included by a full index rebuild.
 * Mirrors FilingServiceWrapper.buildFileTree's dot-entry filter (the rebuild's
 * file source): dot-prefixed segments are excluded EXCEPT the `.home.md` folder
 * home file and the `.aicontext` sidecar cache. Keeping the two rules in sync
 * means incremental updates never surface documents a rebuild would drop
 * (e.g. `<folder>/.system/…`), and never miss ones it would keep. Every folder-local
 * artifact — derived, originals, context, file-order/file-types — sits under that
 * folder's `.system/`, so a single dot-segment rule excludes them all; the legacy
 * `.context` folder is excluded for the same reason.
 * @private
 */
function isSearchIndexablePath(relativePath) {
  const segments = String(relativePath || '').split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every(segment =>
    !segment.startsWith('.')
    || segment.toLowerCase() === '.home.md'
    || segment === '.aicontext'
  );
}

/**
 * Feed an added/changed file into the live search index (incremental — no
 * rebuild). Best-effort: an indexing failure must never break the watcher's
 * cache/event pipeline.
 * @private
 */
async function updateSearchIndex(space, relativePath, services) {
  const { searchIndexer, log } = services;
  if (!searchIndexer || !isSearchIndexablePath(relativePath)) return;
  try {
    await searchIndexer.updateFileInSpace(space.name, relativePath);
  } catch (error) {
    log.warn(`[FileWatcher] Failed to index ${space.name}/${relativePath}: ${error.message}`);
  }
}

/**
 * Remove a deleted file (or, with isFolder, a whole folder's documents) from
 * the live search index. Best-effort, same contract as updateSearchIndex.
 * @private
 */
function removeFromSearchIndex(relativePath, services, { isFolder = false } = {}) {
  const { searchIndexer, log } = services;
  if (!searchIndexer || !isSearchIndexablePath(relativePath)) return;
  try {
    if (isFolder) {
      searchIndexer.removeFolderFromIndex(relativePath);
    } else {
      searchIndexer.removeFileFromIndexIncremental(relativePath);
    }
  } catch (error) {
    log.warn(`[FileWatcher] Failed to de-index ${relativePath}: ${error.message}`);
  }
}

/**
 * Handle file added event
 */
async function handleFileAdded(filePath, watchedPaths, services) {
  const { log, cache } = services;

  // Defensive: never surface or cache ignored paths (folder-local .system/derived
  // sidecars, .system, .git, node_modules…) even if a future watcher config lets
  // one through.
  if (isIgnoredPath(filePath)) return;

  // Skip if this path was suppressed (API-triggered rename/move)
  if (global.fileWatcherSuppressed && global.fileWatcherSuppressed.has(filePath)) {
    log.info(`[FileWatcher] Skipping suppressed add event for: ${filePath}`);
    return;
  }

  const space = findSpaceForPath(filePath, watchedPaths);

  if (!space) {
    log.warn(`No space found for file: ${filePath}`);
    return;
  }

  invalidateSiblingTrees(filePath, watchedPaths);

  // For a dropped office/pdf document, convert to markdown (see
  // processDroppedDocument for the per-type split). A PDF keeps its original in
  // place and falls through to the usual "file added" broadcast. An office doc's
  // original is relocated into `.system/originals` and replaced by a visible .md
  // page — in that case the original no longer exists at filePath, so we skip the
  // broadcast below (the new .md page raises its own add event).
  const ext = path.extname(filePath).toLowerCase();
  if (CONVERTIBLE_EXT.has(ext) && !isInArchive(filePath)) {
    const outcome = await processDroppedDocument(filePath, space, services);
    if (outcome && outcome.consumedOriginal) {
      log.info(`[FileWatcher] ${path.basename(filePath)} converted to a markdown page; original stored under ${ORIGINALS_DIR}`);
      return;
    }
  }

  const fileName = path.basename(filePath);
  const relativePath = getRelativePath(filePath, space.path || space.configuration?.filing?.baseDir);
  const parentPath = path.dirname(relativePath);

  log.info(`File added: ${fileName} in ${space.name} at ${relativePath}`);

  // Get file stats
  const stats = await getFileStats(filePath);

  // Pre-cache text-based files, stamped with the file's identity so the read
  // path can confirm the entry is still current (see utils/documentContentCache.js).
  if (isTextFile(filePath)) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const cacheKey = generateCacheKey(space.name, relativePath);
      await writeContentCache(cache, cacheKey, content, await fs.stat(filePath));
      log.info(`Pre-cached new file: ${cacheKey}`);
    } catch (error) {
      log.warn(`Failed to pre-cache ${relativePath}:`, error.message);
    }
  }

  // Invalidate all relevant folder and structure caches
  await invalidateFolderCaches(relativePath, space, cache, log);

  // Make the new file searchable immediately (files written directly to disk
  // — e.g. by workflows via the filing service — never pass through the wiki
  // document routes, so this is their only path into the search index).
  await updateSearchIndex(space, relativePath, services);

  // Emit once per space on this content root that can see the path.
  emitChangeForSpaces(filePath, watchedPaths, 'create', 'file', (s, rel) => {
    const parent = path.dirname(rel);
    return {
      spaceId: s.id,
      spaceName: s.name,
      name: fileName,
      path: rel,
      parentPath: parent === '.' ? '' : parent,
      created: stats.created,
      modified: stats.modified,
      size: stats.size,
      source: 'file-watcher'
    };
  });

  // Schedule a TARGETED AI context rebuild for this file (debounced/coalesced
  // per folder — the build step re-summarises only the changed file(s)).
  if (services.contextTrigger && isContextEligible(relativePath)) {
    services.contextTrigger.schedule(space, relativePath);
  }
}

/**
 * Handle folder added event
 */
async function handleFolderAdded(dirPath, watchedPaths, services) {
  const { log, cache } = services;
  if (isIgnoredPath(dirPath)) return;

  // Skip if this path was suppressed (API-triggered rename/move)
  if (global.fileWatcherSuppressed && global.fileWatcherSuppressed.has(dirPath)) {
    log.info(`[FileWatcher] Skipping suppressed addDir event for: ${dirPath}`);
    return;
  }

  const space = findSpaceForPath(dirPath, watchedPaths);

  if (!space) {
    log.warn(`No space found for folder: ${dirPath}`);
    return;
  }

  invalidateSiblingTrees(dirPath, watchedPaths);

  const folderName = path.basename(dirPath);
  const relativePath = getRelativePath(dirPath, space.path || space.configuration?.filing?.baseDir);
  const parentPath = path.dirname(relativePath);

  log.info(`Folder added: ${folderName} in ${space.name} at ${relativePath}`);

  // Get folder stats
  const stats = await getFileStats(dirPath);

  // Invalidate all relevant folder and structure caches
  await invalidateFolderCaches(relativePath, space, cache, log);

  // Emit once per space on this content root that can see the folder.
  emitChangeForSpaces(dirPath, watchedPaths, 'create', 'folder', (s, rel) => {
    const parent = path.dirname(rel);
    return {
      spaceId: s.id,
      spaceName: s.name,
      name: folderName,
      path: rel,
      parentPath: parent === '.' ? '' : parent,
      created: stats.created,
      modified: stats.modified,
      source: 'file-watcher'
    };
  }, 'folder');
}

/**
 * Handle file changed event
 */
async function handleFileChanged(filePath, watchedPaths, services) {
  const { log, cache } = services;
  if (isIgnoredPath(filePath)) return;
  const space = findSpaceForPath(filePath, watchedPaths);

  if (!space) return;

  invalidateSiblingTrees(filePath, watchedPaths);

  const fileName = path.basename(filePath);
  const relativePath = getRelativePath(filePath, space.path || space.configuration?.filing?.baseDir);

  log.info(`File changed: ${fileName} in ${space.name}`);

  // Keep the markdown sidecar in sync when an office/pdf original is edited.
  const ext = path.extname(filePath).toLowerCase();
  if (CONVERTIBLE_EXT.has(ext) && !isInArchive(filePath)) {
    await generateSidecar(filePath, space, services);
  }

  // Get file stats
  const stats = await getFileStats(filePath);

  // Update cache for text-based files
  if (isTextFile(filePath)) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const cacheKey = generateCacheKey(space.name, relativePath);
      await writeContentCache(cache, cacheKey, content, await fs.stat(filePath));
      log.info(`Updated cache for changed file: ${cacheKey}`);
    } catch (error) {
      log.warn(`Failed to update cache for ${relativePath}:`, error.message);
    }
  }

  // Invalidate folder structure and search caches
  await invalidateFolderCaches(relativePath, space, cache, log);

  // Re-index the changed content so search reflects the edit.
  await updateSearchIndex(space, relativePath, services);

  // Emit once per space on this content root that can see the path.
  emitChangeForSpaces(filePath, watchedPaths, 'update', 'file', (s, rel) => ({
    spaceId: s.id,
    spaceName: s.name,
    name: fileName,
    path: rel,
    modified: stats.modified,
    size: stats.size,
    source: 'file-watcher'
  }));

  // Schedule a TARGETED AI context rebuild for this file (debounced/coalesced
  // per folder — the build step re-summarises only the changed file(s)).
  if (services.contextTrigger && isContextEligible(relativePath)) {
    services.contextTrigger.schedule(space, relativePath);
  }
}

/**
 * Handle file deleted event
 */
async function handleFileDeleted(filePath, watchedPaths, services) {
  const { log, cache } = services;
  if (isIgnoredPath(filePath)) return;

  // Skip if this path was suppressed (API-triggered rename/move)
  if (global.fileWatcherSuppressed && global.fileWatcherSuppressed.has(filePath)) {
    log.info(`[FileWatcher] Skipping suppressed unlink event for: ${filePath}`);
    return;
  }

  const space = findSpaceForPath(filePath, watchedPaths);

  if (!space) return;

  invalidateSiblingTrees(filePath, watchedPaths);

  const fileName = path.basename(filePath);
  const relativePath = getRelativePath(filePath, space.path || space.configuration?.filing?.baseDir);

  log.info(`File deleted: ${fileName} from ${space.name}`);

  // NOTE: the deleted document's folder-local artifacts (its derived sidecar, its
  // stored original, its context sidecar) and its folder's context roll-up are NOT
  // cleaned up here — activities/artifactCleanup.js does it off the `delete` event
  // emitted below. Subscribing to the bus rather than handling it inline is what
  // makes the cleanup source-agnostic: the wiki's own DELETE routes emit the same
  // event, so a delete is cleaned up once, by one piece of code, however it arrived.

  // Invalidate cache for text-based files
  if (isTextFile(filePath)) {
    try {
      const cacheKey = generateCacheKey(space.name, relativePath);
      await cache.delete(cacheKey);
      log.info(`Invalidated cache for deleted file: ${cacheKey}`);
    } catch (error) {
      log.warn(`Failed to invalidate cache for ${relativePath}:`, error.message);
    }
  }

  // Invalidate folder structure and search caches
  await invalidateFolderCaches(relativePath, space, cache, log);

  // Drop the document (and any chunk entries) from the search index.
  removeFromSearchIndex(relativePath, services);

  // Emit once per space on this content root that could see the path.
  emitChangeForSpaces(filePath, watchedPaths, 'delete', 'file', (s, rel) => ({
    spaceId: s.id,
    spaceName: s.name,
    name: fileName,
    path: rel,
    source: 'file-watcher'
  }));
}

/**
 * Handle folder deleted event
 */
async function handleFolderDeleted(dirPath, watchedPaths, services) {
  const { log, cache } = services;
  if (isIgnoredPath(dirPath)) return;

  // Skip if this path was suppressed (API-triggered rename/move)
  if (global.fileWatcherSuppressed && global.fileWatcherSuppressed.has(dirPath)) {
    log.info(`[FileWatcher] Skipping suppressed unlinkDir event for: ${dirPath}`);
    return;
  }

  const space = findSpaceForPath(dirPath, watchedPaths);

  if (!space) return;

  invalidateSiblingTrees(dirPath, watchedPaths);

  const folderName = path.basename(dirPath);
  const relativePath = getRelativePath(dirPath, space.path || space.configuration?.filing?.baseDir);

  log.info(`Folder deleted: ${folderName} from ${space.name}`);

  // Invalidate folder structure and search caches
  await invalidateFolderCaches(relativePath, space, cache, log);

  // Drop everything indexed under the folder (covers files whose individual
  // unlink events were missed or suppressed).
  removeFromSearchIndex(relativePath, services, { isFolder: true });

  // Emit once per space on this content root that could see the folder.
  emitChangeForSpaces(dirPath, watchedPaths, 'delete', 'folder', (s, rel) => ({
    spaceId: s.id,
    spaceName: s.name,
    name: folderName,
    path: rel,
    source: 'file-watcher'
  }), 'folder');
}

/**
 * Find the watch entry whose root contains the given path.
 * @return {{space: Object, siblingSpaceIds: number[]}|null}
 */
function findWatchEntryForPath(filePath, watchedPaths) {
  // Normalize file path for consistent comparison
  const normalizedFilePath = path.normalize(filePath);

  for (const [spacePath, entry] of watchedPaths) {
    // Normalize space path and ensure it ends with separator for proper boundary matching
    const normalizedSpacePath = path.normalize(spacePath);

    // Check if file path starts with space path (with proper boundary)
    // This prevents false matches like "/foo" matching "/foobar"
    if (normalizedFilePath.startsWith(normalizedSpacePath)) {
      // Make sure it's a proper directory boundary (followed by separator or is exact match)
      const remainder = normalizedFilePath.slice(normalizedSpacePath.length);
      if (remainder === '' || remainder.startsWith(path.sep) || remainder.startsWith('/')) {
        return entry;
      }
    }
  }
  return null;
}

/**
 * Find the space that contains the given path (the PRIMARY space when several
 * share one content root — it is the one whose caches, search index and events
 * the handlers maintain).
 */
function findSpaceForPath(filePath, watchedPaths) {
  const entry = findWatchEntryForPath(filePath, watchedPaths);
  return entry ? entry.space : null;
}

/**
 * Raise ONE change event per space that can see this path.
 *
 * Two bugs share this fix, and both come from several spaces sitting on one
 * content root:
 *
 *  1. NOTIFICATIONS WERE DEAD FOR EVERY SPACE BUT THE FIRST. Notification topics
 *     are `<spaceName>::<type>:<path>` (notificationManager._topicFor), built
 *     from the SUBSCRIPTION's space when subscribing and from the EVENT's space
 *     when publishing. The event only ever carried the primary space — whichever
 *     one happens to sit first in spaces.json — so a subscription made while
 *     viewing any other space on that root could never match its own topic.
 *     No history, no push, no badge, and nothing logged anywhere.
 *
 *  2. HIDDEN PATHS WERE BROADCAST. The event fans out to Socket.IO with a space
 *     stamped on it, and clients render live nav entries from it. A space that
 *     curates a subtree away would still be told about changes inside it — a
 *     path leak, and an entry that 404s when clicked.
 *
 * Emitting per visible space fixes both at the source, so everything downstream
 * (socket broadcast, notification fan-out, per-space history) is simply correct
 * rather than each needing its own patch.
 *
 * @param {string} filePath absolute path that changed
 * @param {Map} watchedPaths
 * @param {string} operation create | update | delete | rename | move
 * @param {string} itemType file | folder
 * @param {function(Object): Object} buildPayload receives the space, returns the
 *   event metadata for it (the caller stamps spaceId/spaceName from it)
 * @param {'file'|'folder'} [kind='file'] how to judge visibility
 */
function emitChangeForSpaces(filePath, watchedPaths, operation, itemType, buildPayload, kind = 'file') {
  if (!global.eventBus) return;
  const entry = findWatchEntryForPath(filePath, watchedPaths);
  if (!entry) return;

  for (const space of entry.spaces) {
    const root = space.path || space.configuration?.filing?.baseDir;
    const relativePath = getRelativePath(filePath, root);
    if (!isPathVisible(space, relativePath, kind)) continue;
    global.eventBus.emitChange(operation, itemType, buildPayload(space, relativePath));
  }
}

/**
 * Drop the cached folder tree of every OTHER space sharing this path.
 *
 * The handlers do their per-event work for one space, and the event they emit
 * carries that space's id — which is all TreeCache needs to invalidate it. The
 * spaces sharing the same content root see exactly the same file, so their
 * trees are equally stale, but nothing was telling them. Cheap and safe to do
 * eagerly: invalidating a tree only forces the next request to rebuild.
 */
function invalidateSiblingTrees(filePath, watchedPaths) {
  const entry = findWatchEntryForPath(filePath, watchedPaths);
  if (!entry || entry.siblingSpaceIds.length === 0) return;
  if (!global.treeCache || typeof global.treeCache.invalidate !== 'function') return;

  for (const spaceId of entry.siblingSpaceIds) {
    global.treeCache.invalidate(spaceId);
  }
}

/**
 * Get relative path from space root, POSIX-normalized. On Windows
 * `path.relative` returns backslash separators, but every cache key this path
 * feeds (the `${space.name}-${relativePath}` content cache, the
 * `wiki:folder:...` keys and their `lastIndexOf('/')` ancestor walk in
 * invalidateFolderCaches) is written with forward slashes by the routes — a
 * backslash path silently misses them all, leaving stale content served until
 * restart. Events were already normalized downstream (eventBus.normalizeEvent);
 * this fixes the cache-invalidation path at the source.
 */
function getRelativePath(fullPath, spacePath) {
  return path.relative(spacePath, fullPath).replace(/\\/g, '/');
}

/**
 * Get file/folder stats
 */
async function getFileStats(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return {
      created: stats.birthtime.toISOString(),
      modified: stats.mtime.toISOString(),
      size: stats.size
    };
  } catch (error) {
    return {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      size: 0
    };
  }
}

/**
 * True when any segment of the path is the `.archive` folder, so files we have
 * already archived are never re-converted (a belt-and-braces guard on top of
 * the chokidar `ignored` rule).
 * @private
 */
function isInArchive(filePath) {
  return filePath.split(/[\\/]/).includes(ARCHIVE_DIR_NAME);
}

/**
 * Handle a freshly dropped office/PDF document, dispatching by the file-handling
 * policy (see filePolicy.js):
 *
 *   - PDF ("view original"): keep the original as the visible, natively-rendered
 *     document and generate a hidden `.system/derived` markdown sidecar so search
 *     and context can read it. The original is NOT consumed.
 *   - Office ("view markdown"): convert to a VISIBLE `<name>.md` page and relocate
 *     the untouched source into `.system/originals` for the page's download link.
 *     The original IS consumed (moved out of the tree).
 *
 * @private
 * @returns {Promise<{ consumedOriginal: boolean }>} consumedOriginal is true when
 *   the original was relocated (so the caller must not broadcast it as a new file).
 */
async function processDroppedDocument(filePath, space, services) {
  if (!canConvert(filePath)) return { consumedOriginal: false }; // e.g. .pptx

  // PDF (and any other "view original" convertible): the original stays put; we
  // only need a hidden derived markdown for search/context.
  if (getPolicy(filePath).view === 'original') {
    await generateSidecar(filePath, space, services);
    return { consumedOriginal: false };
  }

  // Office: the markdown becomes the visible page; the source moves to originals.
  return convertOfficeToVisiblePage(filePath, space, services);
}

/**
 * Convert a dropped office document into a visible `<name>.md` wiki page and
 * relocate the untouched source into `.system/originals` so the page's download
 * link serves it.
 *
 * Prefers the design-documents "Design: Process File" workflow (convert + AI
 * clean, recorded in the workflow execution history); falls back to a plain
 * conversion when the engine/workflow is unavailable. If conversion fails
 * entirely, the original is left in place with a hidden derived sidecar so it is
 * never made unreachable.
 *
 * @private
 * @returns {Promise<{ consumedOriginal: boolean }>}
 */
async function convertOfficeToVisiblePage(filePath, space, services) {
  const { log } = services;
  const spaceRoot = space.path || space.configuration?.filing?.baseDir;
  const relativePath = getRelativePath(filePath, spaceRoot);
  const outputDocument = filePath.replace(/\.[^/.]+$/, '') + '.md';

  // 1. Produce the markdown page (workflow preferred, plain convert as fallback).
  let produced = false;
  try {
    produced = await runProcessFileWorkflow(filePath, outputDocument, services);
  } catch (error) {
    log.warn(`[FileWatcher] "Design: Process File" failed for ${path.basename(filePath)}: ${error.message} — converting without AI clean`);
  }
  if (!produced) {
    try {
      const markdown = await convertToMarkdown(filePath);
      await fs.mkdir(path.dirname(outputDocument), { recursive: true });
      await fs.writeFile(outputDocument, markdown, 'utf8');
      produced = true;
    } catch (error) {
      log.warn(`[FileWatcher] Could not convert ${path.basename(filePath)}: ${error.message} — keeping original, writing sidecar`);
      await generateSidecar(filePath, space, services);
      return { consumedOriginal: false };
    }
  }

  // 2. Relocate the untouched source into `.system/originals`, mirroring its
  //    relative path. Suppress the watcher for the source path so the move's
  //    unlink event doesn't emit a phantom delete for a file the tree never
  //    surfaced. `.system` is already ignored, so the destination write is silent.
  try {
    const originalsAbs = path.join(spaceRoot, toOriginalsRelPath(relativePath));
    await fs.mkdir(path.dirname(originalsAbs), { recursive: true });
    if (global.fileWatcherSuppressed) global.fileWatcherSuppressed.add(filePath);
    await fs.rename(filePath, originalsAbs);
    log.info(`[FileWatcher] Stored original ${path.basename(filePath)} in ${ORIGINALS_DIR} (${space.name})`);
    // Release the suppression once chokidar has drained the unlink event.
    setTimeout(() => { try { global.fileWatcherSuppressed?.delete(filePath); } catch { /* noop */ } }, 5000);
    return { consumedOriginal: true };
  } catch (error) {
    log.warn(`[FileWatcher] Could not relocate original ${path.basename(filePath)}: ${error.message} — leaving it in place`);
    // The .md page exists but the original stays visible too — nothing is lost.
    return { consumedOriginal: false };
  }
}

/**
 * Run the "Design: Process File" workflow (convert + AI clean) writing markdown
 * to outputDocument. Returns false when the engine/workflow is unavailable (so
 * the caller can fall back); throws when the run itself fails.
 * @private
 * @returns {Promise<boolean>}
 */
async function runProcessFileWorkflow(filePath, outputDocument, services) {
  const { log, app } = services;
  const workflowBridge = app && typeof app.get === 'function' ? app.get('workflowBridge') : null;
  const workflow = workflowBridge && typeof workflowBridge.resolveWorkflowByName === 'function'
    ? workflowBridge.resolveWorkflowByName('Design: Process File')
    : null;
  if (!workflowBridge || !workflow) return false;

  if (workflowBridge.initialized === false && typeof workflowBridge.whenReady === 'function') {
    await workflowBridge.whenReady();
  }

  log.info(`[FileWatcher] Running "Design: Process File" on ${path.basename(filePath)} -> ${path.basename(outputDocument)}`);
  const execution = await workflowBridge.executeWorkflow(workflow.id, {
    settings: { sourceDocument: filePath, outputDocument }
  });

  // Two steps run: convert-document then clean-document. The convert step must
  // have produced markdown; a workflow can "succeed" while a step reports a soft
  // failure (e.g. an unsupported file type), so check it explicitly.
  const steps = execution?.result?.steps || [];
  const convertData = steps[0]?.data;
  if (!execution || execution.outcome !== 'success' || !convertData || convertData.success === false) {
    const message = convertData?.error || execution?.error || 'workflow did not complete';
    throw new Error(message);
  }

  log.info(`[FileWatcher] Processed ${path.basename(filePath)} -> ${path.basename(outputDocument)} (execution ${execution.id})`);
  return true;
}

/**
 * Generate (or refresh) the hidden markdown sidecar for an office/pdf original.
 * The markdown is written FOLDER-LOCAL, into a `.system/derived/` directory
 * inside the original's own folder (e.g. `sub/report.docx` →
 * `sub/.system/derived/report.docx.md`), so the derived text lives beside — and
 * for symlinked git-repo folders, inside the same repository as — its source.
 * The original is never touched — it remains the downloadable source of truth.
 *
 * Best-effort: a conversion failure (unsupported file, corrupt document) is
 * logged and swallowed so the original still surfaces normally; the file simply
 * falls back to a download-only view with no content indexed.
 *
 * @private
 * @returns {Promise<boolean>} true when a sidecar was written.
 */
async function generateSidecar(filePath, space, services) {
  const { log } = services;

  if (!canConvert(filePath)) return false; // e.g. .pptx — no Node-side converter

  const spaceRoot = space.path || space.configuration?.filing?.baseDir;
  const relativePath = getRelativePath(filePath, spaceRoot);

  // `force`: this is an add/change event, so the source is what just landed —
  // regenerate regardless of the mtime comparison the shared helper would make
  // (chokidar's awaitWriteFinish can settle the write after the sidecar's own
  // timestamp on a coarse-granularity filesystem).
  const result = await ensureSidecar(spaceRoot, relativePath, { force: true, log });

  if (result.written) {
    log.info(`[FileWatcher] Generated markdown sidecar for ${path.basename(filePath)} in ${space.name}`);
  }
  return result.written;
}

module.exports = {
  startFileWatcher,
  isSearchIndexablePath,
  // Exported for the parity test that ties the two predicates together: every
  // handler returns early on isIgnoredPath BEFORE reaching isSearchIndexablePath,
  // so an over-broad ignore silently de-indexes files the rebuild still keeps.
  isIgnoredPath
};
