/**
 * @fileoverview Wiki Module Initializer
 * Sets up knowledge management, file synchronization, real-time updates,
 * and AI-powered content assistance within the unified backend.
 *
 * @author noobly Team
 * @version 2.0.0
 */

'use strict';

const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');

const { createKnowledge } = require('./knowledge');
const DataManager = require('./components/dataManager');
const AIService = require('./components/aiService');
const WikiEventBus = require('./components/eventBus');
const NotificationManager = require('./components/notificationManager');
const TreeCache = require('./components/treeCache');
const SearchIndexer = require('./activities/searchIndexer');
const { run: initializeWikiDataRun } = require('./initialisation/initialiseWikiData');
const { startFileWatcher } = require('./activities/fileWatcher');
const { processTask } = require('./activities/taskProcessor');
const BearerTokenMiddleware = require('./auth/bearerTokenMiddleware');

// Routes (routes/index.js) is the aggregate registrar for every wiki route
// module EXCEPT these two — see the registration block below.
const Routes = require('./routes');
const FilingRoutes = require('./routes/filingRoutes');
const NotificationRoutes = require('./routes/notificationRoutes');
const FilingServiceWrapper = require('./utils/filingServiceWrapper');
const { ensureSidecar, spaceRootOf } = require('./utils/derivedSidecar');
const DocumentService = require('./components/documentService');
const { startup } = require('../shared/startup/startupRunner');

/**
 * Initialize the Wiki module
 * @param {Object} app - Express application instance
 * @param {Object} server - HTTP server instance
 * @param {Object} io - Socket.IO instance (shared from unified backend)
 * @param {Object} eventEmitter - Event emitter for inter-module communication
 * @param {Object} serviceRegistry - noobly Core service registry
 * @param {Object} services - Initialized services (authservice, filing, cache, log, etc.)
 */
module.exports = (app, server, io, eventEmitter, serviceRegistry, services) => {
  const { authservice, filing, cache, log, queue, searching, aiservice, notifying, settings, appBaseDir } = services;

  const dataDirectory = appBaseDir || path.join(process.cwd(), '.application');

  // ========================================================================
  // Initialize Core Wiki Components
  // ========================================================================

  const dataManager = new DataManager(dataDirectory, filing);
  const aiService = new AIService(serviceRegistry, dataManager, log);
  const searchIndexer = new SearchIndexer(log, dataManager, searching, null, { appBaseDir: dataDirectory });

  // Expose dataManager on the app so other modules (e.g. continuous exploration export)
  // can write into wiki spaces. The health check at /api/health already
  // references this binding.
  app.set('wikiDataManager', dataManager);

  // Make components available globally for other modules
  global.searchIndexer = searchIndexer;
  if (!global.io) {
    global.io = io;
  }

  log.info('✓ Core wiki components initialized (DataManager, AIService, SearchIndexer)');

  // ========================================================================
  // Initialize Wiki Event Bus
  // ========================================================================

  // Persist event history to disk so the /applications/wiki/api/changes
  // feed (consumed by the wiki daemon) survives a backend restart. Rotated
  // daily into changeevents/event-history-YYYY-MM-DD.jsonl.
  const changeEventsDir = path.join(dataDirectory, 'changeevents');
  const eventBus = new WikiEventBus(log, io, { persistenceDir: changeEventsDir });
  global.eventBus = eventBus;

  log.info(`✓ Wiki Event Bus initialized (history persisted to ${changeEventsDir})`);

  // ========================================================================
  // Initialize Folder Tree Cache (per-space, ETag-validated)
  // ========================================================================

  const treeCache = new TreeCache({ logger: log });
  treeCache.attach(eventBus);
  // Expose globally so maintenance workflows can invalidate it on demand.
  global.treeCache = treeCache;
  log.info('✓ Folder tree cache initialized (ETag + auto-invalidation)');

  // ========================================================================
  // Initialize Notification Manager
  // ========================================================================

  // Delivery transport for per-user notifications: push to the user's Socket.IO
  // room. Kept here so NotificationManager stays free of socket concerns.
  const deliver = (userId, payload) => io.to('user:' + userId).emit('wiki:user-notification', payload);

  const notificationManager = new NotificationManager(filing, log, dataDirectory, notifying, deliver);
  startup.track('wiki:notifications', async () => {
    try {
      await notificationManager.initialize();
      log.info('✓ Notification Manager initialized');
    } catch (error) {
      log.error('✗ Failed to initialize notification manager:', error);
    }
  });

  // ========================================================================
  // Setup Socket.IO User Rooms for Notifications
  // ========================================================================

  io.on('connection', (socket) => {
    socket.on('user:join', (userId) => {
      if (userId) {
        socket.join('user:' + userId);
        log.debug('User joined notification room', { userId, socketId: socket.id });
      }
    });
  });

  log.info('✓ Socket.IO user notification rooms configured');

  // Real-time distribution is handled by the core notifying service: each
  // subscription registers a per-path topic callback inside NotificationManager,
  // which delivers via the `deliver` function wired above. See publishChange.

  // Add debugging helpers for development
  if (process.env.NODE_ENV !== 'production') {
    global.WikiEventBusDebug = {
      recent: (count = 10) => eventBus.getRecentEvents(count),
      stats: () => eventBus.getStatistics(),
      summary: () => eventBus.printSummary(),
      activity: () => eventBus.getActivitySummary(),
      clearHistory: () => eventBus.clearHistory(),
      filter: (predicate) => eventBus.filterEvents(predicate),
      subscribe: (eventType, callback) => eventBus.subscribe(eventType, callback),
      bus: () => eventBus
    };
    log.info('Wiki Event Bus Debug helpers available at: global.WikiEventBusDebug');
  }

  // ========================================================================
  // Initialize Wiki Data & Background Services
  // ========================================================================

  // Initialize wiki data if not exists
  startup.track('wiki:data', async () => {
    try {
      await initializeWikiDataRun(dataManager, filing, cache, log, queue, searching);
      log.info('✓ Wiki data initialized');
    } catch (error) {
      log.error('✗ Failed to initialize wiki data:', error);
    }
  });

  // Start background queue worker
  startQueueWorker({ dataManager, filing, cache, log, queue, searching, aiService, searchIndexer });

  // Start file watcher for real-time updates. startFileWatcher returns a promise
  // that settles when chokidar emits 'ready' — i.e. once it has walked and
  // stat'd every file under every space — so the task duration reflects the
  // whole initial tree walk, not just the call that kicks it off.
  if (io) {
    startup.track('wiki:file-watcher', () =>
      startFileWatcher({ app, dataManager, filing, cache, log, queue, searching, aiService, io, searchIndexer, appBaseDir }));
  }

  // Start AI Context generation scheduler (after a short delay)
  /*
  setTimeout(() => {
    startAIContextScheduler({ dataManager, filing, cache, log, queue, searching, aiService, searchIndexer, serviceRegistry });
  }, 2000);
  */

  log.info('✓ Background services initialized (queue worker, file watcher, AI scheduler)');

  // ========================================================================
  // Setup Document Change Notifications
  // ========================================================================

  // Listen for document/folder changes and publish to the core notifying
  // service. Fan-out, per-user history and delivery are handled inside
  // NotificationManager.publishChange via per-path topic callbacks.
  if (notificationManager) {
    eventBus.on('change', async (event) => {
      try {
        const { item } = event;
        const notification = {
          type: event.event.type,
          path: item.path,
          name: item.name,
          timestamp: event.event.timestamp,
          operation: event.event.operation,
          spaceName: event.space?.name || null,
          spaceId: event.space?.id || null
        };

        await notificationManager.publishChange(item.path, notification);
      } catch (error) {
        log.error('Error processing document change notification:', error);
      }
    });

    log.info('✓ Document change notification listener registered');
  }

  // ========================================================================
  // Initialize Bearer Token Authentication
  // ========================================================================

  const bearerTokenMiddleware = new BearerTokenMiddleware(log, cache);
  log.info('✓ Bearer Token Middleware initialized');

  // Apply Bearer token middleware to all Wiki API routes
  app.use('/applications/wiki/api', bearerTokenMiddleware.middleware());
  log.info('Bearer Token Middleware applied to /applications/wiki/api routes');

  // Also honour bearer tokens on the global /api/auth/* endpoints (notably
  // GET /api/auth/check, which the web wiki calls on load). Without this, a
  // token-only client with no session cookie — e.g. the web wiki embedded in
  // the Teams tab, where SameSite=lax blocks the cookie — gets 401 from
  // /api/auth/check and bounces to the login page. The middleware is
  // non-blocking (it only populates req.user when a valid token is present and
  // never touches the session), so cookie/session users are unaffected. MUST be
  // registered before the auth routes (Routes() below) so it runs first.
  app.use('/api/auth', bearerTokenMiddleware.middleware());
  log.info('Bearer Token Middleware applied to /api/auth routes (token-auth for embedded/trusted clients)');

  // Make bearer token middleware available globally
  global.bearerTokenMiddleware = bearerTokenMiddleware;

  // Register a long-lived static service token from the environment so headless
  // callers — notably the Source Repo Discovery workflow, which runs in a
  // scheduler worker thread with no interactive user — can authenticate to the
  // /api schedule endpoints without a login round-trip. Bearer tokens live in an
  // in-memory map, so this is re-registered on every startup and therefore
  // survives restarts. The token value is a shared secret (treat it like an API
  // key); the synthetic service user carries the roles the schedule API needs.
  // No-op when WORKFLOW_API_TOKEN is unset.
  if (process.env.WORKFLOW_API_TOKEN) {
    const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
    bearerTokenMiddleware.registerToken(process.env.WORKFLOW_API_TOKEN, {
      id: 'workflow-service',
      username: 'workflow-service',
      email: 'workflow-service@local',
      name: 'Workflow Service Account',
      roles: ['admin', 'Datasources Administrator']
    }, TEN_YEARS_MS);
    log.info('✓ Registered static WORKFLOW_API_TOKEN service token');
  }

  // Enforce authentication on all Wiki API routes (blocking guard).
  // The bearer middleware above is NON-blocking — it only populates req.user when a
  // valid token is present and otherwise calls next(). Without this guard the wiki
  // document, content, upload, convert, AI-chat and user endpoints are reachable
  // anonymously (read + write). Session auth (cookies) and bearer/query tokens are
  // both honoured because they have already run by this point.
  //
  // Public exceptions: non-sensitive infra/UI endpoints the frontends load before
  // authentication. Paths are relative to the /applications/wiki/api mount point.
  const WIKI_API_PUBLIC_PATHS = new Set([
    '/health',                   // load-balancer / orchestrator health check
    '/status',                   // app status banner
    '/config',                   // client feature flags (e.g. aiChatEnabled)
    '/wizard/config',            // first-run wizard config read pre-setup
    '/swagger/openapi.json',     // OpenAPI spec (public documentation)
    '/mcp/info',                 // MCP discovery: server name, transport, tool list
    // NOT public — mcp/mount.js runs its own identical isAuthenticated() check.
    // It is exempted here so that check is the one that answers, because an MCP
    // client needs a JSON-RPC error body plus the `WWW-Authenticate` header that
    // tells it HOW to authenticate. This guard's bare `{success:false}` 401 is
    // read by MCP clients as a malformed response rather than a login prompt.
    '/mcp'
  ]);
  app.use('/applications/wiki/api', (req, res, next) => {
    if (WIKI_API_PUBLIC_PATHS.has(req.path)) return next();
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    return res.status(401).json({ success: false, error: 'Authentication required' });
  });
  log.info('✓ Authentication guard applied to /applications/wiki/api routes');

  // Start periodic token cleanup (every 10 minutes)
  const tokenCleanupInterval = setInterval(() => {
    bearerTokenMiddleware.clearExpiredTokens();
  }, 10 * 60 * 1000);

  // Add debug endpoint for Bearer token stats
  app.get('/applications/wiki/api/auth/token-stats', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const stats = global.bearerTokenMiddleware.getStats();
    res.json({ success: true, tokenStats: stats });
  });

  // ========================================================================
  // Register Wiki Routes & Views
  // ========================================================================

  // Initialize filing service wrapper for document access via filing service
  const spaceManager = app.get('spaceManager');
  const spaceFilingManager = app.get('spaceFilingManager');
  const filingServiceWrapper = spaceManager && spaceFilingManager
    ? new FilingServiceWrapper(spaceManager, spaceFilingManager, filing, log)
    : null;

  // Inject wrapper into components for document access via filing service
  if (filingServiceWrapper) {
    dataManager.setFilingServiceWrapper(filingServiceWrapper);
    searchIndexer.setFilingServiceWrapper(filingServiceWrapper);
    log.info('✓ FilingServiceWrapper injected into DataManager and SearchIndexer');
  }

  // Let the indexer repair derived markdown sidecars as it walks the corpus.
  //
  // A PDF's text reaches search ONLY through `<folder>/.system/derived/<name>.pdf.md`
  // (filePolicy gives PDFs `view: 'original', search: 'markdown'`, which is what
  // keeps the search result pointing at the PDF). The file watcher writes that
  // sidecar on add/change, but it starts with `ignoreInitial: true` — so anything
  // already on disk at boot, or copied in while the backend was down, has none and
  // would index by file name alone. An index build is the one pass that visits
  // every file, so it is where the gap gets closed.
  //
  // Set WIKI_DERIVE_ON_INDEX=false to keep index builds read-only (documents with
  // no sidecar then stay searchable by name only).
  if (spaceManager && process.env.WIKI_DERIVE_ON_INDEX !== 'false') {
    searchIndexer.setDerivedSidecarResolver(async (spaceName, relativePath) => {
      const space = spaceManager.getAllSpaces()
        .find(s => s.name === spaceName || String(s.id) === String(spaceName));
      const spaceRoot = spaceRootOf(space);
      if (!spaceRoot) return null;
      return ensureSidecar(spaceRoot, relativePath, { log });
    });
    log.info('✓ SearchIndexer will derive missing markdown sidecars (PDF/office) while indexing');
  }

  // The single source of truth for documents: derived live from disk via the
  // filing service. Replaces the old documents.json index.
  const documentService = new DocumentService({ dataManager, filingServiceWrapper, logger: log });
  log.info('✓ DocumentService initialized (filesystem-backed, no documents.json)');

  // NooblyJS Phase 8: Knowledge on top of the wiki (import with redaction, kept answers and their actions,
  // documents that need review, the process model). It needs the space managers; without them it is off.
  const knowledge = filingServiceWrapper
    ? createKnowledge({
      appBaseDir: dataDirectory,
      spaceManager,
      spaceFilingManager,
      filingServiceWrapper,
      searchIndexer,
      logger: log,
      host: app.get('nooblyHost') || null,
      mountPath: app.get('nooblyMountPath') || '/applications/wiki'
    })
    : null;
  app.set('knowledge', knowledge);

  const routeOptions = { app, authservice };
  const routeServices = {
    dataManager, filing, cache, log, queue, search: searching, aiService, searchIndexer,
    aiservice, // core AI service (Ollama) — used by continuous exploration routes; aiService above is the per-user settings wrapper
    notificationManager,
    filingServiceWrapper, // Add wrapper for filing service access
    documentService,      // Filesystem-backed document index (replaces documents.json)
    treeCache,
    settings,             // Core settings store — backs the wiki feature flags
    knowledge,            // NooblyJS Phase 8 (src/wiki/knowledge): null when the space managers are missing
    appBaseDir
  };

  try {
    startup.trackSync('wiki:routes', () => {
    // Routes() (routes/index.js) is the aggregate registrar — it already mounts
    // spaces, navigation, document, search and user routes, alongside auth,
    // wizard, settings, aiChat, pins, comments, annotations, reviews, likes,
    // changes, continuous explorations, help, headline and whatsNew.
    //
    // Those five used to be registered AGAIN here. Express matches the first
    // handler registered for a path, so the second set was already dead weight
    // for routing — but each module's registration-time side effects ran twice.
    // For searchRoutes that meant kicking off TWO concurrent full index builds
    // at every startup; the duplicate only failed to double the work because
    // SearchIndexer.buildIndex happens to bail on its `isIndexing` guard.
    // Surfaced by the startup profiler as a stray "wiki:search-index#2" task.
    //
    // Only NotificationRoutes and FilingRoutes are NOT part of Routes(), so they
    // are still registered explicitly below.
    Routes(routeOptions, eventEmitter, routeServices);
    NotificationRoutes(routeOptions, eventEmitter, routeServices);

    // Register filing routes with spaceFilingManager from app
    const spaceFilingManager = app.get('spaceFilingManager');
    const spaceManager = app.get('spaceManager');

    if (spaceFilingManager) {
      log.info('[Wiki Init] SpaceFilingManager found on app, registering filing routes');
      FilingRoutes(routeOptions, eventEmitter, {
        ...routeServices,
        spaceFilingManager: spaceFilingManager,
        spaceManager: spaceManager
      });
      log.info('✓ Wiki filing routes registered (space-configured document access)');
    } else {
      log.warn('⚠ SpaceFilingManager not available on app - filing routes disabled');
      log.warn('[Wiki Init] Check if datasources module initialized SpaceFilingManager');
    }
    });

    log.info('✓ All wiki routes registered');
  } catch (error) {
    log.error('✗ Failed to register wiki routes:', error);
    throw error;
  }

  // ========================================================================
  // Serve Wiki Assets
  // ========================================================================

  // Serve wiki JavaScript files without authentication
  app.use('/applications/wiki/js', express.static(path.join(__dirname, './views/js')));

  // Serve wizard page
  app.get('/wizard', (req, res) => {
    res.sendFile(path.join(__dirname, './views/wizard.html'));
  });

  // Serve wizard JavaScript
  app.get('/wizard.js', (req, res) => {
    res.sendFile(path.join(__dirname, './views/js/wizard.js'));
  });

  log.info('✓ Wiki module fully initialized');
};

/**
 * Start background queue worker for processing tasks
 */
function startQueueWorker(services) {
  const { queue, logger, aiService } = services;

  let aiContextGenerationCounter = 0;

  /*
  // Process queue every 5 seconds
  setInterval(async () => {
    try {
      const task = queue.dequeue('tasks');
      if (task && task.type) {
        logger.debug(`Processing task: ${task.type}`);
        await processTask(services, task);
        logger.debug(`Completed task: ${task.type}`);
      }

      // Trigger AI Context generation every 60 seconds (12 iterations * 5 seconds)
      aiContextGenerationCounter++;
      if (aiContextGenerationCounter >= 12) {
        aiContextGenerationCounter = 0;
        try {
          logger.debug('Triggering scheduled AI Context generation');
          await processTask(services, { type: 'generateAIContexts' });
        } catch (error) {
          logger.error('Error in scheduled AI Context generation:', error);
        }
      }
    } catch (error) {
      logger.error('Error processing queue task:', error);
    }
  }, 5000);
  */
}

/**
 * Start AI Context generation scheduler
 */
function startAIContextScheduler(services) {
  const { dataManager, logger, aiService, serviceRegistry } = services;

  // Run immediately on startup
  (async () => {
    try {
      logger.debug('Starting AI Context generation scheduler');
      // Implementation depends on aiService capabilities
    } catch (error) {
      logger.error('Error in AI Context scheduler:', error);
    }
  })();

  // Then run every 60 seconds
  setInterval(async () => {
    try {
      // Implementation depends on aiService capabilities
    } catch (error) {
      logger.error('Error in AI Context scheduler:', error);
    }
  }, 60000);
}
