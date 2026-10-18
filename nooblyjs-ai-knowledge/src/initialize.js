/**
 * @fileoverview Backend module wiring (datasources + wiki, which includes the
 * continuous exploration feature).
 *
 * This is NOT an entry point. The composition root (../app.js) creates the
 * Express app, HTTP server, Socket.IO, the digital-technologies-core service
 * registry and the core services, then calls initialize(context) here to attach
 * the API modules and health endpoints onto the passed app. This module binds no
 * port and owns no server lifecycle.
 *
 * @author noobly Team
 * @version 2.0.0
 */

'use strict';

const { startup } = require('./shared/startup/startupRunner');

/**
 * Attach the backend API modules to the host Express app.
 *
 * @param {object}  context
 * @param {import('express').Express} context.app
 * @param {import('http').Server|import('https').Server} context.server
 * @param {import('socket.io').Server} context.io
 * @param {import('events').EventEmitter} context.eventEmitter
 * @param {object}  context.serviceRegistry        digital-technologies-core
 * @param {string}  context.appBaseDir
 * @param {object}  context.services               core services (see below)
 * @returns {Promise<void>}
 */
async function initialize(context) {
  const { app, server, io, eventEmitter, serviceRegistry, appBaseDir, services } = context;
  const {
    authservice, filing, cache, log, queue, scheduling,
    workflow, aiservice, measuring, searching, notifying, settings
  } = services;

  // External search backends (e.g. SOLR) need a reachable collection before any
  // module starts indexing. The embedded 'tokens' provider has no
  // ensureCollection(), so this is a no-op for it.
  if (typeof searching.ensureCollection === 'function') {
    try {
      await startup.track('search:ensure-collection', () => searching.ensureCollection());
      const { SOLR_COLLECTION } = await searching.getSettings();
      log.info(`✓ SOLR collection "${SOLR_COLLECTION}" ready`);
    } catch (error) {
      log.error(`✗ SOLR collection not ready — is SOLR running and the core created? ${error.message}`);
      throw error;
    }
  }

  log.info('='.repeat(70));
  log.info('noobly Wiki Unified Backend - Initializing Modules');
  log.info('='.repeat(70));

  // Datasources Module (Workflow Automation)
  try {
    const initializeDatasources = require('./datasources/initialize');
    startup.trackSync('datasources:module', () => {
      initializeDatasources(app, server, io, eventEmitter, serviceRegistry, {
        authservice, filing, cache, log, queue, scheduling, workflow, aiservice, measuring,
        appBaseDir
      });
    });
    log.info('✓ Datasources module initialized');
  } catch (error) {
    log.error(`✗ Failed to initialize datasources module: ${error.message}`);
    throw error;
  }

  // Wiki Module (Knowledge Management)
  try {
    const initializeWiki = require('./wiki/initialize');
    startup.trackSync('wiki:module', () => {
      initializeWiki(app, server, io, eventEmitter, serviceRegistry, {
        authservice, filing, cache, log, queue, searching, aiservice, notifying,
        settings, // core settings store — backs the wiki feature flags
        appBaseDir
      });
    });
    log.info('✓ Wiki module initialized');
  } catch (error) {
    log.error(`✗ Failed to initialize wiki module: ${error.message}`);
    throw error;
  }

  // Git Repositories bootstrap — read .application/spaces/repositories.json and
  // register a monitored git filing service per enabled entry (clone-if-missing,
  // periodic fetch/commit-push). Registration is synchronous; clones run in the
  // background so a slow clone can't delay the server binding its port. Failures
  // are logged per-repository and never abort startup.
  try {
    const { initializeRepositories } = require('./shared/repositories/repositoryManager');
    // Only the registration is awaited here; each clone runs on in the
    // background and is timed separately as repositories:clone:<name>.
    await startup.track('repositories:register', () =>
      initializeRepositories({ serviceRegistry, appBaseDir, log, eventEmitter }));
  } catch (error) {
    log.error('✗ Failed to bootstrap git repositories:', error.message);
  }

  // Health check endpoints for monitoring.
  app.get('/api/health', (req, res) => {
    const datasourcesReady = !!app.get('spaceManager');
    const wikiReady = !!app.get('wikiDataManager') || !!global.eventBus;
    const continuousExplorationReady = !!app.get('continuousExplorationProjectManager');

    res.json({
      status: datasourcesReady && wikiReady ? 'ok' : 'degraded',
      version: '2.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      modules: { datasources: datasourcesReady, wiki: wikiReady, continuousExploration: continuousExplorationReady },
      // Background startup work. NOTE: `status` above deliberately still ignores
      // this — the profiler is instrumentation only and must not change what
      // orchestrators see. Full table at GET /api/startup.
      startup: startup.counts()
    });
  });

  // Startup profile — which initializer ran, when, for how long, and whether it
  // failed. Authenticated: task errors can carry filesystem paths.
  app.get('/api/startup', (req, res) => {
    if (!(req.isAuthenticated && req.isAuthenticated())) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    res.json({ success: true, data: startup.report() });
  });

  app.get('/applications/wiki/api/health', (req, res) => {
    const wikiReady = !!app.get('wikiDataManager') || !!global.eventBus;

    res.json({
      status: wikiReady ? 'ok' : 'initializing',
      version: '2.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      module: 'wiki',
      components: {
        eventBus: !!global.eventBus,
        searchIndexer: !!global.searchIndexer,
        io: !!global.io
      }
    });
  });

  log.info('✓ Backend modules initialized');
}

module.exports = { initialize };
