/**
 * @fileoverview Search API routes for Wiki application
 * Handles search operations, indexing, and search suggestions with caching
 *
 * @author noobly Team
 * @version 2.0.0
 * @since 1.0.0
 */

'use strict';
const SearchIndexer = require('../activities/searchIndexer');
const { withCache, invalidateCache } = require('../../shared/middleware/cacheMiddleware');
const { startup } = require('../../shared/startup/startupRunner');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');
const { contentRootKey, equivalentSpaceNames } = require('../../shared/spaces/contentRoot');

/**
 * Configures and registers search routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services (dataManager, filing, cache, logger, queue, search, searchIndexer)
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {

  const app = options.app || options['express-app'];
  const { dataManager, filing, cache, log, queue, search, searchIndexer } = services;
  const logger = log; // Alias for backward compatibility

  // Build initial index (after SpaceManager is ready)
  // Get SpaceManager to wait for initialization before building index
  const spaceManager = app.get('spaceManager');

  // Startup index build.
  //
  // `buildIndex()` loads the persisted index from disk and returns immediately
  // when that succeeds — the expensive path is only taken when there is no
  // usable index on disk. But when it IS taken it reads and tokenises every
  // content file in every space, which saturates libuv's threadpool and starves
  // everything else doing file I/O: with a large corpus the folder-tree endpoint
  // went from ~7s to minutes, and browsers sat on pending requests. The app was
  // effectively unusable for the whole build while still answering trivial,
  // file-free endpoints in under a second.
  //
  // So the build no longer races startup:
  //   - WIKI_INDEX_ON_BOOT=false skips it entirely (search then serves whatever
  //     is on disk; rebuild on demand via POST /search/rebuild),
  //   - otherwise it is deferred by WIKI_INDEX_BOOT_DELAY_MS (default 20s) so
  //     the server finishes booting and serves the first page loads BEFORE the
  //     corpus walk starts competing with them.
  // The disk-load fast path is unaffected in practice — it is a single file read
  // that will have completed long before anyone notices the delay.
  const INDEX_ON_BOOT = process.env.WIKI_INDEX_ON_BOOT !== 'false';
  const INDEX_BOOT_DELAY_MS = Number(process.env.WIKI_INDEX_BOOT_DELAY_MS ?? 20000);

  const buildInitialIndex = (reason) => {
    if (!INDEX_ON_BOOT) {
      logger.info('[SearchRoutes] WIKI_INDEX_ON_BOOT=false — skipping the startup index build');
      return Promise.resolve();
    }
    if (INDEX_BOOT_DELAY_MS > 0) {
      logger.info(`[SearchRoutes] Search index build deferred ${INDEX_BOOT_DELAY_MS}ms so it does not compete with startup (${reason})`);
      const timer = setTimeout(() => {
        startup.track('wiki:search-index', () => searchIndexer.buildIndex(), { description: `${reason} (deferred)` })
          .catch(error => logger.error('Failed to build search index:', error));
      }, INDEX_BOOT_DELAY_MS);
      // Never hold the process open for this.
      if (typeof timer.unref === 'function') timer.unref();
      return Promise.resolve();
    }
    return startup.track('wiki:search-index', () => searchIndexer.buildIndex(), { description: reason });
  };

  if (spaceManager && spaceManager.initialize) {
    // Wait for SpaceManager to load spaces before building index.
    // NOTE: this is the SECOND call to spaceManager.initialize() — datasources
    // already ran it during its own init (src/datasources/initialize.js).
    // Left as-is: instrumentation only.
    Promise.resolve(spaceManager.initialize ? spaceManager.initialize() : Promise.resolve()).then(() => {
      logger.info('[SearchRoutes] SpaceManager ready, building search index...');
      buildInitialIndex('after SpaceManager ready').catch(error => {
        logger.error('Failed to build search index:', error);
      });
    }).catch(error => {
      logger.warn('[SearchRoutes] SpaceManager initialization failed, building index anyway:', error.message);
      // Still try to build index even if spaceManager failed
      buildInitialIndex('SpaceManager init failed').catch(buildError => {
        logger.error('Failed to build search index:', buildError);
      });
    });
  } else {
    // Fallback: build index immediately if SpaceManager not available
    setImmediate(() => {
      buildInitialIndex('no SpaceManager').catch(error => {
        logger.error('Failed to build initial search index:', error);
      });
    });
  }

  /**
   * Enhanced search handler (extracted for caching)
   */
  const searchHandler = async (req, res) => {
    try {
      const query = req.query.q?.trim() || '';
      const fileTypes = req.query.fileTypes ? req.query.fileTypes.split(',') : [];
      const includeContent = req.query.includeContent === 'true';

      // Optional folder scope: constrain results to a folder subtree (the folder
      // and everything below it). Sent by the UI as a space-relative path.
      const folderPath = req.query.folderPath?.trim();
      const pathPrefix = (folderPath && folderPath !== '/') ? folderPath : '';

      // Space filter is id-based, consistent with the rest of the document API
      // (spaceId / spaceIds). The search index keys documents by space *name*,
      // so we resolve the requested ids to names below. Legacy spaceName /
      // spaceNames params are still honoured as a fallback.
      const spaceIds = req.query.spaceIds ? req.query.spaceIds.split(',') : [];
      const singleSpaceId = req.query.spaceId?.trim();
      const legacySpaceNames = req.query.spaceNames ? req.query.spaceNames.split(',') : [];
      const legacySpaceName = req.query.spaceName?.trim();

      // Result cap: default 200, override via ?limit=. Callers needing the full
      // result set can pass a large limit; the index size is the real bound.
      const requestedLimit = parseInt(req.query.limit, 10);
      const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 200;

      if (!query) {
        return res.json([]);
      }

      // Load spaces once — used both to resolve the id-based filter into the
      // names the indexer understands, and to attach spaceId/spaceName to each
      // result further down.
      let spaces = [];
      try {
        const spacesData = await dataManager.read('spaces');
        spaces = Array.isArray(spacesData) ? spacesData : (spacesData?.data || []);
        if (!spaces) spaces = [];
      } catch (error) {
        logger.warn('Could not read spaces for search:', error.message);
        spaces = [];
      }

      // ===== Resolve the space filter to a CONTENT ROOT, not a name =====
      //
      // A space is a lens over a directory, and several spaces share one
      // directory (Engineering / Financial Services / People / Retail are all
      // `knowledge-content/engineering`). The index stamps each document with a
      // single `spaceName` — whichever space indexed that root last, since
      // buildIndex walks each root once — so filtering hits by the REQUESTED
      // space's own name matched nothing for every space except that one, and
      // three of the four returned zero results for every query.
      //
      // So expand the request to every space sharing its content root: those
      // spaces index the same documents, and whichever name the indexer
      // happened to stamp is equally valid for all of them. What each space is
      // actually allowed to SEE is a separate question, settled below by
      // compileVisibility() against the space's allowedPaths/excludedPaths —
      // which is the real boundary and is enforced regardless of the stamp.
      const requestedSpaces = [];
      const requestedIds = [];
      if (singleSpaceId) requestedIds.push(singleSpaceId);
      if (spaceIds.length > 0) requestedIds.push(...spaceIds);
      for (const rawId of requestedIds) {
        const idStr = String(rawId).trim();
        if (!idStr) continue;
        const match = spaces.find(s => String(s.id) === idStr);
        if (match) requestedSpaces.push(match);
        else logger.warn(`[Search] Unknown spaceId '${idStr}' ignored`);
      }
      // Legacy fallback: accept space names directly when ids aren't supplied.
      for (const rawName of [legacySpaceName, ...legacySpaceNames]) {
        const name = String(rawName || '').trim();
        if (!name) continue;
        const match = spaces.find(s => s.name === name);
        // An unknown name still filters — on itself. Dropping it would silently
        // widen the search to every space.
        requestedSpaces.push(match || { name });
      }

      const spaceFilter = [...equivalentSpaceNames(requestedSpaces, spaces)];
      if (spaceFilter.length > requestedSpaces.length) {
        logger.info(
          `[Search] Space filter expanded to ${spaceFilter.length} space(s) sharing the same content root: `
          + spaceFilter.join(', ')
        );
      }

      // Use the enhanced search indexer (now async)
      let searchResults = await searchIndexer.search(query, {
        maxResults: limit,
        includeContent: includeContent,
        fileTypes: fileTypes,
        spaceNames: spaceFilter,
        pathPrefix: pathPrefix
      });

      // Load content on-demand for results that need it (v2: no longer stored in memory)
      if (includeContent) {
        for (const result of searchResults) {
          if (result._needsContent) {
            result.content = await searchIndexer.loadContent(result);
            delete result._needsContent;
          }
        }
      }

      // NO FULL-CORPUS FALLBACK ON AN EMPTY RESULT — deliberately removed.
      //
      // This used to call documentService.listAll() whenever the index returned
      // nothing, on the theory that a title/path substring scan might rescue the
      // query. It could not: listAll() matches only titles and paths, which the
      // index already covers and ranks better, so the scan found what the index
      // had found or nothing at all. What it did do was walk the entire shared
      // content root INLINE, inside the request — 6,022 directory listings over
      // 29,630 files here, ~3.6s of pure readdir before any per-file work, then
      // one filterTree + flatten PER space on that root (four of them, ~118,000
      // descriptor objects) — to produce an empty array.
      //
      // It also never warmed up: withCache stores a response only when it has
      // content (cacheMiddleware.js — `hasContent = data.length > 0`), so an
      // empty result was re-computed from scratch on every retry. "No hits" is
      // the single most common query outcome, which made the most expensive
      // operation in the wiki the one paid for the cheapest answer.
      //
      // An empty result is now just an empty result, returned immediately.

      // ===== Per-space path visibility (allowedPaths / excludedPaths) =====
      // A space may expose only part of its content root, and two spaces can be
      // different lenses over the SAME root.
      //
      // JUDGE EACH HIT BY THE SPACE THE CALLER ASKED FOR, NOT BY THE NAME
      // STAMPED ON IT. Those are no longer the same thing: scoping is now by
      // content root, so a search of Engineering Space legitimately returns hits
      // the indexer stamped "Retail Space". Compiling visibility from the
      // stamp would apply Retail's allowedPaths to an Engineering search —
      // wrong in both directions. It would hide Engineering documents that lie
      // outside Retail's three subtrees, and, in the mirror case, hand a
      // narrow space results its own rules exclude. The stamp is an artefact of
      // which space indexed the root last; only the requested space is a
      // statement about what this caller may see.
      //
      // With no space requested the search spans everything, so a hit survives
      // if ANY space that can see that root admits it — matching what the user
      // would get by searching each space in turn. A judge only votes on its
      // OWN root, or an unrestricted space on one root would vouch for hits in
      // a root it cannot see at all.
      const judgeSpaces = requestedSpaces.length > 0 ? requestedSpaces : spaces;
      const judgesByRoot = new Map();
      for (const space of judgeSpaces) {
        const key = contentRootKey(space);
        if (!judgesByRoot.has(key)) judgesByRoot.set(key, []);
        judgesByRoot.get(key).push(compileVisibility(space));
      }

      // The stamp on a hit resolves to a root via spaces.json.
      const rootByStamp = new Map();
      const rootForStamp = (spaceName) => {
        if (!rootByStamp.has(spaceName)) {
          const space = spaces.find(s => s.name === spaceName);
          rootByStamp.set(spaceName, space ? contentRootKey(space) : null);
        }
        return rootByStamp.get(spaceName);
      };

      const beforeVisibility = searchResults.length;
      searchResults = searchResults.filter(result => {
        const relPath = result.relativePath || result.path;
        const applicable = judgesByRoot.get(rootForStamp(result.spaceName));
        if (!applicable) {
          // The stamp names a space spaces.json no longer has — the index still
          // carries a pre-rename name. Keep the hit: a rename must not blank
          // out search until the next reindex (that exact silent outage has
          // bitten pins and notifications here). A scoped request has already
          // vetted the stamp by name, so this only widens an unscoped search,
          // which spans every space anyway.
          return true;
        }
        return applicable.some(v => !v.restricted || v.isFileVisible(relPath));
      });
      if (searchResults.length !== beforeVisibility) {
        logger.info(`[Search] Path filter removed ${beforeVisibility - searchResults.length} of ${beforeVisibility} hits`);
      }

      // (spaces already loaded above for the id→name filter resolution)

      // Create a mapping for hardcoded space names to actual spaces
      // (This handles legacy search index entries with hardcoded space names)
      const spaceNameMapping = {
        'Personal Space': spaces.find(s => s.name.includes('Personal') || s.name.includes('Default') || s.visibility === 'private') || spaces[0],
        'Shared Space': spaces.find(s => s.name.includes('Shared') || s.visibility === 'team') || spaces[0],
        'Read-Only Space': spaces.find(s => s.name.includes('Read-Only') || s.name.includes('Knowledge')) || spaces.find(s => s.permissions === 'read-only'),
        'Collaboration Team Space': spaces.find(s => s.name.includes('Collaboration') || s.visibility === 'team') || spaces[0]
      };

      // A hit belongs to the space the caller is searching FROM, when they named
      // one. The frontend opens a result with the spaceId reported here, so
      // handing back the indexer's stamp would teleport a user searching
      // Engineering Space into Retail Space on every click — same document,
      // same path on the same root, but a different lens, tree and theme. Only
      // an unscoped search has no better answer than the stamp.
      const scopedSpace = requestedSpaces.length === 1 && requestedSpaces[0].id != null
        ? requestedSpaces[0]
        : null;

      // Format results for frontend with spaceId lookup
      const formattedResults = searchResults.slice(0, limit).map(result => {
        const originalSpaceName = result.spaceName || result.baseType;

        // Try to find matching space by name
        let space = scopedSpace || spaces.find(s => s.name === originalSpaceName);

        // If exact name match not found, try the mapping for hardcoded names
        if (!space && spaceNameMapping[originalSpaceName]) {
          space = spaceNameMapping[originalSpaceName];
        }

        // Fallback: use first public space if available
        if (!space && spaces.length > 0) {
          space = spaces.find(s => s.visibility === 'public') || spaces[0];
        }

        const spaceId = space ? space.id : null;
        // Use the actual space name (from space record) so document content lookups succeed
        const resolvedSpaceName = space ? space.name : originalSpaceName;

        return {
          id: result.id || result.relativePath,
          title: result.title || result.name,
          excerpt: result.excerpt || result.excerpt,
          // Match-centered context snippet from the core search engine (the hit
          // wrapped in <mark>…</mark>); the results UI shows it in place of the
          // static excerpt when present.
          snippet: result.snippet || '',
          path: result.relativePath || result.path,
          spaceName: resolvedSpaceName,
          spaceId: spaceId, // Include spaceId for frontend to use
          modifiedAt: result.modifiedAt || result.modifiedTime,
          tags: result.tags || [],
          type: result.type,
          size: result.size,
          // Wiki facet axes (derived from the path at index time). Additive —
          // existing consumers ignore them; the search UI uses them to build the
          // Space / Folder L1 / Folder L2 / Type filters.
          folderL1: result.folderL1 ?? null,
          folderL2: result.folderL2 ?? null,
          docType: result.docType || null,
          relevance: result.score || 0.5,
          content: result.content // Only included if requested
        };
      });

      res.status(200).json(formattedResults);
    } catch (error) {
      logger.error('Error performing enhanced search:', error);
      res.status(200).json([]);
    }
  };

  /**
   * Enhanced search endpoint with comprehensive file indexing
   * Cached with 5 minute TTL (different queries = different cache keys)
   */
  app.get('/applications/wiki/api/search', cache ?
    withCache(cache, searchHandler, {
      keyPrefix: 'wiki:search',
      ttl: 300
    }) :
    searchHandler
  );

  /**
   * Search suggestions handler (extracted for caching)
   */
  const suggestionsHandler = async (req, res) => {
    try {
      const query = req.query.q?.trim() || '';
      const maxSuggestions = parseInt(req.query.limit) || 10;

      if (!query) {
        return res.status(200).json([]);
      }

      // Space filter is id-based (spaceId / spaceIds), consistent with search.
      // The index keys documents by space name, so resolve the requested ids to
      // names. Legacy spaceName / spaceNames are accepted as a fallback.
      const spaceIds = req.query.spaceIds ? req.query.spaceIds.split(',') : [];
      const singleSpaceId = req.query.spaceId?.trim();
      const legacySpaceNames = req.query.spaceNames ? req.query.spaceNames.split(',') : [];
      const legacySpaceName = req.query.spaceName?.trim();

      const requestedIds = [];
      if (singleSpaceId) requestedIds.push(singleSpaceId);
      if (spaceIds.length > 0) requestedIds.push(...spaceIds);

      // Spaces are needed to resolve an id filter AND to apply each space's
      // path visibility below. dataManager.read is an uncached file read and
      // this endpoint fires per keystroke, so it stays lazy — loaded at most
      // once per request, and not at all when neither consumer needs it.
      let spacesPromise = null;
      const loadSpaces = () => {
        if (!spacesPromise) {
          spacesPromise = dataManager.read('spaces')
            .then(data => (Array.isArray(data) ? data : (data?.data || [])) || [])
            .catch(error => {
              logger.warn('Could not read spaces for suggestions:', error.message);
              return [];
            });
        }
        return spacesPromise;
      };

      // Scoped by CONTENT ROOT, exactly as /search is — the index carries one
      // space name per document, so a request naming any other space sharing
      // that root must accept the stamp it happens to find. See the long note
      // in searchHandler.
      const requestedSpaces = [];
      let spaceFilter = [];
      if (requestedIds.length > 0 || legacySpaceName || legacySpaceNames.length > 0) {
        const spaces = await loadSpaces();
        for (const rawId of requestedIds) {
          const idStr = String(rawId).trim();
          if (!idStr) continue;
          const match = spaces.find(s => String(s.id) === idStr);
          if (match) requestedSpaces.push(match);
        }
        // Legacy fallback: accept space names directly.
        for (const rawName of [legacySpaceName, ...legacySpaceNames]) {
          const name = String(rawName || '').trim();
          if (!name) continue;
          requestedSpaces.push(spaces.find(s => s.name === name) || { name });
        }
        spaceFilter = [...equivalentSpaceNames(requestedSpaces, spaces)];
      }

      const folderPath = req.query.folderPath?.trim();
      const pathPrefix = (folderPath && folderPath !== '/') ? folderPath : '';

      // ?documents=true — return only path-bearing document suggestions, never
      // bare index terms. Callers that must resolve a pick back to a document
      // (the pane block's source picker) need {path, spaceName} on every item;
      // without this the unscoped request takes the core token service's fast
      // path, which answers with term strings and drops the path entirely.
      // Folder-path matching rides along, so "solution design/road" finds a
      // document by where it lives, not just by how it is named.
      const documentsOnly = /^(1|true|yes)$/i.test(
        String(req.query.documents ?? req.query.documentsOnly ?? '').trim()
      );

      // Same file-type vocabulary as /search ('markdown', 'pdf', 'office', …).
      const fileTypes = req.query.fileTypes
        ? req.query.fileTypes.split(',').map(t => t.trim()).filter(Boolean)
        : [];

      const suggestions = searchIndexer.getSuggestions(query, {
        maxSuggestions: maxSuggestions,
        spaceNames: spaceFilter.length > 0 ? spaceFilter : undefined,
        pathPrefix: pathPrefix,
        documentsOnly: documentsOnly,
        matchPaths: documentsOnly,
        fileTypes: fileTypes
      }) || [];

      // Drop document suggestions the owning space does not expose, so
      // autocomplete cannot surface the title of a hidden file. Bare
      // search-TERM suggestions carry no path and are left alone.
      const pathBearing = suggestions.filter(s => s && (s.path || s.relativePath));
      if (pathBearing.length === 0) {
        return res.status(200).json(suggestions);
      }

      const spaces = await loadSpaces();
      const visibilityBySpace = new Map();
      const visible = suggestions.filter(suggestion => {
        const suggestionPath = suggestion && (suggestion.path || suggestion.relativePath);
        if (!suggestionPath) return true;
        const spaceName = suggestion.spaceName;
        if (!visibilityBySpace.has(spaceName)) {
          const space = spaces.find(s => s.name === spaceName);
          visibilityBySpace.set(spaceName, space ? compileVisibility(space) : null);
        }
        const visibility = visibilityBySpace.get(spaceName);
        if (!visibility || !visibility.restricted) return true;
        return visibility.isFileVisible(suggestionPath);
      });

      res.status(200).json(visible);
    } catch (error) {
      logger.error('Error getting search suggestions:', error);
      res.status(200).json([]);
    }
  };

  /**
   * Search suggestions endpoint for autocomplete
   * Cached with 5 minute TTL
   */
  app.get('/applications/wiki/api/search/suggestions', cache ?
    withCache(cache, suggestionsHandler, {
      keyPrefix: 'wiki:suggestions',
      ttl: 300
    }) :
    suggestionsHandler
  );

  // Search index statistics endpoint
  app.get('/applications/wiki/api/search/stats', async (req, res) => {
    try {
      const stats = await searchIndexer.getStats();
      res.json(stats);
    } catch (error) {
      logger.error('Error getting search stats:', error);
      res.status(500).json({ error: 'Failed to get search statistics' });
    }
  });

  /**
   * Rebuild search index endpoint
   * Invalidates search cache when index is rebuilt
   */
  app.post('/applications/wiki/api/search/rebuild',
    cache ? invalidateCache(cache, ['wiki:search', 'wiki:suggestions']) : (req, res, next) => next(),
    async (req, res) => {
      try {
        // Rebuild index in background (force: skip disk cache)
        setImmediate(() => {
          searchIndexer.buildIndex({ force: true }).catch(error => {
            logger.error('Failed to rebuild search index:', error);
          });
        });

        res.json({ success: true, message: 'Index rebuild started' });
      } catch (error) {
        logger.error('Error starting index rebuild:', error);
        res.status(500).json({ error: 'Failed to start index rebuild' });
      }
    }
  );

};
