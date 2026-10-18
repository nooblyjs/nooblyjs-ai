/**
 * @fileoverview Workflow Programmatic API Routes
 * Lightweight, integration-friendly endpoints for triggering workflows by name
 * and polling their execution status. Backed by the WorkflowBridge service.
 *
 * Endpoints:
 *   POST /api/workflows/start                              - start a workflow by name
 *   GET  /api/workflows/executions/:executionId/status     - poll an execution's status
 *   POST /api/workflows/schedule                           - schedule a workflow (cron)
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

/**
 * Register the workflow programmatic API routes.
 *
 * @param {string} type - Provider type identifier
 * @param {Object} options - { 'express-app': Express app, dependencies: {...} }
 * @param {Object} eventEmitter - Inter-service event emitter
 */
module.exports = (type, options, eventEmitter) => {
  const app = options.app || options['express-app'];
  const { dependencies = {} } = options;
  const logger = dependencies.logging;

  /**
   * Resolve the WorkflowBridge from the app context.
   */
  const getWorkflowBridge = (req) => {
    const bridge = req.app.get('workflowBridge');
    if (!bridge) {
      throw new Error('WorkflowBridge not initialized');
    }
    return bridge;
  };

  const logError = (message, error) => {
    if (logger && typeof logger.error === 'function') {
      logger.error(message, { error: error?.message || error });
    }
  };

  // Require an authenticated caller (session cookie or bearer token). The global
  // /api/ middleware runs the bearer middleware non-blocking, so this enforces it.
  // Triggering a workflow can execute Transform (code) and API (outbound) steps, so
  // these endpoints must never be anonymous.
  const requireAuth = (req, res, next) => {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
  };

  // Per-execution rate limiter shared from app.js (falls back to a no-op if absent).
  const executionLimiter =
    (app.get && app.get('executionLimiter')) || ((req, res, next) => next());

  /**
   * POST /api/workflows/start
   * Start a workflow asynchronously.
   *
   * Body: { workflowName: string, payload?: object }
   *   - workflowName: name (or id) of the workflow to run
   *   - payload: data object passed as input to the workflow (optional)
   *
   * Returns 202 Accepted with a unique executionId. The workflow runs in the
   * background — poll the status endpoint with the executionId for progress.
   */
  app.post('/api/workflows/start', requireAuth, executionLimiter, async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);

      // Ensure the bridge has finished loading workflows from disk
      if (bridge.initialized === false && typeof bridge.whenReady === 'function') {
        await bridge.whenReady();
      }

      const { workflowName, payload } = req.body || {};

      if (!workflowName || typeof workflowName !== 'string' || workflowName.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'workflowName is required and must be a non-empty string'
        });
      }

      if (payload !== undefined && payload !== null &&
          (typeof payload !== 'object' || Array.isArray(payload))) {
        return res.status(400).json({
          success: false,
          error: 'payload must be a JSON object'
        });
      }

      const result = await bridge.startWorkflowByName(workflowName.trim(), payload || {});

      return res.status(202).json({
        success: true,
        message: 'Workflow execution started',
        executionId: result.executionId,
        workflowId: result.workflowId,
        workflowName: result.workflowName,
        status: result.status,
        startedAt: result.startedAt,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error starting workflow', error);
      const notFound = /not found/i.test(error.message || '');
      return res.status(notFound ? 404 : 500).json({
        success: false,
        error: error.message || 'Failed to start workflow'
      });
    }
  });

  /**
   * GET /api/workflows/executions/:executionId/status
   * Get the status of a workflow execution by its unique execution id.
   *
   * Returns:
   *   status:  'running' | 'completed' | 'failed'
   *   outcome: 'success' | 'failed' | null (null while still running)
   */
  app.get('/api/workflows/executions/:executionId/status', requireAuth, async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);
      const execution = await bridge.getExecution(req.params.executionId);

      if (!execution) {
        return res.status(404).json({
          success: false,
          error: 'Execution not found'
        });
      }

      return res.status(200).json({
        success: true,
        executionId: execution.id,
        workflowId: execution.workflowId,
        workflowName: execution.name,
        status: execution.status,
        outcome: execution.outcome,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        duration: execution.duration,
        error: execution.error,
        result: execution.result,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error getting execution status', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Failed to get execution status'
      });
    }
  });

  /**
   * POST /api/workflows/schedule
   * Schedule a workflow to run on a recurring cron schedule.
   *
   * Body: { workflowName: string, cron: string, payload?: object, name?: string }
   *   - workflowName: name (or id) of the workflow to schedule
   *   - cron: cron expression, e.g. "0 9 * * *" (every day at 09:00)
   *   - payload: data object passed as input on each run (optional)
   *   - name: schedule name (optional, auto-generated from the workflow name)
   *
   * Returns 201 Created with the schedule id and its next run time.
   */
  app.post('/api/workflows/schedule', requireAuth, executionLimiter, async (req, res) => {
    try {
      const bridge = getWorkflowBridge(req);

      if (bridge.initialized === false && typeof bridge.whenReady === 'function') {
        await bridge.whenReady();
      }

      const { workflowName, cron, payload, name } = req.body || {};

      if (!workflowName || typeof workflowName !== 'string' || workflowName.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'workflowName is required and must be a non-empty string'
        });
      }

      if (!cron || typeof cron !== 'string' || cron.trim() === '') {
        return res.status(400).json({
          success: false,
          error: 'cron is required and must be a non-empty cron expression'
        });
      }

      if (payload !== undefined && payload !== null &&
          (typeof payload !== 'object' || Array.isArray(payload))) {
        return res.status(400).json({
          success: false,
          error: 'payload must be a JSON object'
        });
      }

      const schedule = await bridge.scheduleWorkflowByName(
        workflowName.trim(),
        cron.trim(),
        payload || {},
        typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined
      );

      return res.status(201).json({
        success: true,
        message: 'Workflow scheduled',
        scheduleId: schedule.id,
        workflowId: schedule.workflowId,
        scheduleName: schedule.name,
        cron: schedule.cronExpression,
        nextRun: schedule.nextRun,
        enabled: schedule.enabled,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logError('Error scheduling workflow', error);
      const msg = error.message || '';
      const notFound = /not found/i.test(msg);
      const badRequest = /cron expression|out of range|must have exactly|is required/i.test(msg);
      const status = notFound ? 404 : (badRequest ? 400 : 500);
      return res.status(status).json({
        success: false,
        error: msg || 'Failed to schedule workflow'
      });
    }
  });
};
