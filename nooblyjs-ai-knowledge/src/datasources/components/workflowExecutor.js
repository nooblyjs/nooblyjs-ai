/**
 * @fileoverview Workflow Executir
 * WorkflowExecutor - Executes workflows and manages execution history
 * Stores execution history under /.application/workflow/executions/<day>/<workflowId>.json
 * 
 * @author noobly Team
 * @version 1.0.0
 */

const fs = require('node:fs').promises;
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const vm = require('node:vm');
const validator = require('validator');
const dns = require('dns').promises;
const { URL } = require('url');

/**
 * Simple Mutex for preventing concurrent file writes
 */
class Mutex {
  constructor() {
    this.locked = false;
    this.queue = [];
  }

  async lock() {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  unlock() {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift();
      resolve();
    } else {
      this.locked = false;
    }
  }
}

class WorkflowExecutor {
  constructor(deps = {}) {
    this.workflowManager = deps.workflowManager;
    this.logger = deps.logger;
    this.eventBus = deps.eventBus; // Optional event bus for real-time updates
    const appBaseDir = deps.appBaseDir || path.join(process.cwd(), '.application');
    this.executionsDir = path.join(appBaseDir, 'workflow', 'executions');
    this.executions = [];
    this.runningExecutions = new Map(); // Track active executions
    this.initialized = false;
    this._loadedDay = new Date().toISOString().slice(0, 10);
    this.executionsMutex = new Mutex();
  }

  /**
   * Emit execution event via event bus
   */
  emitExecutionEvent(eventType, executionId, data = {}) {
    if (this.eventBus) {
      this.eventBus.emit('workflow:execution', { eventType, executionId, ...data });
    }
  }

  /**
   * Get today's date key for execution files (YYYY-MM-DD format)
   * @private
   */
  _getTodayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Reduce any workflow identifier to the filesystem-safe id used as the
   * per-workflow file name. Kept in step with WorkflowBridge so both writers
   * share the same on-disk layout under `executions/<day>/<workflowId>.json`.
   * @private
   */
  _executionFileKey(record) {
    const raw = (record && (record.workflowId || record.workflowName || record.name)) || '';
    const key = String(raw).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return key || '_unassigned';
  }

  /**
   * Directory that holds one day's per-workflow execution files.
   * @private
   */
  _getDayDirPath(dateKey) {
    return path.join(this.executionsDir, dateKey);
  }

  /**
   * File path for a single workflow's executions on a given day.
   * @private
   */
  _getWorkflowFilePath(dateKey, workflowKey) {
    return path.join(this._getDayDirPath(dateKey), `${workflowKey}.json`);
  }

  /**
   * Read + parse a JSON array file, tolerating corruption (a truncated file
   * from an interrupted write is quarantined and skipped, never fatal).
   * @private
   */
  async _readJsonArray(filePath) {
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (parseErr) {
      this.logger?.error('Corrupt execution file — quarantining and skipping', {
        file: filePath,
        error: parseErr.message
      });
      try {
        await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch { /* leave it be */ }
      return [];
    }
  }

  /**
   * Atomically write a JSON array (temp file + rename), so a reader or a crash
   * never observes a half-written file.
   * @private
   */
  async _writeJsonArrayAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, filePath);
    } catch (err) {
      try { await fs.unlink(tmp); } catch { /* already gone */ }
      throw err;
    }
  }

  /**
   * Load ALL executions for a specific day, merged across every per-workflow
   * file in that day's directory.
   * @private
   */
  async _loadDayFile(dateKey) {
    const dayDir = this._getDayDirPath(dateKey);
    let files;
    try {
      files = await fs.readdir(dayDir);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
    const arrays = [];
    for (const f of files.filter(x => x.endsWith('.json'))) {
      arrays.push(await this._readJsonArray(path.join(dayDir, f)));
    }
    return arrays.flat();
  }

  /**
   * Validate URL for SSRF protection
   * Blocks localhost, private IPs, and cloud metadata endpoints
   * @param {string} urlString - URL to validate
   * @returns {Promise<string>} Validated URL
   */
  async validateSafeUrl(urlString) {
    if (!urlString || typeof urlString !== 'string') {
      throw new Error('Invalid URL');
    }

    // Validate URL format
    if (!validator.isURL(urlString, {
      protocols: ['http', 'https'],
      require_protocol: true
    })) {
      throw new Error('Invalid URL format');
    }

    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      throw new Error(`Invalid URL: ${error.message}`);
    }

    // Block localhost
    const localhostPatterns = [
      'localhost',
      '127.0.0.1',
      '::1',
      '0.0.0.0',
      '[::1]'
    ];

    if (localhostPatterns.some(pattern => url.hostname.toLowerCase() === pattern)) {
      throw new Error('Access to localhost is not allowed');
    }

    // Block cloud metadata endpoints
    if (url.hostname === '169.254.169.254') {
      throw new Error('Access to cloud metadata endpoint is not allowed');
    }

    // Resolve hostname to IP and check for private ranges
    try {
      const addresses = await dns.resolve4(url.hostname);

      for (const address of addresses) {
        if (this.isPrivateIP(address)) {
          throw new Error(`Access to private IP range is not allowed: ${address}`);
        }
      }
    } catch (error) {
      if (error.message.includes('private IP')) {
        throw error;
      }
      // DNS resolution failure - allow to proceed (will fail on fetch)
    }

    return url.href;
  }

  /**
   * Check if IP address is in private range
   * @param {string} ip - IP address to check
   * @returns {boolean} True if private IP
   */
  isPrivateIP(ip) {
    const parts = ip.split('.').map(Number);

    // 10.0.0.0/8
    if (parts[0] === 10) return true;

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;

    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;

    // 169.254.0.0/16 (link-local, includes cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;

    return false;
  }

  /**
   * Initialize executor - load execution history
   */
  async initialize() {
    try {
      await this.loadTodayExecutions();
      this.initialized = true;
      this.logger?.info('WorkflowExecutor initialized', { executionCount: this.executions.length });
    } catch (error) {
      this.logger?.error('Failed to initialize WorkflowExecutor', { error: error.message });
      this.executions = [];
      this.initialized = true;
    }
  }

  /**
   * Load today's executions from per-day file
   */
  async loadTodayExecutions() {
    this._loadedDay = this._getTodayKey();
    this.executions = await this._loadDayFile(this._loadedDay);
    return this.executions;
  }

  /**
   * Backwards compatibility alias
   */
  async loadExecutions() {
    return this.loadTodayExecutions();
  }

  /**
   * Save today's executions to per-day/per-workflow files (atomic, mutex-guarded).
   * Each workflow gets its own file under the day directory so no single file
   * grows with the whole day's volume.
   */
  async saveExecutions() {
    await this.executionsMutex.lock();
    try {
      const dateKey = this._loadedDay || this._getTodayKey();
      const dayDir = this._getDayDirPath(dateKey);
      await fs.mkdir(dayDir, { recursive: true });

      const byKey = new Map();
      for (const rec of this.executions) {
        const key = this._executionFileKey(rec);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(rec);
      }
      for (const [key, records] of byKey) {
        await this._writeJsonArrayAtomic(this._getWorkflowFilePath(dateKey, key), records);
      }
    } catch (error) {
      this.logger?.error('Failed to save executions', { error: error.message });
      throw error;
    } finally {
      this.executionsMutex.unlock();
    }
  }

  /**
   * Execute a workflow
   * @param {string} workflowId - Workflow ID
   * @param {Object} input - Input data for workflow
   * @returns {Promise<Object>} Execution result
   */
  async executeWorkflow(workflowId, input = {}) {
    const executionId = uuidv4();

    try {
      const workflow = this.workflowManager.getWorkflow(workflowId);

      // Create execution record
      const execution = {
        id: executionId,
        workflowId: workflow.id,
        name: workflow.name,
        startedAt: new Date().toISOString(),
        status: 'running',
        outcome: 'running',
        input,
        result: null,
        steps: [],
        error: null
      };

      // Mark as running
      this.runningExecutions.set(executionId, execution);

      // Build context for workflow execution
      let context = { ...input, _executionId: executionId };
      const stepResults = [];
      // Per-step outputs, exposed to later steps as data.steps[i].data
      const contextSteps = [];

      // Emit execution started event
      this.emitExecutionEvent('started', executionId, {
        workflowId,
        workflowName: workflow.name,
        stepCount: workflow.steps.length
      });

      // Execute each step
      for (let stepIndex = 0; stepIndex < workflow.steps.length; stepIndex++) {
        const step = workflow.steps[stepIndex];
        // A step may be a string path to a module, or an object with id/name.
        const stepName = typeof step === 'string'
          ? path.basename(step)
          : (step && step.name) || `step-${stepIndex + 1}`;
        const stepId = (step && step.id) || stepName;
        try {
          this.logger?.info('Executing step', {
            executionId,
            workflowId,
            stepId,
            stepName,
            stepNumber: stepIndex + 1,
            totalSteps: workflow.steps.length
          });

          // Emit step started event
          this.emitExecutionEvent('step:started', executionId, {
            stepId,
            stepName,
            stepNumber: stepIndex + 1,
            totalSteps: workflow.steps.length
          });

          // Run the step (module path, handler function, or config)
          const result = await this.executeStep(step, context);

          stepResults.push({
            stepId,
            stepName,
            status: 'completed',
            result: result,
            executedAt: new Date().toISOString()
          });

          // Emit step completed event
          this.emitExecutionEvent('step:completed', executionId, {
            stepId,
            stepName,
            stepNumber: stepIndex + 1,
            totalSteps: workflow.steps.length,
            duration: new Date().getTime() - new Date(execution.startedAt).getTime()
          });

          // Record this step's output and merge it into the context so later
          // steps can read it via data.steps[i].data or as flat properties.
          contextSteps.push({ stepId, stepName, data: result });
          context = (result && typeof result === 'object')
            ? { ...context, ...result, steps: contextSteps }
            : { ...context, steps: contextSteps };
        } catch (stepError) {
          this.logger?.error('Step failed', {
            executionId,
            stepId,
            stepNumber: stepIndex + 1,
            error: stepError.message
          });

          // Emit step failed event
          this.emitExecutionEvent('step:failed', executionId, {
            stepId,
            stepName,
            stepNumber: stepIndex + 1,
            error: stepError.message
          });

          // Mark execution as failed
          execution.status = 'failed';
          execution.outcome = 'failed';
          execution.error = stepError.message;

          stepResults.push({
            stepId,
            stepName,
            status: 'failed',
            error: stepError.message,
            errorStack: stepError.stack,
            executedAt: new Date().toISOString()
          });

          // Stop on first failure
          break;
        }
      }

      // Update execution record
      execution.completedAt = new Date().toISOString();
      execution.steps = stepResults;
      execution.result = context;

      if (execution.outcome !== 'failed') {
        execution.status = 'completed';
        execution.outcome = 'success';
      }

      // Save execution
      this.executions.push(execution);
      await this.saveExecutions();

      const duration = new Date(execution.completedAt) - new Date(execution.startedAt);
      this.logger?.info('Workflow execution completed', {
        executionId,
        workflowId,
        outcome: execution.outcome,
        duration: `${duration}ms`
      });

      // Emit execution completed event
      this.emitExecutionEvent('completed', executionId, {
        outcome: execution.outcome,
        duration,
        stepCount: stepResults.length,
        errors: stepResults.filter(s => s.status === 'failed').length
      });

      // Remove from running
      this.runningExecutions.delete(executionId);

      return execution;
    } catch (error) {
      this.logger?.error('Workflow execution failed', {
        executionId,
        error: error.message
      });

      // Update execution record
      const execution = {
        id: executionId,
        workflowId,
        status: 'failed',
        outcome: 'failed',
        error: error.message,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        steps: []
      };

      this.executions.push(execution);
      await this.saveExecutions();

      // Emit execution failed event
      this.emitExecutionEvent('failed', executionId, {
        error: error.message,
        duration: new Date(execution.completedAt) - new Date(execution.startedAt)
      });

      this.runningExecutions.delete(executionId);

      throw error;
    }
  }

  /**
   * Execute a single step with timeout protection
   * @param {Object} step - Step configuration
   * @param {Object} context - Workflow context
   * @returns {Promise<Object>} Step result
   */
  async executeStep(step, context) {
    // A step may be a string path to a module exporting run(data), an object
    // with { file } / { path } pointing to such a module, an object with a
    // { handler } function, or an object with a { config } block.
    const modulePath = typeof step === 'string'
      ? step
      : (step && (step.file || step.path));

    if (modulePath) {
      const stepLabel = `Step ${path.basename(modulePath)}`;
      // Module steps (e.g. AI processing) can be long-running — default 10 min.
      const stepTimeout = ((step && step.timeout) || 600) * 1000;
      try {
        const resolvedPath = path.isAbsolute(modulePath)
          ? modulePath
          : path.resolve(modulePath);
        const stepModule = require(resolvedPath);
        if (!stepModule || typeof stepModule.run !== 'function') {
          throw new Error(`module "${resolvedPath}" does not export a run(data) function`);
        }
        return await this.withTimeout(
          Promise.resolve(stepModule.run(context)),
          stepTimeout,
          `${stepLabel} execution`
        );
      } catch (error) {
        throw new Error(`Step execution failed: ${error.message}`);
      }
    }

    const stepTimeout = (step.timeout || 30) * 1000; // Default 30 seconds
    const stepLabel = `Step ${step.name}`;

    try {
      // Execute with timeout
      if (step.handler && typeof step.handler === 'function') {
        return await this.withTimeout(
          step.handler(context),
          stepTimeout,
          `${stepLabel} execution`
        );
      } else if (step.config) {
        return await this.withTimeout(
          this.executeStepByConfig(step.config, context),
          stepTimeout,
          `${stepLabel} execution`
        );
      } else {
        return { success: true, context };
      }
    } catch (error) {
      throw new Error(`Step execution failed: ${error.message}`);
    }
  }

  /**
   * Execute a promise with timeout
   * @param {Promise} promise - Promise to execute
   * @param {number} timeout - Timeout in milliseconds
   * @param {string} label - Label for error message
   * @returns {Promise} Result or timeout error
   */
  async withTimeout(promise, timeout, label) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} exceeded timeout of ${timeout}ms`)),
        timeout
      );
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Execute step based on config
   * Supports: delay, api, parallel, identity
   */
  async executeStepByConfig(config, context) {
    const { type = 'identity' } = config;

    switch (type) {
      case 'delay':
        // Delay step
        await new Promise(resolve => setTimeout(resolve, config.duration || 1000));
        return { delayed: true, duration: config.duration };

      case 'transform':
        // JS Transformation step
        if (!config.script) throw new Error('Transform step requires script');
        const transformResult = this.executeSandboxedCode(config.script, {
          input: context,
          data: context,
          context: context
        });
        return typeof transformResult === 'object' ? transformResult : { result: transformResult };

      case 'conditional':
        // Conditional logic step
        if (!config.condition) throw new Error('Conditional step requires condition');
        const conditionMet = !!this.executeSandboxedCode(`result = (${config.condition})`, {
          input: context,
          data: context,
          context: context
        });
        return { conditionMet };

      case 'api':
        // API call step
        return this.executeApiStep(config, context);

      case 'parallel':
        // Parallel execution
        if (Array.isArray(config.steps)) {
          const results = await Promise.all(
            config.steps.map(s => this.executeStep(s, context))
          );
          return { parallel: results };
        }
        return { parallel: [] };

      case 'identity':
      default:
        // Do nothing, return context
        return { processed: true };
    }
  }

  /**
   * Execute API step with full HTTP support
   * @param {Object} config - API step config { endpoint, method, headers, body, timeout }
   * @param {Object} context - Execution context for variable interpolation
   * @returns {Promise<Object>} API response
   */
  async executeApiStep(config, context) {
    const { endpoint, method = 'GET', headers = {}, body, timeout = 30000, retries = 3 } = config;

    if (!endpoint) {
      throw new Error('API step requires endpoint');
    }

    // Interpolate context variables in endpoint and body
    const interpolatedEndpoint = this.interpolateString(endpoint, context);
    const interpolatedBody = body ? this.interpolateString(JSON.stringify(body), context) : null;

    // Validate endpoint for SSRF protection
    let validatedEndpoint;
    try {
      validatedEndpoint = await this.validateSafeUrl(interpolatedEndpoint);
    } catch (error) {
      throw new Error(`SSRF validation failed: ${error.message}`);
    }

    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const fetchOptions = {
          method: method.toUpperCase(),
          headers: { 'Content-Type': 'application/json', ...headers },
          timeout
        };

        if (interpolatedBody && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
          fetchOptions.body = interpolatedBody;
        }

        this.logger?.info('Executing API call', {
          attempt: attempt + 1,
          method: method.toUpperCase(),
          endpoint: validatedEndpoint
        });

        const response = await fetch(validatedEndpoint, fetchOptions);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const responseData = await this.parseResponse(response);

        return {
          api: true,
          success: true,
          endpoint: validatedEndpoint,
          method: method.toUpperCase(),
          status: response.status,
          headers: Object.fromEntries(response.headers),
          data: responseData
        };
      } catch (error) {
        lastError = error;

        // Exponential backoff for retries
        if (attempt < retries - 1) {
          const delayMs = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10 seconds
          this.logger?.warn('API call failed, retrying', {
            attempt: attempt + 1,
            error: error.message,
            delayMs
          });
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries exhausted
    throw new Error(`API call failed after ${retries} attempts: ${lastError.message}`);
  }

  /**
   * Parse API response based on content type
   */
  async parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      return await response.json();
    } else if (contentType.includes('text/')) {
      return await response.text();
    } else {
      return await response.text();
    }
  }

  /**
   * Interpolate context variables in a string
   * Supports ${variable} syntax
   */
  interpolateString(str, context) {
    if (typeof str !== 'string') {
      return str;
    }

    return str.replace(/\$\{([^}]+)\}/g, (match, key) => {
      const value = context[key];
      return value !== undefined ? value : match;
    });
  }

  /**
   * Execute user code in a sandbox
   * Uses node:vm for basic isolation. 
   * TODO: Move to isolated-vm for better security in high-risk environments.
   * @param {string} code - JavaScript code to execute
   * @param {Object} sandbox - Global variables for the script
   * @param {number} timeout - Execution timeout in ms
   * @returns {any} Result of execution (from 'result' variable)
   */
  executeSandboxedCode(code, sandbox = {}, timeout = 5000) {
    // SECURITY (Production Readiness Audit C4): node:vm is NOT a security sandbox.
    // A workflow author can escape to the host realm (e.g. via the constructor chain
    // of any host object reachable from the context) and achieve RCE with full server
    // privileges. Until this is migrated to isolated-vm / an isolated worker process,
    // code execution is FAIL-CLOSED in production: transform/conditional steps only
    // run if the operator explicitly opts in via WORKFLOW_CODE_EXECUTION=enabled.
    // In non-production it stays enabled for developer convenience (unless explicitly
    // set to 'disabled').
    const mode = String(process.env.WORKFLOW_CODE_EXECUTION ?? '').toLowerCase();
    const isProd = process.env.NODE_ENV === 'production';
    const enabled = mode === 'enabled' || (!isProd && mode !== 'disabled');
    if (!enabled) {
      throw new Error(
        'Workflow code execution (transform/conditional steps) is disabled. ' +
        'node:vm is not a security sandbox; set WORKFLOW_CODE_EXECUTION=enabled to opt in. ' +
        'For untrusted workflow authors, migrate to isolated-vm (see Production Readiness Audit C4).'
      );
    }
    if (!this._sandboxWarningLogged) {
      this.logger?.warn?.(
        '[Sandbox] Executing workflow code via node:vm — this is NOT a hardened security ' +
        'boundary. Ensure only trusted users can author transform/conditional steps.'
      );
      this._sandboxWarningLogged = true;
    }

    const context = vm.createContext({
      ...sandbox,
      console: {
        log: (...args) => this.logger?.info('[Sandbox]', ...args),
        error: (...args) => this.logger?.error('[Sandbox]', ...args),
        warn: (...args) => this.logger?.warn('[Sandbox]', ...args)
      }
    });

    const script = new vm.Script(code);
    script.runInContext(context, { timeout, breakOnSigint: true });

    return context.result;
  }

  /**
   * Get execution by ID
   * @param {string} executionId - Execution ID
   * @returns {Object} Execution record
   */
  getExecution(executionId) {
    const execution = this.executions.find(e => e.id === executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    return execution;
  }

  /**
   * List executions with filters
   * @param {Object} options - Filter options { workflowId?, status?, outcome?, limit?, offset? }
   * @returns {Array} Executions
   */
  listExecutions(options = {}) {
    let result = [...this.executions];

    // Filter by workflow
    if (options.workflowId) {
      result = result.filter(e => e.workflowId === options.workflowId);
    }

    // Filter by status
    if (options.status) {
      result = result.filter(e => e.status === options.status);
    }

    // Filter by outcome
    if (options.outcome) {
      result = result.filter(e => e.outcome === options.outcome);
    }

    // Sort by start time (newest first)
    result.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    // Pagination
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    result = result.slice(offset, offset + limit);

    return result;
  }

  /**
   * Get execution statistics
   * @returns {Object} Stats
   */
  getStats() {
    return {
      total: this.executions.length,
      running: this.runningExecutions.size,
      succeeded: this.executions.filter(e => e.outcome === 'success').length,
      failed: this.executions.filter(e => e.outcome === 'failed').length,
      averageDuration: this.getAverageDuration(),
      successRate: this.getSuccessRate()
    };
  }

  /**
   * Get average execution duration
   */
  getAverageDuration() {
    const completed = this.executions.filter(e => e.completedAt);
    if (completed.length === 0) return 0;

    const totalDuration = completed.reduce((sum, e) => {
      const duration = new Date(e.completedAt) - new Date(e.startedAt);
      return sum + duration;
    }, 0);

    return Math.round(totalDuration / completed.length);
  }

  /**
   * Get success rate percentage
   */
  getSuccessRate() {
    if (this.executions.length === 0) return 0;
    const succeeded = this.executions.filter(e => e.outcome === 'success').length;
    return Math.round((succeeded / this.executions.length) * 100);
  }

  /**
   * Get recent executions
   * @param {number} limit - Number of executions
   * @returns {Array} Recent executions
   */
  getRecent(limit = 10) {
    return this.listExecutions({ limit });
  }

  /**
   * Get executions by outcome (complete, running, error)
   * @param {string} outcome - 'success', 'failed', or 'running'
   * @param {number} limit - Limit
   * @returns {Array} Filtered executions
   */
  getByOutcome(outcome, limit = 100) {
    if (outcome === 'running') {
      return Array.from(this.runningExecutions.values()).slice(0, limit);
    }
    return this.listExecutions({ outcome, limit });
  }

  /**
   * Cancel running execution
   * @param {string} executionId - Execution ID
   * @returns {boolean} Success
   */
  async cancelExecution(executionId) {
    if (!this.runningExecutions.has(executionId)) {
      throw new Error(`Execution not running: ${executionId}`);
    }

    const execution = this.runningExecutions.get(executionId);
    execution.status = 'cancelled';
    execution.outcome = 'failed';
    execution.completedAt = new Date().toISOString();

    this.runningExecutions.delete(executionId);

    // Update in persisted executions
    const index = this.executions.findIndex(e => e.id === executionId);
    if (index !== -1) {
      this.executions[index] = execution;
      await this.saveExecutions();
    }

    this.logger?.info('Execution cancelled', { executionId });
    return true;
  }

  /**
   * Clear execution history
   * @param {Object} options - Filter options
   * @returns {number} Cleared count
   */
  async clearHistory(options = {}) {
    const initialCount = this.executions.length;

    // Filter what to keep
    if (options.daysToKeep) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.daysToKeep);

      this.executions = this.executions.filter(e =>
        new Date(e.completedAt || e.startedAt) > cutoffDate
      );
    }

    const clearedCount = initialCount - this.executions.length;
    await this.saveExecutions();

    this.logger?.info('Execution history cleared', { clearedCount });
    return clearedCount;
  }
}

module.exports = WorkflowExecutor;
