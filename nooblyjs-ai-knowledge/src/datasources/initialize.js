/**
 * @fileoverview Datasources Module Initializer
 * Sets up workflow automation, data connections, and workflow execution
 * within the unified backend architecture.
 *
 * @author noobly Team
 * @version 2.0.0
 */

'use strict';

const path = require('node:path');
const express = require('express');
const WorkflowBridge = require('./lib/workflowBridge');
const SpaceManager = require('./components/SpaceManager');
const SecurityManager = require('./components/SecurityManager');
const SpaceFilingManager = require('./components/SpaceFilingManager');
const { startup } = require('../shared/startup/startupRunner');

/**
 * Initialize the Datasources module
 * @param {Object} app - Express application instance
 * @param {Object} server - HTTP server instance
 * @param {Object} io - Socket.IO instance
 * @param {Object} eventEmitter - Event emitter for inter-module communication
 * @param {Object} serviceRegistry - noobly Core service registry
 * @param {Object} services - Initialized services (authservice, filing, cache, log, etc.)
 */
module.exports = (app, server, io, eventEmitter, serviceRegistry, services) => {
  const { authservice, filing, cache, log, queue, scheduling, workflow, aiservice, measuring, appBaseDir } = services;

  // ========================================================================
  // Initialize SpaceManager (Synchronously - file loading happens in initialize)
  // ========================================================================

  const spaceManager = new SpaceManager(filing, log, appBaseDir);
  app.set('spaceManager', spaceManager);

  // Initialize SpaceManager (synchronous - loads from file)
  startup.trackSync('datasources:spaces', () => spaceManager.initialize());
  log.info(`✓ SpaceManager initialized with ${spaceManager.spaces.length} spaces`);

  // ========================================================================
  // Initialize SecurityManager
  // ========================================================================

  const securityManager = new SecurityManager(filing, log, appBaseDir);
  app.set('securityManager', securityManager);

  // Initialize SecurityManager - CRITICAL: must complete before route registration
  let securityManagerReady = startup.track('datasources:security', () => securityManager.initialize())
    .then(() => {
      log.info('✓ SecurityManager initialized successfully');
    }).catch((error) => {
      log.error('✗ Failed to initialize SecurityManager:', error.message);
    });

  // ========================================================================
  // Initialize SpaceFilingManager (after SpaceManager is ready)
  // ========================================================================

  const spaceFilingManager = new SpaceFilingManager(spaceManager, filing, log, serviceRegistry, appBaseDir);
  app.set('spaceFilingManager', spaceFilingManager);

  // SpaceManager already initialized synchronously above, so we can initialize SpaceFilingManager
  startup.track('datasources:space-filing', () => spaceFilingManager.initialize())
    .then(() => {
      log.info('✓ SpaceFilingManager initialized successfully');
    }).catch((error) => {
      log.error('✗ Failed to initialize SpaceFilingManager:', error.message);
    });

  // ========================================================================
  // Initialize WorkflowBridge
  // ========================================================================

  const workflowBridge = new WorkflowBridge({
    workflowService: workflow,
    schedulingService: scheduling,
    logger: log,
    eventEmitter: eventEmitter,
    appBaseDir
  });

  app.set('workflowBridge', workflowBridge);

  // ========================================================================
  // Setup Event Broadcasting (EventEmitter → Socket.IO)
  // ========================================================================

  function setupEventBroadcaster() {
    // Core workflow service events
    const coreWorkflowEvents = [
      'workflow:start',
      'workflow:complete',
      'workflow:error',
      'workflow:step:start',
      'workflow:step:end',
      'workflow:step:error',
      'workflow:defined'
    ];

    coreWorkflowEvents.forEach((eventName) => {
      eventEmitter.on(eventName, (eventData) => {
        log.debug(`Broadcasting workflow event: ${eventName}`, {
          workflowName: eventData?.workflowName,
          workflowId: eventData?.workflowId,
          stepName: eventData?.stepName,
          stepNumber: eventData?.stepNumber,
          error: eventData?.error
        });
        io.emit(eventName, eventData);
      });
    });

    // Core scheduling service events
    const coreSchedulerEvents = [
      'scheduler:started',
      'scheduler:stopped',
      'scheduler:taskExecuted'
    ];

    coreSchedulerEvents.forEach((eventName) => {
      eventEmitter.on(eventName, (eventData) => {
        log.info(`Broadcasting scheduler event: ${eventName}`, {
          taskName: eventData?.taskName,
          scriptPath: eventData?.scriptPath,
          status: eventData?.status,
          intervalSeconds: eventData?.intervalSeconds
        });
        io.emit(eventName, eventData);
      });
    });

    // Bridge events from WorkflowBridge (backward compatibility)
    eventEmitter.on('workflow:execution', (eventData) => {
      const eventName = `workflow:execution:${eventData.eventType}`;
      log.debug(`Broadcasting bridge event: ${eventName}`, {
        executionId: eventData?.executionId,
        workflowId: eventData?.workflowId,
        workflowName: eventData?.workflowName,
        stepName: eventData?.stepName,
        error: eventData?.error
      });
      io.emit(eventName, eventData);
    });

    // File system events (for file browser real-time updates)
    const fileEvents = ['file:created', 'file:updated', 'file:deleted', 'folder:created', 'folder:deleted'];

    fileEvents.forEach((eventName) => {
      eventEmitter.on(eventName, (eventData) => {
        log.debug(`Broadcasting file event: ${eventName}`);
        io.emit(eventName, eventData);
      });
    });

    log.info('Event broadcaster initialized - datasources module listening to workflow, scheduler, and file events');
  }

  // ========================================================================
  // Initialize WorkflowBridge (must happen before server starts)
  // ========================================================================

  // NOTE: workflow → Socket.IO broadcasting does not start until this settles,
  // so its duration is the window in which workflow events are dropped.
  startup.track('datasources:workflow-bridge', async () => {
    try {
      await workflowBridge.initialize();
      log.info('✓ WorkflowBridge initialized successfully');
      setupEventBroadcaster();

      // Start the file-based bridge server so workflow STEPS (which run in
      // isolated worker threads) can invoke live-bridge operations — creating a
      // schedule, listing schedules — WITHOUT calling the backend's own HTTP API.
      // In production that self-call hits HTTPS + Entra on :443 and fails; this
      // exchanges request/response files under <appBaseDir>/workflow/.bridge/
      // instead. Steps use common/bridge/workflowBridgeClient.js in the sibling
      // workflows repo.
      const WorkflowBridgeServer = require('./lib/workflowBridgeServer');
      const workflowBridgeServer = new WorkflowBridgeServer({
        bridge: workflowBridge,
        appBaseDir,
        logger: log
      });
      await workflowBridgeServer.start();
      app.set('workflowBridgeServer', workflowBridgeServer);
      log.info('✓ WorkflowBridgeServer (file IPC) started');
    } catch (error) {
      log.error('✗ Failed to initialize WorkflowBridge:', error);
      throw error;
    }
  });

  // ========================================================================
  // Initialize AI Service Instances (from the Agents configuration)
  // ========================================================================

  const { initializeAIInstances } = require('./lib/aiInstances');

  startup.track('datasources:ai-instances', async () => {
    try {
      await initializeAIInstances({ serviceRegistry, app, log, appBaseDir });
    } catch (error) {
      log.error('✗ Failed to initialize AI instances:', error.message);
    }
  });

  // ========================================================================
  // Setup Role Validation Middleware
  // ========================================================================

  const RoleValidationMiddleware = require('./middleware/roleValidationMiddleware');
  // Hosted in NooblyJS the screens are open to everyone signed in (src/hosted/platform.cjs); standalone keeps the role.
  const roleValidator = new RoleValidationMiddleware(log, { anySignedIn: app.get('datasourcesOpenToSignedIn') === true });

  // Apply role validation to all /applications/datasources frontend routes
  app.use('/applications/datasources', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });

  // Apply role validation to all /api/ routes for datasources APIs
  app.use('/api/workflows', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/spaces', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/connections', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/settings', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/agents', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/prompts', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/repositories', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  // Usage reporting reads one person's reading history, so it is admin-only for
  // the same reason the Spaces and Security screens are.
  app.use('/api/user-activity', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });

  // These prefixes back the SAME datasources admin UI (served from the
  // admin-gated /applications/datasources) but were not covered by a mount-level
  // guard, leaving their handlers reachable anonymously — a broken-access-control
  // gap flagged by static analysis. Several are mutating (execution run-now and
  // history deletion, schedule create/update, content-file writes), so gating
  // them here closes the hole for every current and future route under the
  // prefix in one place, rather than relying on each handler to remember.
  //
  // Note: these are the DATASOURCES prefixes. The wiki module's own
  // notifications/content live under /applications/wiki/api/* and are guarded
  // separately by wiki/initialize.js, so this does not affect wiki users.
  app.use('/api/executions', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/content', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/diff', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/sources', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/notifications', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  // Scheduling (create/update/delete/toggle/run-now), the AI connection test,
  // and the metrics/debug read-outs are all datasources-admin screens too.
  app.use('/api/schedules', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/metrics', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/ai', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });
  app.use('/api/debug', (req, res, next) => {
    roleValidator.requireDataSourcesAdmin(req, res, next);
  });

  // ========================================================================
  // Register Routes (register immediately since spaces load synchronously)
  // ========================================================================

  try {
    startup.trackSync('datasources:routes', () => {
      // Import and register datasources routes
      const contentRoutes = require('./routes/contentRoutes');
      const dashboardRoutes = require('./routes/dashboardRoutes');
      const workflowRoutes = require('./routes/workflowdashboard');
      const workflowApiRoutes = require('./routes/workflowApiRoutes');
      const spacesRoutes = require('./routes/spacesRoutes');
      const securityRoutes = require('./routes/securityRoutes');
      const spaceFilingRoutes = require('./routes/spaceFilingRoutes');
      const repositoriesRoutes = require('./routes/repositoriesRoutes');
      const promptRoutes = require('./routes/promptRoutes');
      const userActivityRoutes = require('./routes/userActivityRoutes');

      // Register routes using the service registry pattern. serviceRegistry is
      // included so repositories routes can resolve live git filers by instance.
      const routeDependencies = { ...services, appBaseDir, serviceRegistry };

      contentRoutes('datasources-content', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      dashboardRoutes('datasources-dashboard', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      workflowRoutes('datasources-workflows', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      workflowApiRoutes('datasources-workflow-api', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      // Register spaces routes with proper parameters
      spacesRoutes('datasources-spaces', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      // Register security routes (now safe - SecurityManager is initialized)
      securityRoutes('datasources-security', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      // Register space filing routes
      spaceFilingRoutes('datasources-space-filing', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      // Register repositories routes (git filer list + per-filer analytics)
      repositoriesRoutes('datasources-repositories', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      // Register prompt library routes (CRUD + test bench over the prompt store)
      promptRoutes('datasources-prompts', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);

      // Register user activity routes (backoffice usage reporting)
      userActivityRoutes('datasources-user-activity', {
        'express-app': app,
        dependencies: routeDependencies
      }, eventEmitter);
    });

    log.info('✓ Datasources routes initialized (including spaces, security, space filing, repositories, prompts, and user activity)');
  } catch (error) {
    log.error('✗ Failed to register datasources routes:', error.message);
    log.error('Stack:', error.stack);
    throw error;
  }

  log.info('✓ Datasources module fully initialized');
};
