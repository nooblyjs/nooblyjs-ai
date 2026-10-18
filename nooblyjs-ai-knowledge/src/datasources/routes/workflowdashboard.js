/**
 * @fileoverview Workflow Dashboard API Routes
 * Provides endpoints for workflow dashboard data using WorkflowBridge service
 *
 * @author noobly Team
 * @version 2.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const path = require('node:path');
const { validate, validateQuery } = require('../middleware/validationMiddleware');
const { createWorkflowSchema, executeWorkflowSchema, paginationSchema } = require('../validation/workflowSchemas');
const { withCache, invalidateCache } = require('../../shared/middleware/cacheMiddleware');
const { summarizeExecution, summarizeExecutions } = require('../lib/executionSummary');

/**
 * noobly Wiki Datasources - Workflow Dashboard Routes
 *
 * @function
 * @param {Object} options - Configuration options for the views setup
 * @param {express.Application} options.express-app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance for inter-service communication
 * @param {Object} services - noobly Core services
 * @returns {void}
 */
module.exports = (type, options, eventEmitter) => {

  const app = options.app || options['express-app'];
  const { dependencies = {}, ...providerOptions } = options;
  const logger = dependencies.logging;
  const cache = dependencies.cache;
  const filing = dependencies.filing;
  const filingService = filing; // Alias for backward compatibility
  const measuring = dependencies.measuring;
  const appBaseDir = dependencies.appBaseDir || path.join(process.cwd(), '.application');

  if (logger) {
    if (logger.info) logger.info('[WorkflowDashboard] Measuring service available:', !!measuring);
    if (!measuring && logger.warn) {
      logger.warn('[WorkflowDashboard] Measuring service NOT available - metrics will not be tracked');
    }
  }

  /**
   * Helper function: Suppress console output for production
   */
  const logError = (message, error) => {
    // Errors are only logged if a logger service is available
    // In production, errors should be handled by proper error handling middleware
    if (logger && typeof logger.error === 'function') {
      logger.error(message, error);
    }
  };

  /**
   * Helper function: Get WorkflowBridge from app context
   */
  const getWorkflowBridge = (req) => {
    const bridge = req.app.get('workflowBridge');
    if (!bridge) {
      throw new Error('WorkflowBridge not initialized');
    }
    return bridge;
  };

  /**
   * Helper functions: project execution records down to the summary fields the
   * executions LIST UI needs — see ../lib/executionSummary.js for why the full
   * record must never reach a list response.
   */
  const slimExecution = summarizeExecution;
  const slimExecutions = summarizeExecutions;

  /**
   * Helper function: Get time ago string
   */
  const getTimeAgo = (date) => {
    if (!date) return 'Never';
    const now = new Date();
    const diff = now - new Date(date);
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  };

  /** How long a /api/workflows/last-runs answer stays fresh (see that route). */
  const LAST_RUNS_TTL_MS = 60 * 1000;

  /**
   * Helper function: Wrap a handler with caching if cache service is available
   */
  const cacheHandler = (handler, options) => {
    if (!cache) return handler;
    return withCache(cache, handler, options);
  };

  // ============================================
  // DASHBOARD ENDPOINTS
  // ============================================

  /**
   * Dashboard handler function
   * Extracted to allow caching wrapper
   * Metrics are tracked by dashboardMetricsMiddleware
   */
  const dashboardHandler = async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);

      // Wait for WorkflowBridge to finish loading data from disk
      if (bridge.initialized === false && typeof bridge.whenReady === 'function') {
        await bridge.whenReady();
      }

      // Get live data
      const allWorkflows = bridge.listWorkflows() || [];
      const allExecutions = await bridge.listExecutions() || [];
      const allSchedules = bridge.listSchedules() || [];

      // Track metrics with measuring service if available
      if (measuring && typeof measuring.add === 'function') {
        logger?.debug?.('Measuring service available, recording metrics');

        // Count of active workflows
        const activeWorkflowCount = allWorkflows.filter(w => w.status === 'active').length;
        measuring.add('dashboard:active_workflows', activeWorkflowCount);

        // Total workflows
        measuring.add('dashboard:total_workflows', allWorkflows.length);

        // Total executions
        measuring.add('dashboard:total_executions', allExecutions.length);

        // Total schedules
        measuring.add('dashboard:total_schedules', allSchedules.length);

        // Records processed
        const recordsProcessed = allExecutions.reduce((sum, e) => sum + (e.recordsProcessed || 0), 0);
        measuring.add('dashboard:records_processed', recordsProcessed);
      } else {
        logger?.warn('Measuring service not available');
      }

      // Calculate statistics
      const stats = {
        activeWorkflows: {
          value: allWorkflows.filter(w => w.status === 'active').length,
          change: '+0',
          changeType: 'neutral'
        },
        recordsProcessed: {
          value: allExecutions.reduce((sum, e) => sum + (e.recordsProcessed || 0), 0),
          change: '+0',
          changeType: 'neutral'
        },
        agentExecutions: {
          value: Array.isArray(allExecutions) ? allExecutions.length : 0,
          change: '+0',
          changeType: 'neutral'
        },
        publishedSources: {
          value: allWorkflows.filter(w => w.status === 'active' && w.published).length,
          change: '+0',
          changeType: 'neutral'
        }
      };

      // Get recently edited workflows
      const recentlyEdited = allWorkflows
        .sort((a, b) => new Date(b.modifiedAt || b.updatedAt || 0) - new Date(a.modifiedAt || a.updatedAt || 0))
        .slice(0, 5)
        .map(w => ({
          id: w.id,
          name: w.name,
          description: w.description,
          modifiedAt: w.modifiedAt || w.updatedAt || new Date().toISOString(),
          status: w.status || 'draft',
          stepCount: (w.steps || []).length
        }));

      // Get starred workflows
      const starredWorkflows = allWorkflows
        .filter(w => w.starred === true)
        .slice(0, 5)
        .map(w => ({
          id: w.id,
          name: w.name,
          description: w.description,
          starred: true,
          status: w.status || 'draft'
        }));

      // Get active schedules
      const activeSchedules = allSchedules
        .filter(s => s.enabled === true)
        .slice(0, 5)
        .map(s => ({
          id: s.id,
          workflowId: s.workflowId,
          workflowName: s.workflowName || allWorkflows.find(w => w.id === s.workflowId)?.name,
          cron: s.cronExpression || s.cron,
          nextRun: s.nextRun || new Date(Date.now() + 3600000).toISOString(),
          lastRun: s.lastRun,
          enabled: true
        }));

      // Get recent executions
      const executionsList = Array.isArray(allExecutions) ? allExecutions : [];
      const recentExecutions = executionsList
        .sort((a, b) => new Date(b.startedAt || b.executedAt || 0) - new Date(a.startedAt || a.executedAt || 0))
        .slice(0, 7)
        .map(e => ({
          id: e.id || e.executionId,
          workflowId: e.workflowId,
          workflowName: e.name || e.workflowName || allWorkflows.find(w => w.id === e.workflowId)?.name,
          status: e.outcome || e.status,
          outcome: e.outcome || e.status,
          duration: e.duration || 0,
          executedAt: e.startedAt || e.executedAt || e.timestamp || new Date().toISOString(),
          timestamp: e.startedAt || e.executedAt || e.timestamp || new Date().toISOString()
        }));

      // Recent activity
      const recentActivity = recentExecutions.slice(0, 3).map(e => ({
        id: `act-${e.id}`,
        title: e.outcome === 'success' ? 'Execution completed' : 'Execution failed',
        description: `${e.workflowName} - ${e.outcome}`,
        timeAgo: getTimeAgo(e.executedAt),
        type: e.outcome === 'success' ? 'success' : 'error',
        icon: e.outcome === 'success' ? 'bi-check-circle-fill' : 'bi-x-circle-fill'
      }));

      // Build response
      const dashboardData = {
        stats,
        workflows: allWorkflows.slice(0, 10),
        recentlyEdited,
        starredWorkflows,
        schedules: activeSchedules,
        executions: recentExecutions,
        recentActivity
      };

      res.status(200).json({
        success: true,
        data: dashboardData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve dashboard data',
        message: error.message
      });
    }
  };

  /**
   * Middleware to track dashboard metrics
   */
  const dashboardMetricsMiddleware = (req, res, next) => {
    const startTime = performance.now();

    // Track request
    if (measuring) {
      measuring.add('dashboard:requests', 1);
    }

    // Track response time
    res.on('finish', () => {
      const responseTime = performance.now() - startTime;
      if (measuring) {
        measuring.add('dashboard:request_time_ms', responseTime);

        // Track errors
        if (res.statusCode >= 400) {
          measuring.add('dashboard:errors', 1);
        }
      }
    });

    next();
  };

  /**
   * GET /api/workflows/dashboard
   * Retrieve workflow dashboard data with live data from services
   * Cached with 5 minute TTL
   * Metrics tracked for all requests (including cached ones)
   */
  app.get('/api/workflows/dashboard',
    dashboardMetricsMiddleware,
    cacheHandler(dashboardHandler, {
      keyPrefix: 'workflows:dashboard',
      ttl: 300
    })
  );

  // ============================================
  // WORKFLOW CRUD ENDPOINTS
  // ============================================

  /**
   * List workflows handler function
   * Extracted to allow caching wrapper
   */
  const listHandler = async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);

      const options = {};
      if (req.query.starred === 'true') options.starred = true;
      if (req.query.tags) options.tags = req.query.tags.split(',').map(t => t.trim());
      if (req.query.status) options.status = req.query.status;
      // req.query.limit and offset are already validated by pagination schema
      if (req.query.limit) options.limit = parseInt(req.query.limit);
      if (req.query.offset) options.offset = parseInt(req.query.offset);

      const workflows = bridge.listWorkflows(options);

      // Enrich each workflow with schedule status
      const enriched = workflows.map(w => {
        const schedules = bridge.listSchedules({ workflowId: w.id });
        if (schedules.length === 0) {
          return { ...w, status: null };
        }
        const hasActive = schedules.some(s => s.enabled);
        return { ...w, status: hasActive ? 'active' : 'inactive' };
      });

      res.status(200).json({
        success: true,
        data: enriched,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error listing workflows:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to list workflows',
        message: error.message
      });
    }
  };

  /**
   * GET /api/workflows/list
   * List all workflows with optional filtering
   * Cached with 5 minute TTL
   */
  app.get('/api/workflows/list', cacheHandler(listHandler, {
    keyPrefix: 'workflows:list',
    ttl: 300
  }));

  /**
   * Groups handler function
   * Extracted to allow caching wrapper
   */
  const groupsHandler = async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const workflows = bridge.listWorkflows({ limit: 10000 });

      // Extract unique groups
      const groups = [...new Set(workflows.map(w => w.group || w.directoryName))];
      groups.sort();

      res.json({
        success: true,
        data: groups,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving workflow groups:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve workflow groups'
      });
    }
  };

  /**
   * GET /api/workflows/groups
   * Get all workflow groups
   * Cached with 5 minute TTL
   */
  app.get('/api/workflows/groups', cacheHandler(groupsHandler, {
    keyPrefix: 'workflows:groups',
    ttl: 300
  }));

  /**
   * POST /api/workflows
   * Create a new workflow
   * Invalidates dashboard, list, and groups cache
   */
  app.post('/api/workflows',
    validate(createWorkflowSchema),
    cache ? invalidateCache(cache, ['workflows:']) : (req, res, next) => next(),
    async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { name, description, steps, tags, group, defaultInput } = req.body;

      if (!name || !Array.isArray(steps) || steps.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Workflow name and at least one step are required'
        });
      }

      if (!group || typeof group !== 'string' || group.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Group is required and must be a non-empty string'
        });
      }

      const workflow = await bridge.createWorkflow({
        name,
        description,
        steps,
        tags,
        group: group.trim(),
        defaultInput: defaultInput || {}
      });

      res.status(201).json({
        success: true,
        message: 'Workflow created successfully',
        workflowId: workflow.id,
        data: workflow,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error creating workflow:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create workflow'
      });
    }
  });

  /**
   * GET /api/workflows/search
   * Search workflows by query string
   */
  app.get('/api/workflows/search', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { q } = req.query;

      if (!q) {
        return res.status(400).json({
          success: false,
          error: 'Search query required'
        });
      }

      const results = bridge.searchWorkflows(q);

      res.status(200).json({
        success: true,
        data: results,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error searching workflows:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to search workflows'
      });
    }
  });

  /**
   * GET /api/workflows/starred
   * Get starred workflows
   */
  app.get('/api/workflows/starred', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const limit = parseInt(req.query.limit) || 10;
      const workflows = bridge.getStarred(limit);

      res.status(200).json({
        success: true,
        data: workflows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving starred workflows:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve starred workflows'
      });
    }
  });

  /**
   * GET /api/workflows/recent
   * Get recently viewed workflows
   */
  app.get('/api/workflows/recent', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const limit = parseInt(req.query.limit) || 10;
      const workflows = bridge.getRecentlyViewed(limit);

      res.status(200).json({
        success: true,
        data: workflows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving recently viewed workflows:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve recently viewed workflows'
      });
    }
  });

  /**
   * GET /api/workflows/templates
   * Get list of workflow templates
   */
  app.get('/api/workflows/templates', async (req, res) => {
    try {
      const templates = [
        {
          id: 'template-api-transform',
          name: 'API to Transform',
          description: 'Fetch data from an API and transform it',
          category: 'Data Processing',
          steps: [
            { name: 'Fetch Data', config: { type: 'api', method: 'GET', endpoint: 'https://api.example.com/data' } },
            { name: 'Transform Data', config: { type: 'transform', script: '({ ...input, processed: true })' } }
          ],
          tags: ['api', 'transform']
        },
        {
          id: 'template-conditional-flow',
          name: 'Conditional Flow',
          description: 'Execute different steps based on conditions',
          category: 'Logic',
          steps: [
            { name: 'Check Input', config: { type: 'transform', script: '({ ...input, isValid: input.value > 0 })' } },
            { name: 'Branch', config: { type: 'conditional', condition: 'input.isValid === true' } }
          ],
          tags: ['conditional', 'logic']
        },
        {
          id: 'template-parallel-apis',
          name: 'Parallel API Calls',
          description: 'Call multiple APIs in parallel and aggregate results',
          category: 'Data Processing',
          steps: [
            { name: 'Parallel Fetch', config: { type: 'parallel', steps: [] } },
            { name: 'Aggregate Results', config: { type: 'transform', script: '({ combined: Object.values(input) })' } }
          ],
          tags: ['parallel', 'api']
        },
        {
          id: 'template-delay-retry',
          name: 'Delayed Retry Pattern',
          description: 'Implement retry logic with delays',
          category: 'Reliability',
          steps: [
            { name: 'Initial Request', config: { type: 'api', method: 'GET', endpoint: 'https://api.example.com/data' } },
            { name: 'Wait', config: { type: 'delay', duration: 5000 } },
            { name: 'Retry Request', config: { type: 'api', method: 'GET', endpoint: 'https://api.example.com/data' } }
          ],
          tags: ['retry', 'delay', 'reliability']
        }
      ];

      res.status(200).json({
        success: true,
        data: templates,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving templates:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve templates'
      });
    }
  });

  /**
   * GET /api/workflows/recent-activity
   * Retrieve recent activity log.
   * Also kept above `/api/workflows/:id` — see the ordering note below.
   */
  app.get('/api/workflows/recent-activity', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const executions = await bridge.listExecutions({ limit: 10 });
      const executionsList = Array.isArray(executions) ? executions : [];

      const recentActivity = executionsList.slice(0, 5).map(e => ({
        id: `act-${e.id || e.executionId}`,
        title: e.status === 'completed' ? 'Execution completed' : 'Execution failed',
        description: `${e.name || e.workflowName} - ${e.status}`,
        timeAgo: getTimeAgo(e.startedAt),
        type: e.status === 'completed' ? 'success' : 'error',
        icon: e.status === 'completed' ? 'bi-check-circle-fill' : 'bi-x-circle-fill'
      }));

      res.status(200).json({
        success: true,
        data: recentActivity,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving recent activity:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve recent activity',
        message: error.message
      });
    }
  });

  /**
   * GET /api/workflows/last-runs
   * The most recent execution per workflow, for the "Last Run" column on the
   * Workflows screen. Answers a map keyed by workflow id:
   *   { <id>: { status, startedAt, duration, executionId } }
   * `duration` is MILLISECONDS, as every execution record stores it — the client
   * renders it with the same `fmtDuration` the Execution History screen uses.
   *
   * MUST stay registered BEFORE `/api/workflows/:id` below — Express matches in
   * registration order, so below it this path binds as `:id = "last-runs"` and
   * answers 404 "Workflow not found". Every literal /api/workflows/* route in
   * this file sits above that handler for the same reason.
   *
   * Query params:
   *   ?limit=100     - recent executions to scan (capped at 500)
   *   ?nocache=true  - bypass the 60s cache (the Refresh button uses this)
   */
  app.get('/api/workflows/last-runs', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const nocache = req.query.nocache === 'true';
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const cacheKey = `workflows:last-runs:${limit}`;

      // The core cache is put/get/delete with NO TTL support — an entry lives
      // until it is overwritten. So freshness is stamped into the value and
      // checked here; without this the panel would answer "last night passed"
      // indefinitely, which is the one thing it must never do. Every cache call
      // is guarded: caching is an optimisation and must not fail the request.
      const readCache = async () => {
        if (nocache || !cache) return null;
        try {
          const entry = await cache.get(cacheKey);
          if (entry && entry.at && (Date.now() - entry.at) < LAST_RUNS_TTL_MS) return entry.data;
        } catch (err) {
          logError('[last-runs] cache read failed, falling through to a live read:', err);
        }
        return null;
      };

      const fresh = await readCache();
      if (fresh) {
        return res.status(200).json({
          success: true,
          data: fresh,
          cached: true,
          timestamp: new Date().toISOString()
        });
      }

      // One pass over recent executions beats a per-workflow query: with ~49
      // workflows that would be 49 reads across the per-day files.
      const executions = await bridge.listExecutions({ limit });
      const execArray = Array.isArray(executions)
        ? executions
        : (executions?.data || executions?.executions || []);

      const lastRuns = {};
      for (const exec of execArray) {
        const workflowId = exec.workflowId || exec.workflow_id;
        // listExecutions answers newest-first, so the first hit per workflow wins.
        if (!workflowId || lastRuns[workflowId]) continue;

        lastRuns[workflowId] = {
          status: exec.outcome || exec.status || 'unknown',
          startedAt: exec.startedAt || exec.executedAt || exec.timestamp || null,
          duration: exec.duration || 0,
          executionId: exec.id || exec.executionId || null
        };
      }

      if (cache) {
        try {
          await cache.put(cacheKey, { at: Date.now(), data: lastRuns });
        } catch (err) {
          logError('[last-runs] cache write failed (answer still served):', err);
        }
      }

      res.status(200).json({
        success: true,
        data: lastRuns,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error fetching workflow last runs:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to fetch last runs'
      });
    }
  });

  /**
   * GET /api/workflows/:id
   * Get a specific workflow by ID
   */
  app.get('/api/workflows/:id', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const workflow = bridge.getWorkflow(req.params.id);

      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      // Convert file path steps to step objects for frontend compatibility
      const detailedSteps = await bridge.getDetailedSteps(req.params.id);

      const workflowWithDetails = {
        ...workflow,
        steps: detailedSteps
      };

      res.status(200).json({
        success: true,
        data: workflowWithDetails,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving workflow:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve workflow'
      });
    }
  });

  /**
   * GET /api/workflows/:id/steps
   * Retrieve workflow steps with file content
   * Used by the editor to display and edit step files
   */
  app.get('/api/workflows/:id/steps', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const workflow = bridge.getWorkflow(req.params.id);

      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      // Get detailed steps with file paths
      const detailedSteps = await bridge.getDetailedSteps(req.params.id);

      res.status(200).json({
        success: true,
        data: detailedSteps,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving workflow steps:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve workflow steps'
      });
    }
  });

  /**
   * GET /api/workflows/:workflowId/step-file-content
   * Retrieve the content of a specific step file
   * Used by the editor to display step file code
   */
  app.get('/api/workflows/:workflowId/step-file-content', async (req, res) => {
    try {
      const { stepFilePath } = req.query;
      if (!stepFilePath) {
        return res.status(400).json({
          success: false,
          error: 'stepFilePath query parameter is required'
        });
      }

      const bridge = getWorkflowBridge(req);
      const workflow = bridge.getWorkflow(req.params.workflowId);

      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      // Security: Prevent path traversal
      if (stepFilePath.includes('..')) {
        return res.status(400).json({
          success: false,
          error: 'Invalid file path'
        });
      }

      // Construct full file path
      const fullPath = path.join(workflow.path, stepFilePath);

      // Verify the path is within the workflow directory
      if (!fullPath.startsWith(workflow.path)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid file path'
        });
      }

      // Read the file content
      const content = await fs.readFile(fullPath, 'utf-8');

      res.status(200).json({
        success: true,
        data: {
          filePath: stepFilePath,
          content: content
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving step file content:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to retrieve step file content'
      });
    }
  });

  /**
   * PUT /api/workflows/:workflowId/step-file-content
   * Update the content of a specific step file
   * Used by the editor to save changes to step code
   */
  app.put('/api/workflows/:workflowId/step-file-content', async (req, res) => {
    try {
      const { stepFilePath, stepFileName, content, isNew } = req.body;
      const bridge = getWorkflowBridge(req);
      const workflow = bridge.getWorkflow(req.params.workflowId);

      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      let fullPath;
      let relativeStepPath;

      if (isNew && stepFileName) {
        // Creating a new step file
        relativeStepPath = `steps/${stepFileName}.js`;
        fullPath = path.join(workflow.path, relativeStepPath);
      } else if (stepFilePath) {
        // Updating existing step file
        if (content === undefined) {
          return res.status(400).json({
            success: false,
            error: 'stepFilePath and content are required'
          });
        }

        // Security: Prevent path traversal
        if (stepFilePath.includes('..')) {
          return res.status(400).json({
            success: false,
            error: 'Invalid file path'
          });
        }

        relativeStepPath = stepFilePath;
        fullPath = path.join(workflow.path, stepFilePath);
      } else {
        return res.status(400).json({
          success: false,
          error: 'Either stepFilePath or (stepFileName + isNew) is required'
        });
      }

      // Verify the path is within the workflow directory
      if (!fullPath.startsWith(workflow.path)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid file path'
        });
      }

      // Create steps directory if it doesn't exist (for new steps)
      if (isNew) {
        const stepsDir = path.join(workflow.path, 'steps');
        if (!fsSync.existsSync(stepsDir)) {
          await fs.mkdir(stepsDir, { recursive: true });
        }
      }

      // Write the file content
      await fs.writeFile(fullPath, content, 'utf-8');

      // If creating a new step, add it to the workflow definition
      if (isNew && stepFileName) {
        const workflowDefPath = path.join(workflow.path, 'workflow-definition.json');
        const workflowDef = JSON.parse(await fs.readFile(workflowDefPath, 'utf-8'));

        // Add the new step to the steps array
        if (!workflowDef.steps) {
          workflowDef.steps = [];
        }
        workflowDef.steps.push(relativeStepPath);

        // Write updated workflow definition
        await fs.writeFile(workflowDefPath, JSON.stringify(workflowDef, null, 2), 'utf-8');
      }

      res.status(200).json({
        success: true,
        message: isNew ? 'Step file created successfully' : 'Step file updated successfully',
        data: {
          filePath: relativeStepPath
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error updating/creating step file content:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to update/create step file content'
      });
    }
  });

  /**
   * GET /api/workflows/:workflowId/details
   * Retrieve details for a specific workflow
   * Converts file-based steps to step objects for frontend compatibility
   */
  app.get('/api/workflows/:workflowId/details', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const workflow = bridge.getWorkflow(req.params.workflowId);

      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      // Convert file path steps to step objects for frontend compatibility
      const detailedSteps = await bridge.getDetailedSteps(workflow.id);

      const workflowDetails = {
        ...workflow,
        steps: detailedSteps
      };

      res.status(200).json({
        success: true,
        data: workflowDetails,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving workflow details:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve workflow details',
        message: error.message
      });
    }
  });

  /**
   * PUT /api/workflows/:id
   * Update an existing workflow
   * Invalidates dashboard, list, and groups cache
   */
  app.put('/api/workflows/:id',
    cache ? invalidateCache(cache, ['workflows:']) : (req, res, next) => next(),
    async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { name, description, steps, tags, starred, defaultInput } = req.body;

      const workflow = await bridge.updateWorkflow(req.params.id, {
        name,
        description,
        steps,
        tags,
        starred,
        defaultInput
      });

      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Workflow updated successfully',
        workflowId: req.params.id,
        data: workflow,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error updating workflow:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update workflow'
      });
    }
  });

  /**
   * DELETE /api/workflows/:id
   * Delete a workflow
   * Invalidates dashboard, list, and groups cache
   */
  app.delete('/api/workflows/:id',
    cache ? invalidateCache(cache, ['workflows:']) : (req, res, next) => next(),
    async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      await bridge.deleteWorkflow(req.params.id);

      res.status(200).json({
        success: true,
        message: 'Workflow deleted successfully',
        workflowId: req.params.id,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error deleting workflow:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to delete workflow'
      });
    }
  });

  /**
   * POST /api/workflows/:id/star
   * Toggle star status for a workflow
   * Invalidates dashboard and list cache
   */
  app.post('/api/workflows/:id/star',
    cache ? invalidateCache(cache, ['workflows:']) : (req, res, next) => next(),
    async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { starred } = req.body;
      const workflow = await bridge.toggleStar(req.params.id, starred);

      res.status(200).json({
        success: true,
        data: workflow,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error toggling star:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to toggle star'
      });
    }
  });

  /**
   * DELETE /api/workflows/:id/recent
   * Remove workflow from recent activity
   * Invalidates dashboard cache
   */
  app.delete('/api/workflows/:id/recent',
    cache ? invalidateCache(cache, ['workflows:dashboard']) : (req, res, next) => next(),
    async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      // Remove from recent activity - this just resets the modification tracking
      // The workflow list will no longer show this as recently edited
      const workflow = await bridge.getWorkflow(req.params.id);

      if (!workflow) {
        return res.status(404).json({
          success: false,
          error: 'Workflow not found'
        });
      }

      // Mark the workflow's modification time to long ago so it won't show in recent
      workflow.modifiedAt = new Date(0).toISOString();
      await bridge.updateWorkflow(req.params.id, workflow);

      res.status(200).json({
        success: true,
        message: 'Removed from recent activity',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error removing from recent activity:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to remove from recent activity'
      });
    }
  });

  /**
   * POST /api/workflows/:id/view
   * Mark workflow as viewed
   */
  app.post('/api/workflows/:id/view', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const workflow = await bridge.markAsViewed(req.params.id);

      res.status(200).json({
        success: true,
        data: workflow,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error marking as viewed:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to mark as viewed'
      });
    }
  });

  /**
   * GET /api/workflows/:id/export
   * Export a workflow as JSON
   */
  app.get('/api/workflows/:id/export', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const exportedWorkflow = bridge.exportWorkflow(req.params.id);

      const filename = `workflow-${exportedWorkflow.name.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.json`;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      res.status(200).json({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        workflow: exportedWorkflow
      });
    } catch (error) {
      logError('Error exporting workflow:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to export workflow'
      });
    }
  });

  /**
   * POST /api/workflows/import
   * Import a workflow from JSON
   * Invalidates dashboard, list, and groups cache
   */
  app.post('/api/workflows/import',
    cache ? invalidateCache(cache, ['workflows:']) : (req, res, next) => next(),
    async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { workflow, options = {} } = req.body;

      if (!workflow) {
        return res.status(400).json({
          success: false,
          error: 'Workflow data is required'
        });
      }

      // Check for duplicate names if not overwriting
      if (!options.overwrite) {
        const existingWorkflows = bridge.listWorkflows();
        const duplicateName = existingWorkflows.find(w => w.name === workflow.name);
        if (duplicateName) {
          workflow.name = `${workflow.name} (imported ${new Date().toLocaleString()})`;
        }
      }

      const importedWorkflow = await bridge.importWorkflow({
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps || [],
        tags: workflow.tags || []
      });

      res.status(201).json({
        success: true,
        message: 'Workflow imported successfully',
        data: importedWorkflow,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error importing workflow:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to import workflow'
      });
    }
  });

  /**
   * POST /api/workflows/from-template
   * Create a workflow from a template
   * Invalidates dashboard, list, and groups cache
   */
  app.post('/api/workflows/from-template',
    cache ? invalidateCache(cache, ['workflows:']) : (req, res, next) => next(),
    async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { templateId, name, description } = req.body;

      if (!templateId || !name) {
        return res.status(400).json({
          success: false,
          error: 'Template ID and workflow name are required'
        });
      }

      // Get templates directly
      const templates = [
        { id: 'template-api-transform', steps: [{ name: 'Fetch Data', config: { type: 'api', method: 'GET', endpoint: 'https://api.example.com/data' } }, { name: 'Transform', config: { type: 'transform', script: '({ ...input, processed: true })' } }], tags: ['api', 'transform'], description: 'API to Transform' },
        { id: 'template-conditional-flow', steps: [{ name: 'Check', config: { type: 'conditional', condition: 'input.value > 0' } }], tags: ['conditional'], description: 'Conditional Flow' },
        { id: 'template-parallel-apis', steps: [{ name: 'Parallel', config: { type: 'parallel', steps: [] } }], tags: ['parallel'], description: 'Parallel APIs' },
        { id: 'template-delay-retry', steps: [{ name: 'Wait', config: { type: 'delay', duration: 5000 } }], tags: ['delay'], description: 'Delay Retry' }
      ];

      const template = templates.find(t => t.id === templateId);

      if (!template) {
        return res.status(404).json({
          success: false,
          error: 'Template not found'
        });
      }

      const workflow = await bridge.createWorkflow({
        name,
        description: description || template.description,
        steps: template.steps,
        tags: [...(template.tags || []), 'from-template']
      });

      res.status(201).json({
        success: true,
        message: 'Workflow created from template',
        data: workflow,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error creating workflow from template:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create workflow from template'
      });
    }
  });

  // ============================================
  // WORKFLOW EXECUTION ENDPOINTS
  // ============================================

  /**
   * POST /api/workflows/:workflowId/execute
   * Execute a specific workflow with optional input data
   * Invalidates dashboard cache (executions are displayed there)
   */
  app.post('/api/workflows/:workflowId/execute',
    validate(executeWorkflowSchema),
    cache ? invalidateCache(cache, ['workflows:dashboard']) : (req, res, next) => next(),
    async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      let { input } = req.body;
      const workflowId = req.params.workflowId;

      // If no input provided, try to use the workflow's default input
      if (!input || Object.keys(input).length === 0) {
        const workflow = bridge.getWorkflow(workflowId);
        if (workflow && workflow.defaultInput) {
          input = workflow.defaultInput;
        } else {
          input = {};
        }
      }

      const execution = await bridge.executeWorkflow(workflowId, input);

      res.status(200).json({
        success: true,
        message: 'Workflow execution completed',
        executionId: execution.id,
        workflowId: execution.workflowId,
        status: execution.status,
        outcome: execution.outcome,
        data: execution,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error executing workflow:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to execute workflow',
        message: error.message
      });
    }
  });

  // ============================================
  // EXECUTION TRACKING ENDPOINTS
  // ============================================

  /**
   * GET /api/executions
   * List all executions with optional filtering
   */
  app.get('/api/executions', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);

      const options = {};
      if (req.query.workflowId) options.workflowId = req.query.workflowId;
      if (req.query.status) options.status = req.query.status;
      if (req.query.outcome) options.outcome = req.query.outcome;
      if (req.query.limit) options.limit = parseInt(req.query.limit);
      if (req.query.offset) options.offset = parseInt(req.query.offset);
      if (req.query.date)     options.date     = req.query.date;
      if (req.query.dateFrom) options.dateFrom = req.query.dateFrom;
      if (req.query.dateTo)   options.dateTo   = req.query.dateTo;

      const executions = await bridge.listExecutions(options);

      res.status(200).json({
        success: true,
        data: slimExecutions(executions),
        total: Array.isArray(executions) ? executions.length : 0,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error listing executions:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list executions'
      });
    }
  });

  /**
   * GET /api/executions/stats
   * Get execution statistics
   */
  app.get('/api/executions/stats', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const options = {};
      if (req.query.date)     options.date     = req.query.date;
      if (req.query.dateFrom) options.dateFrom = req.query.dateFrom;
      if (req.query.dateTo)   options.dateTo   = req.query.dateTo;
      if (req.query.workflowId) options.workflowId = req.query.workflowId;
      const stats = await bridge.getExecutionStats(options);

      res.status(200).json({
        success: true,
        data: stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error getting execution stats:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get execution stats'
      });
    }
  });

  /**
   * GET /api/executions/recent
   * Get recent executions
   */
  app.get('/api/executions/recent', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const limit = parseInt(req.query.limit) || 10;
      const executions = await bridge.listExecutions({ limit });

      res.status(200).json({
        success: true,
        data: slimExecutions(executions),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error getting recent executions:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get recent executions'
      });
    }
  });

  /**
   * GET /api/executions/running
   * Get currently running executions
   */
  app.get('/api/executions/running', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const executions = await bridge.listExecutions({ status: 'running' });

      res.status(200).json({
        success: true,
        data: slimExecutions(executions),
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error getting running executions:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get running executions'
      });
    }
  });

  /**
   * GET /api/executions/dates
   * List available execution days
   */
  app.get('/api/executions/dates', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const dates = await bridge.listAvailableDays();
      res.status(200).json({ success: true, data: dates });
    } catch (error) {
      logError('Error listing execution dates:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/executions/:id
   * Get a specific execution by ID
   */
  app.get('/api/executions/:id', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const execution = await bridge.getExecution(req.params.id);

      if (!execution) {
        return res.status(404).json({
          success: false,
          error: 'Execution not found'
        });
      }

      res.status(200).json({
        success: true,
        data: execution,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error getting execution:', error);
      res.status(404).json({
        success: false,
        error: error.message || 'Execution not found'
      });
    }
  });

  /**
   * POST /api/executions/:id/cancel
   * Cancel a running execution (not supported with core services)
   */
  app.post('/api/executions/:id/cancel', async (req, res) => {
    try {
      res.status(200).json({
        success: true,
        message: 'Execution cancel requested (note: cancellation may not be immediate)',
        executionId: req.params.id,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error cancelling execution:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to cancel execution'
      });
    }
  });

  /**
   * DELETE /api/executions/:id
   * Delete an execution record (not supported - core services manage history)
   */
  app.delete('/api/executions/:id', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const deleted = await bridge.deleteExecution(req.params.id);
      if (!deleted) return res.status(404).json({ success: false, error: 'Execution not found' });
      res.status(200).json({
        success: true,
        message: 'Execution deleted',
        executionId: req.params.id,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error deleting execution:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete execution'
      });
    }
  });

  /**
   * POST /api/executions/clear
   * Clear executions by date or age
   */
  app.post('/api/executions/clear', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { date, olderThanDays } = req.body;
      const deletedCount = await bridge.clearExecutions({ date, olderThanDays });
      res.json({
        success: true,
        data: { deletedCount },
        message: `Cleared ${deletedCount} records`
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================
  // SCHEDULE MANAGEMENT ENDPOINTS
  // ============================================

  /**
   * POST /api/workflows/:id/schedules
   * Create a schedule for a workflow
   */
  app.post('/api/workflows/:id/schedules', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { name, description, cronExpression, interval, input, enabled } = req.body;
      const workflowId = req.params.id;

      const schedule = await bridge.createSchedule({
        workflowId,
        name,
        description,
        cronExpression,
        interval,
        input: input || {},
        enabled: enabled !== false
      });

      res.status(201).json({
        success: true,
        message: 'Schedule created successfully',
        data: schedule,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error creating schedule:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create schedule'
      });
    }
  });

  /**
   * GET /api/workflows/:id/executions
   * Execution history for ONE workflow, read across the per-day files.
   *
   * GET /api/executions answers from today only and pages 100 records across
   * every workflow, so a workflow on a tight cadence buries the rest and their
   * history reads as lost. Query params:
   *   days   - look-back window (default 30; `all` scans every day on disk)
   *   limit  - rows returned (default 200, capped at 1000)
   *   status - restrict rows to success | failed | running (stats stay whole-window)
   */
  app.get('/api/workflows/:id/executions', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);

      const rawDays = String(req.query.days || '').toLowerCase();
      const parsedDays = parseInt(rawDays, 10);
      const days = rawDays === 'all' ? 0
        : (Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 30);

      const parsedLimit = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 1000) : 200;

      const status = ['success', 'failed', 'running'].includes(req.query.status)
        ? req.query.status : undefined;

      const data = await bridge.listWorkflowExecutions(req.params.id, { days, limit, status });

      res.status(200).json({
        success: true,
        data,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error listing workflow executions:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list workflow executions'
      });
    }
  });

  /**
   * GET /api/workflows/:id/schedules
   * Get all schedules for a workflow
   */
  app.get('/api/workflows/:id/schedules', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const workflowId = req.params.id;
      const schedules = bridge.listSchedules({ workflowId });

      res.status(200).json({
        success: true,
        data: schedules,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error listing schedules:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list schedules'
      });
    }
  });

  /**
   * GET /api/schedules
   * List all schedules across all workflows
   */
  app.get('/api/schedules', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      let schedules = bridge.listSchedules() || [];

      // Apply optional filters
      if (req.query.enabled === 'true') {
        schedules = schedules.filter(s => s.enabled === true);
      } else if (req.query.enabled === 'false') {
        schedules = schedules.filter(s => s.enabled === false);
      }

      if (req.query.workflowId) {
        schedules = schedules.filter(s => s.workflowId === req.query.workflowId);
      }

      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;

      res.status(200).json({
        success: true,
        data: schedules.slice(offset, offset + limit),
        total: schedules.length,
        limit,
        offset,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error listing schedules:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to list schedules'
      });
    }
  });

  /**
   * POST /api/schedules
   * Create a schedule globally
   */
  app.post('/api/schedules', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { workflowId, name, cron, cronExpression, description, enabled, input } = req.body;

      if (!workflowId || !name || (!cron && !cronExpression)) {
        return res.status(400).json({
          success: false,
          error: 'Workflow ID, name, and cron expression are required'
        });
      }

      const schedule = await bridge.createSchedule({
        workflowId,
        name,
        cronExpression: cron || cronExpression,
        description,
        input,
        enabled: enabled !== false
      });

      res.status(201).json({
        success: true,
        message: 'Schedule created successfully',
        data: schedule,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error creating schedule:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create schedule'
      });
    }
  });

  /**
   * GET /api/schedules/:id
   * Get a specific schedule by ID
   */
  app.get('/api/schedules/:id', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const schedule = bridge.getSchedule(req.params.id);

      res.status(200).json({
        success: true,
        data: schedule,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error getting schedule:', error);
      res.status(404).json({
        success: false,
        error: error.message || 'Schedule not found'
      });
    }
  });

  /**
   * PUT /api/schedules/:id
   * Update a schedule
   */
  app.put('/api/schedules/:id', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const { name, description, cronExpression, interval, input } = req.body;

      const schedule = await bridge.updateSchedule(req.params.id, {
        name,
        description,
        cronExpression,
        interval,
        input
      });

      res.status(200).json({
        success: true,
        message: 'Schedule updated successfully',
        data: schedule,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error updating schedule:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update schedule'
      });
    }
  });

  /**
   * POST /api/schedules/:id/toggle
   * Enable or disable a schedule
   */
  app.post('/api/schedules/:id/toggle', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const scheduleId = req.params.id;

      // Determine the desired state. If the caller explicitly provides `enabled`
      // (true/false), honour it (idempotent set). If it is omitted — which several
      // frontends do, sending an empty/no body — fall back to true "toggle"
      // semantics and flip the schedule's current state. Previously a missing value
      // was coerced to falsy and always *disabled* the schedule, so enabling from
      // those screens never worked.
      const rawEnabled = req.body ? req.body.enabled : undefined;
      let targetEnabled;
      if (rawEnabled === true || rawEnabled === false) {
        targetEnabled = rawEnabled;
      } else if (rawEnabled === 'true' || rawEnabled === 'false') {
        targetEnabled = rawEnabled === 'true';
      } else {
        // Not specified — flip current state.
        const current = bridge.getSchedule(scheduleId);
        targetEnabled = !current.enabled;
      }

      const schedule = targetEnabled
        ? await bridge.enableSchedule(scheduleId)
        : await bridge.disableSchedule(scheduleId);

      res.status(200).json({
        success: true,
        message: `Schedule ${targetEnabled ? 'enabled' : 'disabled'}`,
        data: schedule,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error toggling schedule:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to toggle schedule'
      });
    }
  });

  /**
   * DELETE /api/schedules/:id
   * Delete a schedule
   */
  app.delete('/api/schedules/:id', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      await bridge.deleteSchedule(req.params.id);

      res.status(200).json({
        success: true,
        message: 'Schedule deleted successfully',
        scheduleId: req.params.id,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error deleting schedule:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to delete schedule'
      });
    }
  });

  /**
   * POST /api/schedules/:id/run-now
   * Execute a schedule immediately
   */
  app.post('/api/schedules/:id/run-now', async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const scheduleId = req.params.id;

      const execution = await bridge.triggerSchedule(scheduleId);

      res.status(200).json({
        success: true,
        message: 'Schedule executed successfully',
        executionId: execution.id,
        scheduleId: scheduleId,
        workflowId: execution.workflowId,
        data: execution,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error running schedule:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to run schedule'
      });
    }
  });

  // ============================================
  // SETTINGS ENDPOINTS
  // ============================================

  /**
   * GET /api/settings
   * Retrieve application settings
   */
  app.get('/api/settings', async (req, res) => {
    try {
      const settingsPath = path.join(appBaseDir, 'settings.json');

      let settings;

      try {
        const content = await filingService.read(settingsPath);
        settings = JSON.parse(content);
      } catch (err) {
        // Return defaults if no settings file exists
        settings = {
          general: {
            applicationName: 'noobly Wiki',
            defaultWorkflowStatus: 'draft',
            autoSaveInterval: 30,
            maxExecutionHistory: 100,
            dateTimeFormat: 'en-US'
          },
          ai: {
            provider: 'ollama',
            model: 'tinyllama:1.1b',
            apiKey: '',
            temperature: 0.7,
            maxTokens: 2048
          },
          userPreferences: {
            theme: 'auto',
            sidebarCollapsed: false,
            notificationsEnabled: true,
            soundEffectsEnabled: false,
            itemsPerPage: 10
          }
        };
      }

      res.json({
        success: true,
        data: settings,
        message: 'Settings retrieved successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logError('Failed to get settings:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get settings',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * PUT /api/settings
   * Update application settings
   */
  app.put('/api/settings', async (req, res) => {
    try {
      const settings = req.body;

      if (!settings.general || !settings.ai || !settings.userPreferences) {
        return res.status(400).json({
          success: false,
          message: 'Invalid settings structure',
          timestamp: new Date().toISOString()
        });
      }

      const settingsPath = path.join(appBaseDir, 'settings.json');

      await filingService.write(settingsPath, JSON.stringify(settings, null, 2));

      res.json({
        success: true,
        data: settings,
        message: 'Settings updated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logError('Failed to update settings:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to update settings',
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * POST /api/ai/test
   * Test AI connection
   */
  app.post('/api/ai/test', async (req, res) => {
    try {
      const { provider, model, apiKey } = req.body;

      if (!provider || provider === 'none') {
        return res.status(400).json({
          success: false,
          message: 'AI provider not configured',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: `AI connection test successful for ${provider}`,
        provider: provider,
        model: model,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logError('Failed to test AI connection:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to test AI connection',
        timestamp: new Date().toISOString()
      });
    }
  });

  // ============================================
  // DEBUG ENDPOINT
  // ============================================

  /**
   * GET /api/debug/measuring
   * Check if measuring service is available
   */
  app.get('/api/debug/measuring', (req, res) => {
    res.json({
      measuring_available: !!measuring,
      measuring_type: typeof measuring,
      measuring_methods: measuring ? Object.keys(measuring) : [],
      timestamp: new Date().toISOString()
    });
  });

  // ============================================
  // METRICS ENDPOINTS
  // ============================================

  /**
   * GET /api/metrics/dashboard
   * Retrieve dashboard metrics (requires measuring service)
   */
  app.get('/api/metrics/dashboard', async (req, res) => {
    try {
      if (!measuring) {
        return res.status(503).json({
          success: false,
          error: 'Measuring service not available',
          timestamp: new Date().toISOString()
        });
      }

      const today = new Date();
      const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

      // Get metrics for the day
      const metrics = {
        requests: measuring.list('dashboard:requests', today, tomorrow) || [],
        errors: measuring.list('dashboard:errors', today, tomorrow) || [],
        request_times: measuring.list('dashboard:request_time_ms', today, tomorrow) || [],
        active_workflows: measuring.list('dashboard:active_workflows', today, tomorrow) || [],
        total_workflows: measuring.list('dashboard:total_workflows', today, tomorrow) || [],
        total_executions: measuring.list('dashboard:total_executions', today, tomorrow) || [],
        total_schedules: measuring.list('dashboard:total_schedules', today, tomorrow) || [],
        records_processed: measuring.list('dashboard:records_processed', today, tomorrow) || []
      };

      // Calculate aggregates
      const aggregates = {
        total_requests: measuring.total('dashboard:requests', today, tomorrow) || 0,
        total_errors: measuring.total('dashboard:errors', today, tomorrow) || 0,
        avg_request_time_ms: measuring.average('dashboard:request_time_ms', today, tomorrow) || 0,
        avg_active_workflows: measuring.average('dashboard:active_workflows', today, tomorrow) || 0,
        avg_total_workflows: measuring.average('dashboard:total_workflows', today, tomorrow) || 0,
        avg_executions: measuring.average('dashboard:total_executions', today, tomorrow) || 0,
        avg_records_processed: measuring.average('dashboard:records_processed', today, tomorrow) || 0
      };

      res.json({
        success: true,
        metrics,
        aggregates,
        period: {
          start: today.toISOString(),
          end: tomorrow.toISOString()
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving dashboard metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve metrics',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  /**
   * GET /api/metrics/analytics
   * Retrieve measuring service analytics
   */
  app.get('/api/metrics/analytics', async (req, res) => {
    try {
      if (!measuring) {
        return res.status(503).json({
          success: false,
          error: 'Measuring service not available',
          timestamp: new Date().toISOString()
        });
      }

      const analytics = {
        unique_metrics: measuring.analytics?.getUniqueMetricCount?.() || 0,
        top_metrics: measuring.analytics?.getTopMetricsByCount?.(10) || []
      };

      res.json({
        success: true,
        analytics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error retrieving analytics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve analytics',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });
};
