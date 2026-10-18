/**
 * @fileoverview Workflow Bridge Service
 * Bridge service that wraps nooblyjs-core workflow and scheduling services
 * while maintaining API compatibility with the existing application.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const { v4: uuidv4 } = require('uuid');
const { sanitizeDirectoryName, validateWorkflowPath } = require('../utils/pathSanitizer');
const { DEFINITION_FILE_RE, definitionFilesIn } = require('../utils/workflowDefinitionFiles');
const { summarizeExecution, classifyExecution } = require('./executionSummary');

/**
 * Resolve a step path relative to a base directory.
 * If the step path is already absolute, return it as-is.
 * If relative, join it with the base directory.
 * @param {string} baseDir - The workflow's directory
 * @param {string} stepPath - The step path (absolute or relative)
 * @returns {string} The resolved absolute path
 */
function resolveStepPath(baseDir, stepPath) {
  if (path.isAbsolute(stepPath)) {
    return stepPath;
  }
  return path.join(baseDir, stepPath);
}

// Separator used to build hierarchical group labels: "<folder> / <suffix>".
const GROUP_SEPARATOR = ' / ';

// Which files hold definitions (`workflow-definition[-<suffix>].json`) lives in
// utils/workflowDefinitionFiles.js, because the worker-thread activity that runs
// SCHEDULED workflows re-reads them off disk and must apply the identical rule.

// Standard 5-field cron ranges. These mirror the core scheduler's parser
// (nooblyjs-core/src/scheduling/providers/cronExpression.js) so the
// bridge rejects exactly what startCron() would reject — keep in sync with core.
const CRON_FIELDS = [
  { name: 'minute',     min: 0, max: 59 },
  { name: 'hour',       min: 0, max: 23 },
  { name: 'dayOfMonth', min: 1, max: 31 },
  { name: 'month',      min: 1, max: 12 },
  { name: 'dayOfWeek',  min: 0, max: 6  }
];

// How often the reconciler re-checks schedules for a missed fire.
const RECONCILE_TICK_MS = 60 * 1000;

// How far past `nextRun` a schedule must be before the reconciler treats the
// fire as missed. Covers ordinary tick jitter and the gap between a run being
// dispatched and the callback that advances nextRun.
const DEFAULT_CATCHUP_GRACE_MS = 2 * 60 * 1000;

// Gap between catch-up runs dispatched in the same pass, so a backend that
// comes back up with several overdue nightly workflows doesn't start them all
// at once.
const DEFAULT_CATCHUP_STAGGER_MS = 20 * 1000;

/**
 * Derive the UI group label for a workflow.
 * An explicit `group` on the definition always wins; otherwise a file suffix
 * produces a hierarchical "<folder> / <suffix>" label, and a bare definition
 * file falls back to the folder name (the original behaviour).
 * @param {string} folderName - The workflow folder (directory) name
 * @param {string|undefined} suffix - Suffix captured from the definition filename
 * @param {string} [explicitGroup] - Optional `group` override from the definition
 * @returns {string} The resolved group label
 */
function deriveGroup(folderName, suffix, explicitGroup) {
  if (explicitGroup) return explicitGroup;
  return suffix ? `${folderName}${GROUP_SEPARATOR}${suffix}` : folderName;
}

/**
 * Map a group label back to the folder and definition filename that hold it.
 * Hierarchical groups ("<folder> / <suffix>") map to
 * `workflow-definition-<suffix>.json`; a plain group maps to the folder's
 * `workflow-definition.json`.
 * @param {string} group - The group label
 * @returns {{ folder: string, fileName: string }}
 */
function resolveDefinitionTarget(group) {
  const sepIndex = group.indexOf(GROUP_SEPARATOR);
  if (sepIndex === -1) {
    return { folder: sanitizeDirectoryName(group), fileName: 'workflow-definition.json' };
  }
  const folder = sanitizeDirectoryName(group.slice(0, sepIndex));
  const suffix = sanitizeDirectoryName(group.slice(sepIndex + GROUP_SEPARATOR.length));
  return { folder, fileName: `workflow-definition-${suffix}.json` };
}

/**
 * Simple Mutex for preventing concurrent file writes
 * Ensures only one write operation at a time per file
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

/**
 * WorkflowBridge - Bridges core services with application API requirements
 * Provides workflow CRUD, execution, and scheduling functionality using
 * nooblyjs-core services while maintaining filesystem persistence.
 */
class WorkflowBridge {
  /**
   * Creates a new WorkflowBridge instance.
   * @param {Object} options - Configuration options
   * @param {Object} options.workflowService - Core workflow service instance
   * @param {Object} options.schedulingService - Core scheduling service instance
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.eventEmitter - Event emitter for broadcasting events
   */
  constructor(options = {}) {
    this.workflowService = options.workflowService;
    this.schedulingService = options.schedulingService;
    this.logger = options.logger;
    this.eventEmitter = options.eventEmitter;
    this.executionHistoryLimit = options.executionHistoryLimit || 1000;

    // Verify we're using the passed-in services, not creating new ones
    this.logger?.info('WorkflowBridge constructor', {
      hasWorkflowService: !!this.workflowService,
      hasSchedulingService: !!this.schedulingService,
      workflowServiceType: this.workflowService?.constructor?.name,
      schedulingServiceType: this.schedulingService?.constructor?.name
    });

    // Filesystem paths — workflow definitions live in this repo's
    // workflows/ folder (<repo root>/workflows).
    // Override with WORKFLOWS_PATH env let if located elsewhere.
    this.workflowsPath = process.env.WORKFLOWS_PATH
      || path.resolve(__dirname, '../../../workflows');
    this.appBaseDir = options.appBaseDir || path.join(process.cwd(), '.application');
    this.metadataFile = path.join(this.appBaseDir, 'workflow', 'workflows-metadata.json');
    this.schedulesFile = path.join(this.appBaseDir, 'workflow', 'workflows.schedules.json');
    this.executionsDir = path.join(this.appBaseDir, 'workflow', 'executions');

    // In-memory caches
    this.workflows = new Map();
    this.metadata = {};
    this.schedules = [];
    this.activeSchedules = new Map();
    this.executions = []; // Store execution history (today only, in-memory, flattened across workflows)
    this._loadedDay = new Date().toISOString().slice(0, 10);
    // Records must be sanitized into a filesystem-safe workflow id before they
    // decide which per-workflow file they belong to. A record with no id at all
    // lands in this bucket file so it is never silently dropped.
    this._unassignedBucket = '_unassigned';

    // Initialization tracking — allows consumers to await readiness
    this.initialized = false;
    this._readyResolve = null;
    this._readyPromise = new Promise(resolve => { this._readyResolve = resolve; });

    // Mutexes for preventing concurrent file writes (race conditions)
    this.metadataMutex = new Mutex();
    this.schedulesMutex = new Mutex();
    this.executionsMutex = new Mutex();

    // Schedule reconciler — repairs stale nextRun values and replays fires
    // that were missed while the backend was down. See reconcileSchedules().
    this._reconcileTimer = null;
    this._reconciling = false;
    this.catchUpEnabled = String(process.env.SCHEDULE_CATCHUP || '').toLowerCase() !== 'off';
    this.catchUpGraceMs = parseInt(process.env.SCHEDULE_CATCHUP_GRACE_MS, 10) || DEFAULT_CATCHUP_GRACE_MS;
    this.catchUpStaggerMs = Number.isFinite(parseInt(process.env.SCHEDULE_CATCHUP_STAGGER_MS, 10))
      ? parseInt(process.env.SCHEDULE_CATCHUP_STAGGER_MS, 10)
      : DEFAULT_CATCHUP_STAGGER_MS;

    this.initialized = false;
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
   * per-workflow file name. Records written by different paths stamp the
   * workflow differently (id, sanitized name, or only a display name), so this
   * normalises them all to the same key a file is named after.
   * @private
   */
  _executionFileKey(record) {
    const raw = (record && (record.workflowId || record.workflowName || record.name)) || '';
    const key = sanitizeDirectoryName(String(raw));
    return key || this._unassignedBucket;
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
   * Read + parse a JSON array file, tolerating corruption. A file truncated by
   * an interrupted write (the "Unterminated string in JSON" production failure)
   * must never take down the whole screen: log it, quarantine the bad file so
   * it can be inspected, and carry on with an empty array for that partition.
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
        bytes: raw.length,
        error: parseErr.message
      });
      try {
        await fs.rename(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch (renameErr) {
        this.logger?.warn('Could not quarantine corrupt execution file', {
          file: filePath,
          error: renameErr.message
        });
      }
      return [];
    }
  }

  /**
   * Atomically write a JSON array: write to a unique temp file in the same
   * directory, then rename over the target. rename() is atomic on the same
   * filesystem, so a reader (or a crash) never observes a half-written file —
   * which is the root cause of the truncated 21 MB file seen in production.
   * @private
   */
  async _writeJsonArrayAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
    const payload = JSON.stringify(data, null, 2);
    try {
      await fs.writeFile(tmp, payload);
      await fs.rename(tmp, filePath);
    } catch (err) {
      try { await fs.unlink(tmp); } catch { /* temp already gone */ }
      throw err;
    }
  }

  /**
   * Load ALL executions for a specific day, merged across every per-workflow
   * file. A day with no directory (or a legacy flat file, see migration)
   * answers empty.
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
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const arrays = [];
    for (const f of jsonFiles) {
      arrays.push(await this._readJsonArray(path.join(dayDir, f)));
    }
    return arrays.flat();
  }

  /**
   * Load ONE workflow's executions for a specific day. Reads a single small
   * file rather than the whole day — this is what keeps a per-workflow history
   * scan bounded regardless of how busy a neighbouring workflow was.
   * @private
   */
  async _loadWorkflowDayFile(dateKey, workflowKey) {
    return this._readJsonArray(this._getWorkflowFilePath(dateKey, workflowKey));
  }

  /**
   * List the per-workflow file keys present for a given day.
   * @private
   */
  async _listDayWorkflowKeys(dateKey) {
    try {
      const files = await fs.readdir(this._getDayDirPath(dateKey));
      return files.filter(f => f.endsWith('.json')).map(f => f.slice(0, -'.json'.length));
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  /**
   * List all available execution days (directories named YYYY-MM-DD).
   * @private
   */
  async _listAvailableDays() {
    try {
      const entries = await fs.readdir(this.executionsDir, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
        .map(e => e.name)
        .sort();
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      throw e;
    }
  }

  /**
   * Initialize the bridge service - load workflows and schedules from filesystem
   */
  async initialize() {
    try {
      // Ensure directories exist
      await fs.mkdir(this.workflowsPath, { recursive: true });
      await fs.mkdir(path.dirname(this.metadataFile), { recursive: true });
      await fs.mkdir(this.executionsDir, { recursive: true });

      // Set up global executor for wrapper scripts to call back
      // This allows the core scheduling service's worker threads to execute workflows
      global.workflowBridgeExecutor = async (workflowId, input) => {
        try {
          const execution = await this.executeWorkflow(workflowId, input);
          return {
            status: execution.outcome === 'completed' ? 'success' : 'error',
            outcome: execution.outcome,
            result: execution.result,
            error: execution.error,
            duration: execution.duration,
            executedAt: execution.completedAt
          };
        } catch (error) {
          return {
            status: 'error',
            outcome: 'failed',
            error: error.message
          };
        }
      };

      this.logger?.debug('WorkflowBridge executor registered globally');

      // Load workflows from filesystem
      await this.loadWorkflows();

      // Load metadata
      await this.loadMetadata();

      // Load schedules
      await this.loadSchedules();

      // Migrate old execution history to per-day files (no-op if already migrated)
      await this.migrateOldExecutions();

      // Load today's execution history
      await this.loadTodayExecutions();

      // Reactivate enabled schedules
      await this.reactivateSchedules();

      // Repair any nextRun left in the past by a fire missed while we were
      // down, and replay those fires. Must run AFTER reactivateSchedules() so
      // the core scheduler already knows about every task.
      await this.reconcileSchedules({ startup: true });
      this.startScheduleReconciler();

      this.initialized = true;
      this._readyResolve();
      this.logger?.info('WorkflowBridge initialized', {
        workflowCount: this.workflows.size,
        scheduleCount: this.schedules.length,
        executionCount: this.executions.length
      });
    } catch (error) {
      this.logger?.error('Failed to initialize WorkflowBridge', { error: error.message });
      this.initialized = true; // Allow service to start even with errors
      this._readyResolve();
    }
  }

  /**
   * Returns a promise that resolves when initialization is complete.
   * Safe to call multiple times — resolves immediately if already initialized.
   */
  whenReady() {
    return this._readyPromise;
  }

  // ============================================
  // WORKFLOW CRUD OPERATIONS
  // ============================================


  /**
   * Load workflows from data-workflows directory
   */
  async loadWorkflows() {
    try {
      const entries = await fs.readdir(this.workflowsPath, { withFileTypes: true });
      this.workflows.clear();

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const workflowDir = path.join(this.workflowsPath, entry.name);

        // A folder may hold several definition files: the bare
        // workflow-definition.json plus any workflow-definition-<suffix>.json,
        // each mapping to a sub-group.
        let dirEntries;
        try {
          dirEntries = await fs.readdir(workflowDir);
        } catch (error) {
          this.logger?.warn(`Failed to read workflow folder "${entry.name}": ${error.message}`);
          continue;
        }

        const definitionFiles = definitionFilesIn(dirEntries);

        for (const { fileName, suffix } of definitionFiles) {
          const definitionFile = path.join(workflowDir, fileName);

          try {
            const data = await fs.readFile(definitionFile, 'utf8');
            const parsed = JSON.parse(data);

            // Support both array (new format) and single object (old format)
            const definitions = Array.isArray(parsed) ? parsed : [parsed];

            // Track workflow IDs in this file to detect duplicates
            const fileWorkflowIds = new Set();

            for (let index = 0; index < definitions.length; index++) {
              const definition = definitions[index];

              if (!definition.name) {
                this.logger?.warn('Workflow definition missing name, skipping', {
                  group: entry.name,
                  file: fileName,
                  index
                });
                continue;
              }

              // Use sanitized workflow name as the unique ID
              const workflowId = sanitizeDirectoryName(definition.name);

              // Check for duplicate workflow names within the same file
              if (fileWorkflowIds.has(workflowId)) {
                this.logger?.warn('Duplicate workflow name in file, skipping', {
                  group: entry.name,
                  file: fileName,
                  workflowName: definition.name,
                  workflowId
                });
                continue;
              }
              fileWorkflowIds.add(workflowId);

              // IDs are global (the sanitized name); warn if a name collides
              // across files/folders so the shadowing is visible.
              if (this.workflows.has(workflowId)) {
                this.logger?.warn('Duplicate workflow name across definition files, overwriting', {
                  workflowName: definition.name,
                  workflowId,
                  file: fileName,
                  previousFile: this.workflows.get(workflowId).sourceFile
                });
              }

              const group = deriveGroup(entry.name, suffix, definition.group);

              const workflow = {
                id: workflowId,
                name: definition.name,
                group,
                description: definition.description || '',
                steps: definition.steps || [],
                tags: definition.tags || [],
                defaultInput: definition.defaultInput || {},
                createdAt: definition.createdAt || new Date().toISOString(),
                updatedAt: definition.updatedAt || new Date().toISOString(),
                path: workflowDir,
                directoryName: entry.name,
                sourceFile: fileName,
                starred: definition.starred || false,
                lastViewed: null
              };

              this.workflows.set(workflowId, workflow);

              // Register with core workflow service if steps are file paths
              if (this.workflowService && Array.isArray(definition.steps)) {
                const stepPaths = definition.steps
                  .filter(step => typeof step === 'string')
                  .map(step => resolveStepPath(workflowDir, step));

                if (stepPaths.length > 0) {
                  try {
                    await this.workflowService.defineWorkflow(workflowId, stepPaths, {
                      description: definition.description,
                      tags: definition.tags
                    });

                    this.logger?.info(`Workflow registered with core service: ${workflowId} (${group})`);
                  } catch (err) {
                    this.logger?.warn(`Failed to register workflow with core service: ${workflowId} - ${err.message}`);
                  }
                }
              }

              this.logger?.info(`Loaded workflow: ${workflow.name} (${workflowId}) from ${fileName}`);
            }
          } catch (error) {
            this.logger?.warn(`Failed to load workflow definition from "${entry.name}/${fileName}": ${error.message}`);
          }
        }
      }

      return Array.from(this.workflows.values());
    } catch (error) {
      this.logger?.error(`Failed to load workflows: ${error.message}`);
      throw error;
    }
  }

  /**
   * Load metadata (starred, lastViewed)
   */
  async loadMetadata() {
    try {
      const data = await fs.readFile(this.metadataFile, 'utf8');
      this.metadata = JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.metadata = {};
      } else {
        this.logger?.warn('Failed to load metadata', { error: error.message });
      }
    }

    // Apply metadata to workflows
    for (const [id, workflow] of this.workflows) {
      const meta = this.metadata[id];
      if (meta) {
        workflow.starred = meta.starred !== undefined ? meta.starred : workflow.starred;
        workflow.lastViewed = meta.lastViewed || null;
      }
    }
  }

  /**
   * Save metadata to file (with mutex lock to prevent concurrent writes)
   */
  async saveMetadata() {
    await this.metadataMutex.lock();
    try {
      const dir = path.dirname(this.metadataFile);
      await fs.mkdir(dir, { recursive: true });

      const metadata = {};
      for (const [id, workflow] of this.workflows) {
        metadata[id] = {
          starred: workflow.starred,
          lastViewed: workflow.lastViewed
        };
      }

      await fs.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));
    } catch (error) {
      this.logger?.error('Failed to save metadata', { error: error.message });
      throw error;
    } finally {
      this.metadataMutex.unlock();
    }
  }

  /**
   * Create new workflow
   * @param {Object} workflowData - Workflow data { name, description, steps, tags, group }
   * @returns {Object} Created workflow
   */
  async createWorkflow(workflowData) {
    try {
      this.validateWorkflow(workflowData);

      // Use group parameter or sanitize name as group
      const group = workflowData.group || sanitizeDirectoryName(workflowData.name);

      // A hierarchical group ("<folder> / <suffix>") targets a suffixed
      // definition file inside the folder; a plain group uses the bare file.
      const { folder, fileName } = resolveDefinitionTarget(group);
      const workflowDir = path.join(this.workflowsPath, folder);
      const definitionFile = path.join(workflowDir, fileName);

      // Read existing workflows in this group (or empty array for new group)
      let existingDefinitions = [];
      try {
        const data = await fs.readFile(definitionFile, 'utf8');
        const parsed = JSON.parse(data);
        existingDefinitions = Array.isArray(parsed) ? parsed : [parsed];
      } catch (error) {
        // Group doesn't exist - create directories
        if (error.code === 'ENOENT') {
          await fs.mkdir(workflowDir, { recursive: true });
          await fs.mkdir(path.join(workflowDir, 'steps'), { recursive: true });
        } else {
          throw error;
        }
      }

      // Use sanitized workflow name as the unique ID
      const workflowId = sanitizeDirectoryName(workflowData.name);

      // Workflow IDs are global (derived from the name), so a name must be
      // unique across every definition file, not just the target one.
      if (this.workflows.has(workflowId)) {
        const existing = this.workflows.get(workflowId);
        throw new Error(`A workflow with the name "${workflowData.name}" already exists in group "${existing.group}". Workflow names must be unique.`);
      }
      if (existingDefinitions.some(w => sanitizeDirectoryName(w.name) === workflowId)) {
        throw new Error(`A workflow with the name "${workflowData.name}" already exists in group "${group}". Workflow names must be unique within a group.`);
      }

      // Create step files from step configurations
      const stepPaths = [];
      for (let i = 0; i < workflowData.steps.length; i++) {
        const step = workflowData.steps[i];
        const stepFileName = `${workflowId}-step-${i + 1}-${sanitizeDirectoryName(step.name || 'step')}.js`;
        const stepFilePath = path.join(workflowDir, 'steps', stepFileName);

        // Generate step file content
        const stepContent = this.generateStepFile(step);
        await fs.writeFile(stepFilePath, stepContent);

        stepPaths.push(`steps/${stepFileName}`);
      }

      // Create workflow definition (workflow name is the unique identifier)
      const definition = {
        name: workflowData.name,
        description: workflowData.description || '',
        steps: stepPaths,
        tags: workflowData.tags || [],
        defaultInput: workflowData.defaultInput || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        starred: false
      };

      // Add to array and save
      existingDefinitions.push(definition);
      await fs.writeFile(definitionFile, JSON.stringify(existingDefinitions, null, 2));

      // Create workflow object
      const workflow = {
        ...definition,
        id: workflowId,
        group,
        path: workflowDir,
        directoryName: folder,
        sourceFile: fileName,
        lastViewed: null
      };

      this.workflows.set(workflowId, workflow);
      await this.saveMetadata();

      // Register with core workflow service
      if (this.workflowService) {
        const absoluteStepPaths = stepPaths.map(p => resolveStepPath(workflowDir, p));
        try {
          await this.workflowService.defineWorkflow(workflowId, absoluteStepPaths, {
            description: definition.description,
            tags: definition.tags
          });
        } catch (err) {
          this.logger?.warn('Failed to register workflow with core service', { error: err.message });
        }
      }

      this.logger?.info('Workflow created', {
        id: workflow.id,
        name: workflow.name,
        group: workflow.group
      });

      return workflow;
    } catch (error) {
      this.logger?.error('Failed to create workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate step file content from step configuration
   */
  generateStepFile(step) {
    const config = step.config || {};
    const type = config.type || 'identity';

    let content = `/**
 * Workflow Step: ${step.name || 'Unnamed Step'}
 * Type: ${type}
 * Generated by WorkflowBridge
 */

'use strict';

`;

    switch (type) {
      case 'identity':
        content += `module.exports = async function(input) {
  // Identity step - pass through input unchanged
  return input;
};
`;
        break;

      case 'delay':
        const duration = config.duration || 1000;
        content += `module.exports = async function(input) {
  // Delay step - wait for ${duration}ms
  await new Promise(resolve => setTimeout(resolve, ${duration}));
  return { ...input, delayed: true, duration: ${duration} };
};
`;
        break;

      case 'transform':
        const script = config.script || 'input';
        content += `module.exports = async function(input) {
  // Transform step - execute transformation
  try {
    const result = ${script};
    return result;
  } catch (error) {
    throw new Error('Transform failed: ' + error.message);
  }
};
`;
        break;

      case 'conditional':
        const condition = config.condition || 'true';
        content += `module.exports = async function(input) {
  // Conditional step - evaluate condition
  const context = input;
  try {
    const result = ${condition};
    return { ...input, condition: result, conditionMet: !!result };
  } catch (error) {
    throw new Error('Condition evaluation failed: ' + error.message);
  }
};
`;
        break;

      case 'api':
        const endpoint = config.endpoint || '';
        const method = config.method || 'GET';
        const headers = JSON.stringify(config.headers || {});
        const body = config.body ? JSON.stringify(config.body) : 'null';
        content += `module.exports = async function(input) {
  // API step - make HTTP request
  const endpoint = '${endpoint}'.replace(/\\$\\{([^}]+)\\}/g, (match, key) => input[key] || match);

  const fetchOptions = {
    method: '${method}',
    headers: { 'Content-Type': 'application/json', ...${headers} }
  };

  if (['POST', 'PUT', 'PATCH'].includes('${method}')) {
    const bodyData = ${body};
    if (bodyData) {
      fetchOptions.body = JSON.stringify(bodyData).replace(/\\$\\{([^}]+)\\}/g, (match, key) => input[key] || match);
    }
  }

  const response = await fetch(endpoint, fetchOptions);

  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ': ' + response.statusText);
  }

  const contentType = response.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return {
    ...input,
    api: true,
    success: true,
    endpoint: endpoint,
    method: '${method}',
    status: response.status,
    data: data
  };
};
`;
        break;

      case 'parallel':
        content += `module.exports = async function(input) {
  // Parallel step - execute multiple operations concurrently
  // Note: Parallel steps require special handling in workflow execution
  return { ...input, parallel: true };
};
`;
        break;

      default:
        content += `module.exports = async function(input) {
  // Unknown step type: ${type}
  return input;
};
`;
    }

    return content;
  }

  /**
   * Get workflow by ID
   * @returns {Object|null} Workflow object or null if not found
   */
  getWorkflow(workflowId) {
    return this.workflows.get(workflowId) || null;
  }

  /**
   * Get detailed step information for a workflow
   * Converts file path steps to step objects for frontend compatibility
   * @param {string} workflowId - Workflow ID
   * @returns {Promise<Array>} Array of step objects with name, type, config
   */
  async getDetailedSteps(workflowId) {
    const workflow = this.getWorkflow(workflowId);
    let steps = workflow.steps;

    // Read the latest workflow definition from disk to get any recently added steps
    try {
      const workflowDefPath = path.join(workflow.path, 'workflow-definition.json');
      const workflowDef = JSON.parse(await fs.readFile(workflowDefPath, 'utf-8'));
      if (workflowDef.steps && Array.isArray(workflowDef.steps)) {
        steps = workflowDef.steps;
      }
    } catch (err) {
      // If we can't read the file, use the cached steps
      this.logger?.warn('Could not read workflow definition for getDetailedSteps', {
        workflowId,
        error: err.message
      });
    }

    const detailedSteps = [];

    for (let i = 0; i < steps.length; i++) {
      const stepPath = steps[i];

      // Extract step name from file path
      // e.g., "steps/step-1-example-task.js" -> "Step 1 Example Task"
      const fileName = path.basename(stepPath, '.js');
      const stepName = fileName
        .replace(/^step-\d+-/, '')  // Remove "step-N-" prefix
        .replace(/-/g, ' ')          // Replace dashes with spaces
        .replace(/\b\w/g, c => c.toUpperCase());  // Capitalize words

      // Try to determine step type by reading the file
      let stepType = 'identity';
      let stepConfig = {};

      try {
        const fullPath = resolveStepPath(workflow.path, stepPath);
        const content = await fs.readFile(fullPath, 'utf8');

        // Try to detect step type from content
        if (content.includes('setTimeout') || content.includes('delay')) {
          stepType = 'delay';
          // Try to extract duration
          const durationMatch = content.match(/setTimeout\s*\([^,]+,\s*(\d+)\)/);
          if (durationMatch) {
            stepConfig.duration = parseInt(durationMatch[1]);
          }
        } else if (content.includes('fetch(') || content.includes('api')) {
          stepType = 'api';
          // Try to extract endpoint
          const endpointMatch = content.match(/endpoint\s*=\s*['"]([^'"]+)['"]/);
          if (endpointMatch) {
            stepConfig.endpoint = endpointMatch[1];
          }
          const methodMatch = content.match(/method:\s*['"](\w+)['"]/);
          if (methodMatch) {
            stepConfig.method = methodMatch[1];
          }
        } else if (content.includes('condition') || content.includes('conditionMet')) {
          stepType = 'conditional';
        } else if (content.includes('Promise.all') || content.includes('parallel')) {
          stepType = 'parallel';
        } else if (content.includes('transform') || content.includes('result =')) {
          stepType = 'transform';
          // Try to extract script
          const scriptMatch = content.match(/const\s+result\s*=\s*(.+?);/);
          if (scriptMatch) {
            stepConfig.script = scriptMatch[1].trim();
          }
        }
      } catch (err) {
        // If file can't be read, default to identity
        this.logger?.warn('Could not read step file for type detection', {
          stepPath,
          error: err.message
        });
      }

      detailedSteps.push({
        id: `step-${i + 1}`,
        name: stepName || `Step ${i + 1}`,
        type: stepType,
        config: stepConfig,
        filePath: stepPath,
        order: i + 1
      });
    }

    return detailedSteps;
  }

  /**
   * Update workflow
   */
  async updateWorkflow(workflowId, updates) {
    try {
      const workflow = this.getWorkflow(workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }

      // Validate merged data
      const merged = {
        name: updates.name || workflow.name,
        description: updates.description !== undefined ? updates.description : workflow.description,
        steps: updates.steps || workflow.steps,
        tags: updates.tags || workflow.tags
      };

      if (updates.steps) {
        this.validateWorkflow(merged);
      }

      // Update workflow object
      if (updates.name) workflow.name = updates.name;
      if (updates.description !== undefined) workflow.description = updates.description;
      if (updates.tags) workflow.tags = updates.tags;
      if (updates.starred !== undefined) workflow.starred = updates.starred;
      if (updates.defaultInput !== undefined) workflow.defaultInput = updates.defaultInput;

      // If steps are being updated, regenerate step files
      if (updates.steps && Array.isArray(updates.steps)) {
        const stepsDir = path.join(workflow.path, 'steps');

        // Remove old step files
        try {
          const oldFiles = await fs.readdir(stepsDir);
          for (const file of oldFiles) {
            await fs.unlink(path.join(stepsDir, file));
          }
        } catch (err) {
          // Steps directory might not exist
        }

        await fs.mkdir(stepsDir, { recursive: true });

        // Create new step files
        const stepPaths = [];
        for (let i = 0; i < updates.steps.length; i++) {
          const step = updates.steps[i];
          const stepFileName = `step-${i + 1}-${sanitizeDirectoryName(step.name || 'step')}.js`;
          const stepFilePath = path.join(stepsDir, stepFileName);

          const stepContent = this.generateStepFile(step);
          await fs.writeFile(stepFilePath, stepContent);

          stepPaths.push(`steps/${stepFileName}`);
        }

        workflow.steps = stepPaths;

        // Update core workflow service
        if (this.workflowService) {
          const absoluteStepPaths = stepPaths.map(p => resolveStepPath(workflow.path, p));
          try {
            await this.workflowService.defineWorkflow(workflowId, absoluteStepPaths, {
              description: workflow.description,
              tags: workflow.tags
            });
          } catch (err) {
            this.logger?.warn('Failed to update workflow in core service', { error: err.message });
          }
        }
      }

      workflow.updatedAt = new Date().toISOString();

      // Read array of workflows from the file this workflow was loaded from
      const group = workflow.group || workflow.directoryName;
      const definitionFile = path.join(workflow.path, workflow.sourceFile || 'workflow-definition.json');
      const data = await fs.readFile(definitionFile, 'utf8');
      const parsed = JSON.parse(data);
      const definitions = Array.isArray(parsed) ? parsed : [parsed];

      // Find and update the workflow in the array (match by sanitized name)
      const index = definitions.findIndex(w => sanitizeDirectoryName(w.name) === workflowId);
      if (index === -1) {
        throw new Error(`Workflow not found in definition file: ${workflowId}`);
      }

      // Update the definition in the array
      definitions[index] = {
        name: workflow.name,
        description: workflow.description,
        steps: workflow.steps,
        tags: workflow.tags,
        defaultInput: workflow.defaultInput || {},
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
        starred: workflow.starred
      };

      // Save the entire array
      await fs.writeFile(definitionFile, JSON.stringify(definitions, null, 2));
      await this.saveMetadata();

      this.logger?.info('Workflow updated', {
        workflowId,
        name: workflow.name,
        group: workflow.group
      });
      return workflow;
    } catch (error) {
      this.logger?.error('Failed to update workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete workflow
   */
  async deleteWorkflow(workflowId) {
    try {
      const workflow = this.getWorkflow(workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }

      const group = workflow.group || workflow.directoryName;
      const definitionFile = path.join(workflow.path, workflow.sourceFile || 'workflow-definition.json');

      // Read array of workflows
      const data = await fs.readFile(definitionFile, 'utf8');
      const parsed = JSON.parse(data);
      const definitions = Array.isArray(parsed) ? parsed : [parsed];

      // Remove workflow from array (match by sanitized name)
      const remaining = definitions.filter(w => sanitizeDirectoryName(w.name) !== workflowId);

      if (remaining.length === 0) {
        // Last workflow in this definition file - remove the file itself.
        await fs.unlink(definitionFile);

        // Only remove the whole folder if no sibling definition files remain
        // (a folder may hold several sub-group files).
        let siblingDefinitions = [];
        try {
          siblingDefinitions = (await fs.readdir(workflow.path))
            .filter(fileName => DEFINITION_FILE_RE.test(fileName));
        } catch (err) {
          this.logger?.warn('Failed to inspect workflow folder after delete', {
            group,
            error: err.message
          });
        }

        if (siblingDefinitions.length === 0) {
          await this.removeDirectoryRecursive(workflow.path);
          this.logger?.info('Deleted workflow group directory', { group });
        } else {
          // Folder still has other sub-groups - just clean up this workflow's step files.
          await this.deleteStepFiles(workflow);
          this.logger?.info('Deleted workflow definition file', {
            group,
            file: workflow.sourceFile,
            remainingFiles: siblingDefinitions.length
          });
        }
      } else {
        // Other workflows exist in the same file - save remaining ones and delete this workflow's step files.
        await fs.writeFile(definitionFile, JSON.stringify(remaining, null, 2));
        await this.deleteStepFiles(workflow);

        this.logger?.info('Deleted workflow from group', {
          workflowId,
          group,
          remainingWorkflows: remaining.length
        });
      }

      // Remove from cache
      this.workflows.delete(workflowId);
      delete this.metadata[workflowId];
      await this.saveMetadata();

      // Delete any associated schedules
      this.schedules = this.schedules.filter(s => s.workflowId !== workflowId);
      await this.saveSchedules();

      this.logger?.info('Workflow deleted', { workflowId, group });
      return true;
    } catch (error) {
      this.logger?.error('Failed to delete workflow', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete the step files belonging to a single workflow (best-effort).
   * @param {Object} workflow - The workflow whose step files should be removed
   */
  async deleteStepFiles(workflow) {
    const stepFiles = workflow.steps || [];
    for (const stepPath of stepFiles) {
      if (typeof stepPath !== 'string') continue;
      const fullPath = resolveStepPath(workflow.path, stepPath);
      try {
        await fs.unlink(fullPath);
      } catch (err) {
        this.logger?.warn('Failed to delete step file', {
          path: stepPath,
          error: err.message
        });
      }
    }
  }

  /**
   * Recursively remove directory
   */
  async removeDirectoryRecursive(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await this.removeDirectoryRecursive(fullPath);
      } else {
        await fs.unlink(fullPath);
      }
    }

    await fs.rmdir(dirPath);
  }

  /**
   * List workflows with filters
   */
  listWorkflows(options = {}) {
    let result = Array.from(this.workflows.values());

    if (options.starred) {
      result = result.filter(w => w.starred);
    }

    if (options.tags && Array.isArray(options.tags) && options.tags.length > 0) {
      result = result.filter(w =>
        options.tags.some(tag => w.tags.includes(tag))
      );
    }

    result.sort((a, b) => a.name.localeCompare(b.name));

    const limit = options.limit || 100;
    const offset = options.offset || 0;
    return result.slice(offset, offset + limit);
  }

  /**
   * Search workflows
   */
  searchWorkflows(query) {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.workflows.values()).filter(w =>
      w.name.toLowerCase().includes(lowerQuery) ||
      w.description.toLowerCase().includes(lowerQuery) ||
      w.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  /**
   * Get recently viewed workflows
   */
  getRecentlyViewed(limit = 10) {
    return Array.from(this.workflows.values())
      .filter(w => w.lastViewed)
      .sort((a, b) => new Date(b.lastViewed) - new Date(a.lastViewed))
      .slice(0, limit);
  }

  /**
   * Get starred workflows
   */
  getStarred(limit = 10) {
    return Array.from(this.workflows.values())
      .filter(w => w.starred)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /**
   * Toggle star status
   */
  async toggleStar(workflowId, starred) {
    const workflow = this.getWorkflow(workflowId);
    workflow.starred = starred;
    await this.saveMetadata();
    this.logger?.info('Workflow star toggled', { workflowId, starred });
    return workflow;
  }

  /**
   * Mark workflow as viewed
   */
  async markAsViewed(workflowId) {
    const workflow = this.getWorkflow(workflowId);
    workflow.lastViewed = new Date().toISOString();
    await this.saveMetadata();
    return workflow;
  }

  /**
   * Export workflow
   */
  exportWorkflow(workflowId) {
    const workflow = this.getWorkflow(workflowId);
    return {
      name: workflow.name,
      description: workflow.description,
      steps: workflow.steps,
      tags: workflow.tags,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt
    };
  }

  /**
   * Import workflow
   */
  async importWorkflow(workflowData) {
    return await this.createWorkflow(workflowData);
  }

  /**
   * Validate workflow data
   */
  validateWorkflow(workflowData) {
    const errors = [];

    if (!workflowData.name || typeof workflowData.name !== 'string' || workflowData.name.trim() === '') {
      errors.push('Workflow name is required and must be a non-empty string');
    }

    if (workflowData.name && workflowData.name.length > 100) {
      errors.push('Workflow name must be 100 characters or less');
    }

    if (!Array.isArray(workflowData.steps)) {
      errors.push('Workflow steps must be an array');
    } else if (workflowData.steps.length === 0) {
      errors.push('Workflow must have at least one step');
    } else if (workflowData.steps.length > 100) {
      errors.push('Workflow cannot have more than 100 steps');
    }

    if (Array.isArray(workflowData.steps)) {
      workflowData.steps.forEach((step, index) => {
        // Steps can be either file paths (strings) or config objects
        if (typeof step === 'string') {
          // File path - validate it's not empty
          if (step.trim() === '') {
            errors.push(`Step ${index + 1}: file path cannot be empty`);
          }
        } else if (typeof step === 'object') {
          // Config object - validate structure
          if (!step.name || typeof step.name !== 'string') {
            errors.push(`Step ${index + 1}: name is required and must be a string`);
          }
        } else {
          errors.push(`Step ${index + 1}: must be a string (file path) or object (config)`);
        }
      });
    }

    if (workflowData.description && workflowData.description.length > 500) {
      errors.push('Workflow description must be 500 characters or less');
    }

    if (workflowData.tags && !Array.isArray(workflowData.tags)) {
      errors.push('Workflow tags must be an array');
    }

    if (errors.length > 0) {
      throw new Error(`Workflow validation failed: ${errors.join('; ')}`);
    }
  }

  // ============================================
  // WORKFLOW EXECUTION
  // ============================================

  /**
   * Execute a workflow
   * @param {string} workflowId - Workflow ID
   * @param {Object} input - Input data for workflow
   * @returns {Promise<Object>} Execution result
   */
  async executeWorkflow(workflowId, input = {}, executionId = uuidv4()) {
    const startTime = new Date();

    try {
      const workflow = this.getWorkflow(workflowId);

      // Use default input if provided input is empty
      const executionInput = Object.keys(input).length === 0 && workflow.defaultInput
        ? workflow.defaultInput
        : input;

      // Emit execution started event
      if (this.eventEmitter) {
        this.eventEmitter.emit('workflow:execution', {
          eventType: 'started',
          executionId,
          workflowId,
          workflowName: workflow.name,
          stepCount: workflow.steps.length
        });
      }

      // Use core workflow service to execute
      if (this.workflowService) {
        let result;
        const stepResults = [];

        try {
          this.logger?.info('Executing workflow via core service', {
            executionId,
            workflowId,
            workflowName: workflow.name,
            hasWorkflowService: !!this.workflowService
          });

          result = await new Promise((resolve, reject) => {
            this.workflowService.runWorkflow(workflowId, executionInput, (status) => {
              // Emit step events
              if (status.status === 'step_start') {
                if (this.eventEmitter) {
                  this.eventEmitter.emit('workflow:execution', {
                    eventType: 'step:started',
                    executionId,
                    stepName: status.stepName
                  });
                }
              } else if (status.status === 'step_end') {
                stepResults.push({
                  stepName: status.stepName,
                  status: 'completed',
                  result: status.data,
                  executedAt: new Date().toISOString()
                });
                if (this.eventEmitter) {
                  this.eventEmitter.emit('workflow:execution', {
                    eventType: 'step:completed',
                    executionId,
                    stepName: status.stepName
                  });
                }
              } else if (status.status === 'step_error') {
                stepResults.push({
                  stepName: status.stepName,
                  status: 'failed',
                  error: status.error,
                  executedAt: new Date().toISOString()
                });
                if (this.eventEmitter) {
                  this.eventEmitter.emit('workflow:execution', {
                    eventType: 'step:failed',
                    executionId,
                    stepName: status.stepName,
                    error: status.error
                  });
                }
              } else if (status.status === 'workflow_complete') {
                resolve(status.finalData);
              }
            }).catch(reject);
          });

          const endTime = new Date();
          const duration = endTime - startTime;

          const execution = {
            id: executionId,
            workflowId,
            name: workflow.name,
            startedAt: startTime.toISOString(),
            completedAt: endTime.toISOString(),
            status: 'completed',
            outcome: 'success',
            input: executionInput,
            result,
            steps: stepResults,
            error: null,
            duration
          };

          // Emit completion event
          if (this.eventEmitter) {
            this.eventEmitter.emit('workflow:execution', {
              eventType: 'completed',
              executionId,
              outcome: 'success',
              duration
            });
          }

          this.logger?.info('Workflow execution completed via core service', {
            executionId,
            workflowId,
            workflowId,
            outcome: 'success',
            duration: `${duration}ms`
          });

          // Store execution in history
          await this.addExecution(execution);

          return execution;

        } catch (error) {
          const endTime = new Date();
          const duration = endTime - startTime;

          const execution = {
            id: executionId,
            workflowId,
            name: workflow.name,
            startedAt: startTime.toISOString(),
            completedAt: endTime.toISOString(),
            status: 'failed',
            outcome: 'failed',
            input: executionInput,
            result: null,
            steps: stepResults,
            error: error.message,
            duration
          };

          // Emit failure event
          if (this.eventEmitter) {
            this.eventEmitter.emit('workflow:execution', {
              eventType: 'failed',
              executionId,
              error: error.message,
              duration
            });
          }

          this.logger?.error('Workflow execution failed', {
            executionId,
            workflowId,
            error: error.message
          });

          // Store execution in history
          await this.addExecution(execution);

          return execution;
        }
      } else {
        throw new Error('Workflow service not available');
      }
    } catch (error) {
      this.logger?.error('Workflow execution error', { executionId, error: error.message });
      throw error;
    }
  }

  /**
   * Resolve a workflow by its name (or sanitized id).
   * @param {string} name - Workflow name or id
   * @returns {Object|null} The workflow object, or null if not found
   */
  resolveWorkflowByName(name) {
    if (!name || typeof name !== 'string') return null;
    // Try direct id / sanitized-name lookup against the workflow map keys
    const direct = this.workflows.get(name) || this.workflows.get(sanitizeDirectoryName(name));
    if (direct) return direct;
    // Fall back to an exact display-name match
    for (const workflow of this.workflows.values()) {
      if (workflow.name === name) return workflow;
    }
    return null;
  }

  /**
   * Start a workflow asynchronously by name.
   * Records a "running" execution immediately and runs the workflow in the
   * background, so callers receive an execution id without waiting for the
   * workflow to finish. Poll getExecution(executionId) for the outcome.
   *
   * @param {string} workflowName - Workflow name (or sanitized id)
   * @param {Object} payload - Input data object passed to the workflow
   * @returns {Promise<Object>} { executionId, workflowId, workflowName, status, startedAt }
   */
  async startWorkflowByName(workflowName, payload = {}) {
    const workflow = this.resolveWorkflowByName(workflowName);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowName}`);
    }

    const workflowId = workflow.id || sanitizeDirectoryName(workflow.name);
    const executionId = uuidv4();
    const startedAt = new Date().toISOString();

    // Record a "running" placeholder so the status endpoint resolves immediately.
    await this.addExecution({
      id: executionId,
      workflowId,
      name: workflow.name,
      startedAt,
      completedAt: null,
      status: 'running',
      outcome: null,
      input: payload,
      result: null,
      steps: [],
      error: null,
      duration: null
    });

    // Run in the background — executeWorkflow upserts the final record over the
    // placeholder using the same executionId.
    this.executeWorkflow(workflowId, payload, executionId).catch(async (error) => {
      this.logger?.error('Async workflow execution failed', { executionId, error: error.message });
      try {
        await this.addExecution({
          id: executionId,
          workflowId,
          name: workflow.name,
          startedAt,
          completedAt: new Date().toISOString(),
          status: 'failed',
          outcome: 'failed',
          input: payload,
          result: null,
          steps: [],
          error: error.message,
          duration: null
        });
      } catch (recordError) {
        this.logger?.error('Failed to record async execution failure', {
          executionId,
          error: recordError.message
        });
      }
    });

    this.logger?.info('Workflow started asynchronously', { executionId, workflowId, workflowName: workflow.name });

    return { executionId, workflowId, workflowName: workflow.name, status: 'running', startedAt };
  }

  /**
   * Create a recurring schedule for a workflow, resolved by name.
   *
   * @param {string} workflowName - Workflow name (or sanitized id)
   * @param {string} cronExpression - Cron expression for the schedule
   * @param {Object} payload - Input data object passed to the workflow on each run
   * @param {string} [scheduleName] - Optional schedule name (auto-generated if omitted)
   * @returns {Promise<Object>} The created schedule
   */
  async scheduleWorkflowByName(workflowName, cronExpression, payload = {}, scheduleName) {
    const workflow = this.resolveWorkflowByName(workflowName);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowName}`);
    }

    const workflowId = workflow.id || sanitizeDirectoryName(workflow.name);

    return this.createSchedule({
      workflowId,
      name: scheduleName || `${workflow.name} (scheduled)`,
      cronExpression,
      input: payload,
      enabled: true
    });
  }

  /**
   * Get execution by ID - searches today first, then historical days
   */
  async getExecution(executionId) {
    const hit = this.executions.find(e => e.id === executionId);
    if (hit) return hit;
    const days = (await this._listAvailableDays()).reverse();
    const today = this._getTodayKey();
    for (const day of days) {
      if (day === today) continue;
      const found = (await this._loadDayFile(day)).find(e => e.id === executionId);
      if (found) return found;
    }
    return null;
  }

  /**
   * List executions with filters - can query today or historical days
   */
  async listExecutions(options = {}) {
    let result;

    if (options.date) {
      result = await this._loadDayFile(options.date);
    } else if (options.dateFrom || options.dateTo) {
      const days = await this._listAvailableDays();
      const filtered = days.filter(d =>
        (!options.dateFrom || d >= options.dateFrom) &&
        (!options.dateTo   || d <= options.dateTo)
      );
      const arrays = await Promise.all(filtered.map(d => this._loadDayFile(d)));
      result = arrays.flat();
    } else {
      result = [...this.executions];  // today only (in-memory, fast path)
    }

    // Filter by workflowId
    if (options.workflowId) result = result.filter(e => e.workflowId === options.workflowId);

    // Filter by status
    if (options.status)     result = result.filter(e => e.status === options.status);

    // Filter by outcome
    if (options.outcome)    result = result.filter(e => e.outcome === options.outcome);

    // Sort by most recent first
    result.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

    const limit = options.limit || 100;
    const offset = options.offset || 0;
    return result.slice(offset, offset + limit);
  }

  /**
   * List ONE workflow's execution history across the per-day files.
   *
   * listExecutions() answers from today only unless given an explicit date
   * range, and its 100-record page is shared by every workflow — so a workflow
   * running on a tight cadence pushes a quieter one's runs out of view and its
   * history looks lost. This walks the day files newest-first instead, and:
   *
   *  - reads ONE day file at a time (never Promise.all over the whole range,
   *    whose peak memory is every record's full `result` payload at once) and
   *    projects each match down to a summary immediately;
   *  - keeps only the newest `limit` matches for display, but keeps COUNTING
   *    the rest, so the stats describe the whole window rather than the page.
   *
   * @param {string} workflowId - Workflow id, sanitized name, or display name
   * @param {Object} [options]
   * @param {number} [options.days] - Look-back window in days; 0/omitted = every day on disk
   * @param {number} [options.limit=200] - Maximum rows returned
   * @param {string} [options.status] - Restrict rows to 'success' | 'failed' | 'running'
   * @returns {Promise<Object>} { workflow, executions, stats, window }
   */
  async listWorkflowExecutions(workflowId, options = {}) {
    const limit = options.limit > 0 ? options.limit : 200;
    const workflow = this.getWorkflow(workflowId) || this.resolveWorkflowByName(workflowId);

    // Records written by different paths stamp the workflow differently, and a
    // record whose workflow has since been renamed keeps the id it was run
    // under — so match on every identifier this workflow is known by.
    const ids = new Set([workflowId, sanitizeDirectoryName(workflowId)]);
    const names = new Set();
    if (workflow) {
      if (workflow.id) ids.add(workflow.id);
      if (workflow.name) {
        ids.add(sanitizeDirectoryName(workflow.name));
        names.add(workflow.name);
      }
    }
    const isMatch = (e) => {
      if (!e) return false;
      if (e.workflowId) return ids.has(e.workflowId);
      const name = e.workflowName || e.name;
      return name ? names.has(name) || ids.has(sanitizeDirectoryName(name)) : false;
    };

    const today = this._getTodayKey();
    const allDays = await this._listAvailableDays();           // ascending
    let from = null;
    if (options.days > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - (options.days - 1));
      from = cutoff.toISOString().slice(0, 10);
    }
    const days = new Set(allDays.filter(d => !from || d >= from));
    if (this.executions.length) days.add(today);   // today may not be on disk yet
    const scanned = [...days].sort().reverse();    // newest first

    // Per-workflow layout lets us read only the files that could hold a match
    // rather than the whole day. Collect the candidate file keys this workflow
    // is known by; a record with no id lives in the unassigned bucket, which we
    // must still scan (its display name may match by the `names` set below).
    const fileKeys = new Set([this._unassignedBucket]);
    for (const id of ids) {
      const k = sanitizeDirectoryName(String(id));
      if (k) fileKeys.add(k);
    }
    for (const name of names) {
      const k = sanitizeDirectoryName(String(name));
      if (k) fileKeys.add(k);
    }

    const rows = [];
    const counts = { total: 0, success: 0, failed: 0, running: 0, other: 0 };
    let selected = 0;   // matches passing options.status — rows is capped, this is not
    let durationSum = 0;
    let durationCount = 0;

    for (const day of scanned) {
      // Read only this workflow's candidate files for the day (small, bounded),
      // then fold in any of today's in-memory records not yet flushed to disk.
      const seen = new Set();
      let records = [];
      for (const key of fileKeys) {
        const fileRecords = await this._loadWorkflowDayFile(day, key);
        for (const r of fileRecords) {
          if (r && r.id) seen.add(r.id);
          records.push(r);
        }
      }
      if (day === today && this.executions.length) {
        records = records.concat(
          this.executions.filter(r => isMatch(r) && !(r.id && seen.has(r.id)))
        );
      }

      // Walk each day backwards: records are appended in start order, so this
      // keeps the collection newest-first overall. Capping `rows` mid-day the
      // other way round would keep a busy day's OLDEST runs and drop its latest.
      for (let i = records.length - 1; i >= 0; i--) {
        const record = records[i];
        if (!isMatch(record)) continue;
        const verdict = classifyExecution(record);
        counts.total += 1;
        counts[verdict] += 1;
        if (verdict === 'success' && record.duration) {
          durationSum += record.duration;
          durationCount += 1;
        }
        if (options.status && verdict !== options.status) continue;
        selected += 1;
        if (rows.length < limit) rows.push(summarizeExecution(record));
      }
    }

    rows.sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));

    return {
      workflow: workflow
        ? { id: workflow.id, name: workflow.name, group: workflow.group || workflow.directoryName || null }
        : { id: workflowId, name: workflowId, group: null },
      executions: rows,
      stats: {
        total: counts.total,
        succeeded: counts.success,
        failed: counts.failed,
        running: counts.running,
        averageDuration: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
        successRate: counts.total > 0 ? Math.round((counts.success / counts.total) * 100) : 0,
      },
      window: {
        days: options.days > 0 ? options.days : null,
        from: from || scanned[scanned.length - 1] || null,
        to: scanned[0] || null,
        daysScanned: scanned.length,
        daysAvailable: allDays.length,
        limit,
        matched: selected,
        truncated: selected > rows.length,
      },
    };
  }

  /**
   * Get execution statistics - can aggregate all days or specific date range
   */
  async getExecutionStats(options = {}) {
    let all;
    if (options.date) {
      all = await this._loadDayFile(options.date);
    } else if (options.dateFrom || options.dateTo) {
      const days = await this._listAvailableDays();
      const filtered = days.filter(d =>
        (!options.dateFrom || d >= options.dateFrom) &&
        (!options.dateTo   || d <= options.dateTo)
      );
      all = (await Promise.all(filtered.map(d => this._loadDayFile(d)))).flat();
    } else {
      // All days
      const days = await this._listAvailableDays();
      all = (await Promise.all(days.map(d => this._loadDayFile(d)))).flat();
    }
    if (options.workflowId) all = all.filter(e => e.workflowId === options.workflowId);

    const total = all.length;
    const completed = all.filter(e => e.status === 'completed').length;
    const failed = all.filter(e => e.status === 'failed').length;
    const running = this.executions.filter(e => e.status === 'running').length; // in-memory only
    const completedExecs = all.filter(e => e.status === 'completed' && e.duration);
    const averageDuration = completedExecs.length > 0
      ? Math.round(completedExecs.reduce((sum, e) => sum + e.duration, 0) / completedExecs.length) : 0;

    return {
      total, running, succeeded: completed, failed, averageDuration,
      successRate: total > 0 ? Math.round((completed / total) * 100) : 0
    };
  }

  // ============================================
  // SCHEDULING
  // ============================================

  /**
   * Load schedules from JSON file
   */
  async loadSchedules() {
    try {
      const data = await fs.readFile(this.schedulesFile, 'utf8');
      this.schedules = JSON.parse(data);
      return this.schedules;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.schedules = [];
        await this.saveSchedules();
        return [];
      }
      throw error;
    }
  }

  /**
   * Save schedules to JSON file (with mutex lock to prevent concurrent writes)
   */
  async saveSchedules() {
    await this.schedulesMutex.lock();
    try {
      const dir = path.dirname(this.schedulesFile);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.schedulesFile, JSON.stringify(this.schedules, null, 2));
    } catch (error) {
      this.logger?.error('Failed to save schedules', { error: error.message });
      throw error;
    } finally {
      this.schedulesMutex.unlock();
    }
  }

  /**
   * Load today's executions from file (in-memory cache for fast access)
   */
  async loadTodayExecutions() {
    this._loadedDay = this._getTodayKey();
    this.executions = await this._loadDayFile(this._loadedDay);
    this._dirtyWorkflowKeys = new Set();
    return this.executions;
  }

  /**
   * Append a batch of records to the correct per-day/per-workflow files,
   * de-duplicating by id against what is already on disk. Shared by both
   * migration paths.
   * @private
   */
  async _appendRecordsToLayout(records) {
    // Group by (day, workflowKey) so each target file is written once.
    const byTarget = new Map();
    for (const rec of records) {
      const day = (rec && rec.startedAt ? String(rec.startedAt) : new Date().toISOString()).slice(0, 10);
      const key = this._executionFileKey(rec);
      const targetKey = `${day}\u0000${key}`;
      if (!byTarget.has(targetKey)) byTarget.set(targetKey, { day, key, recs: [] });
      byTarget.get(targetKey).recs.push(rec);
    }
    for (const { day, key, recs } of byTarget.values()) {
      const filePath = this._getWorkflowFilePath(day, key);
      const existing = await this._readJsonArray(filePath);
      const knownIds = new Set(existing.map(e => e.id).filter(Boolean));
      const merged = existing.concat(recs.filter(r => !r.id || !knownIds.has(r.id)));
      await this._writeJsonArrayAtomic(filePath, merged);
    }
  }

  /**
   * Migrate legacy execution history to the per-day/per-workflow layout.
   * Runs once on startup and is a no-op when there is nothing to migrate.
   *
   * Two legacy shapes are handled:
   *   1. The original monolithic `workflows.executions.json` (all runs, one file).
   *   2. Flat per-day files `executions/<YYYY-MM-DD>.json` from the previous
   *      per-day (but not per-workflow) layout.
   *
   * Both are corruption-tolerant: a file that fails to parse is quarantined and
   * skipped rather than aborting startup (the truncated 21 MB production file
   * is exactly this case).
   */
  async migrateOldExecutions() {
    await fs.mkdir(this.executionsDir, { recursive: true });

    // --- 1. Monolithic file -------------------------------------------------
    const oldFile = path.join(path.dirname(this.executionsDir), 'workflows.executions.json');
    let monolithic = null;
    try {
      monolithic = JSON.parse(await fs.readFile(oldFile, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') {
        this.logger?.warn('Could not read old executions file; quarantining', { error: e.message });
        await fs.rename(oldFile, `${oldFile}.corrupt-${Date.now()}`).catch(() => {});
      }
    }
    if (Array.isArray(monolithic) && monolithic.length > 0) {
      this.logger?.info('Migrating monolithic execution history to per-day/per-workflow files', {
        records: monolithic.length
      });
      await this._appendRecordsToLayout(monolithic);
      await fs.rename(oldFile, `${oldFile}.migrated`).catch(() => {});
      this.logger?.info('Monolithic migration complete', { records: monolithic.length });
    } else if (monolithic !== null) {
      // Present but empty — retire it so we don't re-check every startup.
      await fs.rename(oldFile, `${oldFile}.migrated`).catch(() => {});
    }

    // --- 2. Flat per-day files ---------------------------------------------
    // A flat file is `executions/<day>.json` (a FILE); the new layout uses
    // `executions/<day>/` (a DIRECTORY). Detect the former and fan it out.
    let entries;
    try {
      entries = await fs.readdir(this.executionsDir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    const flatDayFiles = entries.filter(
      e => e.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(e.name)
    );
    if (flatDayFiles.length === 0) return;

    this.logger?.info('Migrating flat per-day execution files to per-workflow layout', {
      files: flatDayFiles.length
    });
    for (const entry of flatDayFiles) {
      const flatPath = path.join(this.executionsDir, entry.name);
      const records = await this._readJsonArray(flatPath); // quarantines if corrupt
      if (records.length > 0) {
        await this._appendRecordsToLayout(records);
      }
      // Whether it had records or was empty/corrupt (already quarantined),
      // retire the flat file so it isn't reprocessed. If _readJsonArray already
      // renamed a corrupt file, this unlink simply finds nothing.
      await fs.rename(flatPath, `${flatPath}.migrated`).catch(() => {});
    }
    this.logger?.info('Flat per-day migration complete', { files: flatDayFiles.length });
  }

  /**
   * Save today's executions to per-day/per-workflow files (atomic, mutex-guarded).
   *
   * `this.executions` is the flat in-memory list of TODAY's runs across every
   * workflow. On disk each workflow gets its own file under the day directory,
   * so no single file grows with the whole day's volume. Only the workflow keys
   * touched since the last save are rewritten (tracked in `_dirtyWorkflowKeys`);
   * absent that, every key present in memory is written.
   * @private
   */
  async saveExecutions() {
    await this.executionsMutex.lock();
    try {
      const dateKey = this._loadedDay || this._getTodayKey();

      // Group today's in-memory records by their per-workflow file key.
      const byKey = new Map();
      for (const rec of this.executions) {
        const key = this._executionFileKey(rec);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(rec);
      }

      // Decide which files to (re)write. Default to every key in memory; when
      // we know exactly what changed, write only those (and clear any now-empty
      // files whose last record was removed).
      const keysToWrite = this._dirtyWorkflowKeys && this._dirtyWorkflowKeys.size
        ? new Set(this._dirtyWorkflowKeys)
        : new Set(byKey.keys());

      await fs.mkdir(this._getDayDirPath(dateKey), { recursive: true });
      for (const key of keysToWrite) {
        const records = byKey.get(key) || [];
        const filePath = this._getWorkflowFilePath(dateKey, key);
        if (records.length === 0) {
          // Everything for this workflow was cleared today — drop the file.
          try { await fs.unlink(filePath); } catch { /* already gone */ }
        } else {
          await this._writeJsonArrayAtomic(filePath, records);
        }
      }

      if (this._dirtyWorkflowKeys) this._dirtyWorkflowKeys.clear();
    } catch (error) {
      this.logger?.error('Failed to save executions', { error: error.message });
      throw error;
    } finally {
      this.executionsMutex.unlock();
    }
  }

  /**
   * Add an execution to history
   * Handles rollover to new day file at midnight
   */
  async addExecution(execution) {
    const today = this._getTodayKey();
    if (this._loadedDay !== today) {
      // Day has rolled over — start fresh for the new day
      this.executions = [];
      this._loadedDay = today;
      this._dirtyWorkflowKeys = new Set();
    }
    if (!this._dirtyWorkflowKeys) this._dirtyWorkflowKeys = new Set();

    // Upsert by id — a "running" placeholder is replaced by its final record
    const existingIndex = this.executions.findIndex(e => e.id === execution.id);
    if (existingIndex !== -1) {
      // A record's workflow key can't change between placeholder and final
      // record, but mark both keys dirty defensively so no stale file lingers.
      this._dirtyWorkflowKeys.add(this._executionFileKey(this.executions[existingIndex]));
      this.executions[existingIndex] = execution;
    } else {
      this.executions.push(execution);
    }
    this._dirtyWorkflowKeys.add(this._executionFileKey(execution));

    await this.saveExecutions();
    return execution;
  }

  /**
   * Delete a single execution by ID
   * Searches today first, then historical days
   */
  async deleteExecution(executionId) {
    const idx = this.executions.findIndex(e => e.id === executionId);
    if (idx !== -1) {
      const [removed] = this.executions.splice(idx, 1);
      if (!this._dirtyWorkflowKeys) this._dirtyWorkflowKeys = new Set();
      this._dirtyWorkflowKeys.add(this._executionFileKey(removed));
      await this.saveExecutions();
      return true;
    }
    // Search historical days — one per-workflow file at a time so a corrupt or
    // huge neighbour never has to be parsed to delete an unrelated record.
    const today = this._getTodayKey();
    for (const day of (await this._listAvailableDays()).reverse()) {
      if (day === today) continue;
      for (const key of await this._listDayWorkflowKeys(day)) {
        const filePath = this._getWorkflowFilePath(day, key);
        const records = await this._readJsonArray(filePath);
        const di = records.findIndex(e => e.id === executionId);
        if (di !== -1) {
          records.splice(di, 1);
          await this.executionsMutex.lock();
          try {
            if (records.length === 0) {
              try { await fs.unlink(filePath); } catch { /* already gone */ }
            } else {
              await this._writeJsonArrayAtomic(filePath, records);
            }
          } finally {
            this.executionsMutex.unlock();
          }
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Clear executions - by date or older than N days
   */
  async clearExecutions(options = {}) {
    let deletedCount = 0;
    if (options.date) {
      const dayDir = this._getDayDirPath(options.date);
      try {
        deletedCount = (await this._loadDayFile(options.date)).length;
        await fs.rm(dayDir, { recursive: true, force: true });
        if (options.date === this._getTodayKey()) {
          this.executions = [];
          if (this._dirtyWorkflowKeys) this._dirtyWorkflowKeys.clear();
        }
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    } else if (options.olderThanDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.olderThanDays);
      const cutoffKey = cutoff.toISOString().slice(0, 10);
      const today = this._getTodayKey();
      for (const day of await this._listAvailableDays()) {
        // olderThanDays: 0 means "everything up to and including today".
        const shouldClear = options.olderThanDays === 0 ? day <= today : day < cutoffKey;
        if (!shouldClear) continue;
        try {
          deletedCount += (await this._loadDayFile(day)).length;
          await fs.rm(this._getDayDirPath(day), { recursive: true, force: true });
          if (day === today) {
            this.executions = [];
            if (this._dirtyWorkflowKeys) this._dirtyWorkflowKeys.clear();
          }
        } catch (e) { /* skip if already gone */ }
      }
    }
    return deletedCount;
  }

  /**
   * List all available execution days
   */
  async listAvailableDays() {
    return this._listAvailableDays();
  }

  /**
   * Create a schedule
   */
  async createSchedule(scheduleData) {
    try {
      const { workflowId, name, cronExpression, interval, input, description } = scheduleData;

      if (!workflowId) throw new Error('workflowId is required');
      if (!name) throw new Error('Schedule name is required');
      if (!cronExpression && !interval) {
        throw new Error('Either cronExpression or interval is required');
      }

      // Reject malformed cron expressions up-front. Previously an invalid cron
      // (e.g. "0 0 0 0 0", where day-of-month and month are out of range) was
      // accepted, then silently degraded to a fallback interval that could never
      // match — so the schedule appeared to "run once and never again".
      if (cronExpression) {
        this.validateCronExpression(cronExpression);
      }

      // Verify workflow exists
      this.getWorkflow(workflowId);

      const schedule = {
        id: uuidv4(),
        workflowId,
        name,
        description: description || '',
        cronExpression: cronExpression || null,
        interval: interval || null,
        input: input || {},
        enabled: scheduleData.enabled !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastRun: null,
        nextRun: this.calculateNextRun(cronExpression, interval),
        executionCount: 0,
        lastResult: null,
        lastError: null
      };

      this.schedules.push(schedule);
      await this.saveSchedules();

      if (schedule.enabled) {
        await this.activateSchedule(schedule.id);
      }

      this.logger?.info('Schedule created', { scheduleId: schedule.id, workflowId, name });

      return schedule;
    } catch (error) {
      this.logger?.error('Failed to create schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * Get schedule by ID
   */
  getSchedule(scheduleId) {
    const schedule = this.schedules.find(s => s.id === scheduleId);
    if (!schedule) throw new Error(`Schedule not found: ${scheduleId}`);
    return schedule;
  }

  /**
   * Update schedule
   */
  async updateSchedule(scheduleId, updates) {
    try {
      const schedule = this.getSchedule(scheduleId);

      // Validate a new cron expression BEFORE tearing down the active schedule,
      // so a bad update can't leave a previously-working schedule stopped.
      if (updates.cronExpression !== undefined && updates.cronExpression) {
        this.validateCronExpression(updates.cronExpression);
      }

      if (this.activeSchedules.has(scheduleId)) {
        await this.deactivateSchedule(scheduleId);
      }

      if (updates.name) schedule.name = updates.name;
      if (updates.description !== undefined) schedule.description = updates.description;
      if (updates.cronExpression !== undefined) schedule.cronExpression = updates.cronExpression;
      if (updates.interval !== undefined) schedule.interval = updates.interval;
      if (updates.input !== undefined) schedule.input = updates.input;

      schedule.updatedAt = new Date().toISOString();
      schedule.nextRun = this.calculateNextRun(schedule.cronExpression, schedule.interval);

      await this.saveSchedules();

      if (schedule.enabled) {
        await this.activateSchedule(scheduleId);
      }

      this.logger?.info('Schedule updated', { scheduleId });
      return schedule;
    } catch (error) {
      this.logger?.error('Failed to update schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete schedule
   */
  async deleteSchedule(scheduleId) {
    try {
      await this.deactivateSchedule(scheduleId);

      const index = this.schedules.findIndex(s => s.id === scheduleId);
      if (index === -1) throw new Error(`Schedule not found: ${scheduleId}`);

      this.schedules.splice(index, 1);
      await this.saveSchedules();

      this.logger?.info('Schedule deleted', { scheduleId });
      return true;
    } catch (error) {
      this.logger?.error('Failed to delete schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * Activate schedule using core scheduling service
   */
  async activateSchedule(scheduleId) {
    try {
      if (this.activeSchedules.has(scheduleId)) return;

      const schedule = this.getSchedule(scheduleId);
      const workflow = this.getWorkflow(schedule.workflowId);

      // DEPRECATED: Old schedule wrapper script creation disabled
      // Now using workflowScheduler.js with run-workflow.js activity instead
      // const wrapperScriptPath = await this.createScheduleWrapperScript(scheduleId, schedule);

      // A schedule is either interval-based or cron-based.
      if (!schedule.interval && !schedule.cronExpression) {
        throw new Error('Schedule must have either interval or cron expression');
      }

      // Use core scheduling service with run-workflow.js activity
      if (this.schedulingService) {
        try {
          const activityPath = path.resolve(__dirname, '../../configuration/activities/run-workflow.js');
          const taskData = {
            workflowId: schedule.workflowId,
            payload: schedule.input
          };

          // Update schedule metadata + execution history on every run.
          // Scheduled runs execute inside a worker thread (run-workflow.js) with
          // their own service registry, so they never pass through
          // executeWorkflow(). Without this callback the schedule's lastRun /
          // executionCount / nextRun and the execution history would never
          // update, making a working schedule look like it "only ran once".
          const executionCallback = (status, result) => {
            const succeeded = status === 'completed' || status === 'success';
            const ranAt = new Date().toISOString();
            const errorMessage = succeeded
              ? null
              : (typeof result === 'string' ? result : (result?.error || result?.message || 'Unknown error'));

            this.logger?.info('Scheduled workflow run finished', {
              scheduleId,
              workflowId: schedule.workflowId,
              status: succeeded ? 'success' : 'failed'
            });

            // Persist stats + history asynchronously; never throw back into the
            // scheduler callback.
            (async () => {
              try {
                schedule.lastRun = ranAt;
                schedule.executionCount = (schedule.executionCount || 0) + 1;
                schedule.lastResult = succeeded ? 'success' : 'failed';
                schedule.lastError = errorMessage;
                schedule.nextRun = this.calculateNextRun(schedule.cronExpression, schedule.interval);
                await this.saveSchedules();

                const steps = (result && Array.isArray(result.steps))
                  ? result.steps.map(s => ({
                      stepName: s.stepName,
                      status: 'completed',
                      result: s.data,
                      executedAt: ranAt
                    }))
                  : [];

                await this.addExecution({
                  id: uuidv4(),
                  workflowId: schedule.workflowId,
                  name: workflow?.name || schedule.workflowId,
                  startedAt: ranAt,
                  completedAt: ranAt,
                  status: succeeded ? 'completed' : 'failed',
                  outcome: succeeded ? 'success' : 'failed',
                  input: schedule.input || {},
                  result: succeeded ? (result ?? null) : null,
                  steps,
                  error: errorMessage,
                  duration: null,
                  trigger: 'schedule',
                  scheduleId
                });
              } catch (err) {
                this.logger?.warn('Failed to persist scheduled run', {
                  scheduleId,
                  error: err.message
                });
              }
            })();
          };

          if (schedule.cronExpression && !schedule.interval) {
            // CRON schedule — register with the core scheduler's cron evaluator so
            // it fires ONLY on minutes that match the expression. Previously this
            // used a flat 60s interval via start() and ignored the cron expression
            // entirely, so an hourly schedule like "0 * * * *" ran every minute.
            await this.schedulingService.startCron(
              { scriptPath: activityPath, data: taskData, name: scheduleId },
              schedule.cronExpression,
              scheduleId,
              executionCallback
            );

            this.activeSchedules.set(scheduleId, { type: 'coreservice', activityPath });
            this.logger?.info('Schedule activated via core service (cron)', {
              scheduleId,
              cron: schedule.cronExpression,
              hasWorkflow: !!workflow
            });
          } else {
            // Interval schedule — stored in milliseconds, core expects seconds.
            const intervalSeconds = schedule.interval / 1000;

            await this.schedulingService.start(
              scheduleId,
              activityPath,
              taskData,
              intervalSeconds,
              executionCallback
            );

            this.activeSchedules.set(scheduleId, { type: 'coreservice', activityPath });
            this.logger?.info('Schedule activated via core service (interval)', {
              scheduleId,
              intervalSeconds,
              hasWorkflow: !!workflow
            });
          }
        } catch (error) {
          this.logger?.warn('Failed to use core scheduling service, falling back to setInterval', {
            error: error.message
          });
          await this.activateScheduleFallback(scheduleId, schedule);
        }
      } else {
        // Fallback if no scheduling service available
        await this.activateScheduleFallback(scheduleId, schedule);
      }
    } catch (error) {
      this.logger?.error('Failed to activate schedule', { error: error.message });
      throw error;
    }
  }

  /**
   * Create a wrapper script for the core scheduling service
   * The script will be executed by the worker service
   */
  async createScheduleWrapperScript(scheduleId, schedule) {
    try {
      // Use absolute path to ensure the file can be found by the worker service
      const tempDir = path.join(this.appBaseDir, 'workflow', 'schedules');
      await fs.mkdir(tempDir, { recursive: true });

      const wrapperPath = path.resolve(tempDir, `schedule-${scheduleId}.js`);
      const scheduleBridge = this;

      // Create wrapper script content
      const scriptContent = `
module.exports = async function(input) {
  // This wrapper is called by the core scheduling service
  // It executes the workflow for this schedule
  try {
    const schedule = ${JSON.stringify(schedule)};
    const scheduleId = '${scheduleId}';
    const workflowId = schedule.workflowId;

    // Call the executeWorkflow method through the bridge
    // The bridge maintains a global reference for this purpose
    if (global.workflowBridgeExecutor && typeof global.workflowBridgeExecutor === 'function') {
      const result = await global.workflowBridgeExecutor(workflowId, schedule.input);
      return result;
    }

    return { status: 'error', message: 'WorkflowBridge executor not available' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
};
`;

      await fs.writeFile(wrapperPath, scriptContent, 'utf8');
      this.logger?.debug('Created schedule wrapper script', { scheduleId, wrapperPath });

      return wrapperPath;
    } catch (error) {
      this.logger?.error('Failed to create schedule wrapper script', {
        scheduleId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Fallback schedule activation using setInterval (when core service unavailable)
   */
  async activateScheduleFallback(scheduleId, schedule) {
    const executeScheduledWorkflow = async () => {
      try {
        this.logger?.info('Executing scheduled workflow (fallback)', {
          scheduleId,
          workflowId: schedule.workflowId
        });

        const execution = await this.executeWorkflow(schedule.workflowId, schedule.input);

        schedule.lastRun = new Date().toISOString();
        schedule.executionCount += 1;
        schedule.lastResult = execution.outcome;
        schedule.lastError = execution.outcome === 'failed' ? execution.error : null;
        schedule.nextRun = this.calculateNextRun(schedule.cronExpression, schedule.interval);

        if (execution.outcome === 'failed') {
          this.logger?.error('Scheduled workflow execution failed', {
            scheduleId,
            workflowId: schedule.workflowId,
            error: execution.error
          });
        }

        await this.saveSchedules();
      } catch (error) {
        this.logger?.error('Scheduled execution failed', {
          scheduleId,
          error: error.message
        });
        schedule.lastRun = new Date().toISOString();
        schedule.executionCount += 1;
        schedule.lastResult = 'failed';
        schedule.lastError = error.message;
        await this.saveSchedules();
      }
    };

    // Use interval-based execution as fallback
    let intervalMs = schedule.interval ? schedule.interval : 60000; // interval is already in ms
    if (schedule.cronExpression && !schedule.interval) {
      // Guard against expressions the matcher can never satisfy (e.g. a
      // malformed "0 0 0 0 0" persisted before validation existed). Such a
      // schedule would otherwise sit on a 60s timer that silently never fires.
      // Surface it loudly and skip activation rather than pretend it's running.
      try {
        this.validateCronExpression(schedule.cronExpression);
      } catch (err) {
        this.logger?.error('Schedule has an invalid cron expression and will NEVER run — fix or delete it', {
          scheduleId,
          cronExpression: schedule.cronExpression,
          reason: err.message
        });
        // Track it so it isn't repeatedly re-activated, but attach no timer.
        this.activeSchedules.set(scheduleId, { type: 'cron-invalid' });
        return;
      }

      // For cron, check every minute but only execute when cron matches
      intervalMs = 60000;
      const originalExecute = executeScheduledWorkflow;
      const checkAndExecute = async () => {
        if (this.matchesCron(schedule.cronExpression)) {
          await originalExecute();
        }
      };
      const intervalId = setInterval(checkAndExecute, intervalMs);
      this.activeSchedules.set(scheduleId, { type: 'cron-fallback', intervalId });
    } else {
      // For interval-based, just execute every interval
      const intervalId = setInterval(executeScheduledWorkflow, intervalMs);
      this.activeSchedules.set(scheduleId, { type: 'interval-fallback', intervalId });
      // Execute immediately
      executeScheduledWorkflow();
    }

    this.logger?.info('Schedule activated via fallback', {
      scheduleId,
      type: schedule.interval ? 'interval' : 'cron'
    });
  }

  /**
   * Deactivate schedule
   */
  async deactivateSchedule(scheduleId) {
    const activeSchedule = this.activeSchedules.get(scheduleId);
    if (!activeSchedule) return;

    if (activeSchedule.type === 'coreservice') {
      // Stop via core scheduling service
      try {
        if (this.schedulingService) {
          await this.schedulingService.stop(scheduleId);
        }
      } catch (error) {
        this.logger?.warn('Failed to stop schedule via core service', {
          scheduleId,
          error: error.message
        });
      }
      // Clean up wrapper script
      if (activeSchedule.wrapperScriptPath) {
        try {
          await fs.unlink(activeSchedule.wrapperScriptPath);
        } catch (error) {
          this.logger?.debug('Could not delete wrapper script', {
            path: activeSchedule.wrapperScriptPath,
            error: error.message
          });
        }
      }
    } else {
      // Stop via setInterval fallback
      if (activeSchedule.intervalId) {
        clearInterval(activeSchedule.intervalId);
      }
    }

    this.activeSchedules.delete(scheduleId);

    // Also stop in core scheduling service if it was registered
    if (this.schedulingService) {
      try {
        await this.schedulingService.stop(scheduleId);
      } catch (err) {
        // Ignore if not found in core service
      }
    }

    this.logger?.info('Schedule deactivated', { scheduleId });
  }

  /**
   * Check if current time matches cron expression
   */
  matchesCron(cronExpression) {
    return this.matchesCronAt(cronExpression, new Date());
  }

  /**
   * Test whether a given date satisfies a standard 5-field cron expression.
   * Supports '*', exact values, lists (a,b), ranges (a-b) and steps (a/n, *\/n).
   * @param {string} cronExpression
   * @param {Date} date
   * @returns {boolean}
   */
  matchesCronAt(cronExpression, date) {
    const parts = String(cronExpression || '').trim().split(/\s+/);
    if (parts.length !== 5) return false;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    return (
      this.cronFieldMatches(minute, date.getMinutes()) &&
      this.cronFieldMatches(hour, date.getHours()) &&
      this.cronFieldMatches(dayOfMonth, date.getDate()) &&
      this.cronFieldMatches(month, date.getMonth() + 1) &&
      this.cronFieldMatches(dayOfWeek, date.getDay())
    );
  }

  /**
   * Match a single cron field token against a numeric value.
   * @param {string} token e.g. '*', '5', '1-5', '0,30', '*\/15'
   * @param {number} value
   * @returns {boolean}
   */
  cronFieldMatches(token, value) {
    if (token === '*' || token === undefined) return true;

    // Comma-separated list — match if any sub-token matches.
    if (token.includes(',')) {
      return token.split(',').some(t => this.cronFieldMatches(t, value));
    }

    // Optional step: base/step (base may be '*' or a range).
    let base = token;
    let step = 1;
    if (token.includes('/')) {
      const [b, s] = token.split('/');
      base = b;
      step = parseInt(s, 10) || 1;
    }

    let start;
    let end;
    if (base === '*') {
      return step <= 1 ? true : (value % step === 0);
    } else if (base.includes('-')) {
      const [lo, hi] = base.split('-').map(n => parseInt(n, 10));
      start = lo;
      end = hi;
    } else {
      const n = parseInt(base, 10);
      if (Number.isNaN(n)) return false;
      start = n;
      end = n;
    }

    if (Number.isNaN(start) || Number.isNaN(end) || value < start || value > end) return false;
    return ((value - start) % step) === 0;
  }

  /**
   * Validate a standard 5-field cron expression using the same field ranges and
   * token grammar as the core scheduler. Throws a descriptive Error if invalid.
   * Centralised here so every schedule entry point (createSchedule/updateSchedule)
   * rejects bad expressions instead of silently degrading to a never-firing
   * fallback interval.
   * @param {string} expression
   * @throws {Error} If the expression is malformed or out of range.
   */
  validateCronExpression(expression) {
    if (typeof expression !== 'string' || expression.trim() === '') {
      throw new Error('Cron expression must be a non-empty string');
    }
    const tokens = expression.trim().split(/\s+/);
    if (tokens.length !== 5) {
      throw new Error(
        `Invalid cron expression "${expression}": must have exactly 5 fields ` +
        `(minute hour day-of-month month day-of-week), got ${tokens.length}`
      );
    }
    for (let i = 0; i < CRON_FIELDS.length; i++) {
      const { name, min, max } = CRON_FIELDS[i];
      this._validateCronField(tokens[i], min, max, name, expression);
    }
  }

  /**
   * Validate a single cron field token against its allowed range. Supports the
   * same grammar as cronFieldMatches: '*', n, n-m, comma lists, and steps
   * (base/step where base is '*', a value, or a range).
   * @private
   */
  _validateCronField(token, min, max, fieldName, expression) {
    for (const part of String(token).split(',')) {
      let rangeStr = part;

      if (part.includes('/')) {
        const split = part.split('/');
        if (split.length !== 2) {
          throw new Error(`Invalid cron expression "${expression}": malformed step in ${fieldName} field "${part}"`);
        }
        rangeStr = split[0];
        const step = Number(split[1]);
        if (!Number.isInteger(step) || step <= 0) {
          throw new Error(`Invalid cron expression "${expression}": step must be a positive integer in ${fieldName} field "${part}"`);
        }
      }

      if (rangeStr === '*') continue; // wildcard is always in range

      let start;
      let end;
      if (rangeStr.includes('-')) {
        const [s, e] = rangeStr.split('-').map(Number);
        if (!Number.isInteger(s) || !Number.isInteger(e)) {
          throw new Error(`Invalid cron expression "${expression}": malformed range in ${fieldName} field "${rangeStr}"`);
        }
        start = s;
        end = e;
      } else {
        const value = Number(rangeStr);
        if (!Number.isInteger(value)) {
          throw new Error(`Invalid cron expression "${expression}": "${rangeStr}" is not a valid ${fieldName} value`);
        }
        start = value;
        end = value;
      }

      if (start < min || end > max || start > end) {
        throw new Error(`Invalid cron expression "${expression}": ${fieldName} value "${rangeStr}" is out of range (${min}-${max})`);
      }
    }
  }

  /**
   * Calculate next run time. For cron schedules this steps forward minute-by-minute
   * until the expression matches, so the stored/displayed nextRun reflects the
   * actual cron (e.g. "0 * * * *" → top of the next hour), not a flat now+1h.
   */
  calculateNextRun(cronExpression, interval) {
    if (interval) {
      const nextTime = new Date();
      nextTime.setMilliseconds(nextTime.getMilliseconds() + interval);
      return nextTime.toISOString();
    }

    if (cronExpression) {
      const candidate = new Date();
      candidate.setSeconds(0, 0);
      candidate.setMinutes(candidate.getMinutes() + 1); // start from the next whole minute
      const maxMinutes = 366 * 24 * 60; // give up after ~1 year
      for (let i = 0; i < maxMinutes; i++) {
        if (this.matchesCronAt(cronExpression, candidate)) {
          return candidate.toISOString();
        }
        candidate.setMinutes(candidate.getMinutes() + 1);
      }
      // Fallback for an expression we couldn't satisfy (shouldn't happen for valid crons).
      const nextTime = new Date();
      nextTime.setHours(nextTime.getHours() + 1);
      return nextTime.toISOString();
    }

    return null;
  }

  /**
   * List schedules
   */
  listSchedules(options = {}) {
    let result = [...this.schedules];

    if (options.workflowId) {
      result = result.filter(s => s.workflowId === options.workflowId);
    }

    if (options.enabled !== undefined) {
      result = result.filter(s => s.enabled === options.enabled);
    }

    result.sort((a, b) => {
      const aTime = new Date(a.nextRun || 0).getTime();
      const bTime = new Date(b.nextRun || 0).getTime();
      return aTime - bTime;
    });

    const limit = options.limit || 100;
    const offset = options.offset || 0;
    return result.slice(offset, offset + limit);
  }

  /**
   * Enable schedule
   */
  async enableSchedule(scheduleId) {
    const schedule = this.getSchedule(scheduleId);
    if (schedule.enabled) return schedule;

    schedule.enabled = true;
    // Re-arm from now. Without this the nextRun frozen at the moment the
    // schedule was disabled stays in the past, and the reconciler would read
    // that as a missed fire and immediately run the workflow on enable.
    schedule.nextRun = this.calculateNextRun(schedule.cronExpression, schedule.interval);
    await this.saveSchedules();
    await this.activateSchedule(scheduleId);

    return schedule;
  }

  /**
   * Disable schedule
   */
  async disableSchedule(scheduleId) {
    const schedule = this.getSchedule(scheduleId);
    if (!schedule.enabled) return schedule;

    schedule.enabled = false;
    await this.deactivateSchedule(scheduleId);
    await this.saveSchedules();

    return schedule;
  }

  /**
   * Reactivate all enabled schedules
   */
  async reactivateSchedules() {
    const enabledSchedules = this.schedules.filter(s => s.enabled);
    let failed = 0;

    for (const schedule of enabledSchedules) {
      try {
        await this.activateSchedule(schedule.id);
        delete schedule.activationError;
      } catch (error) {
        failed++;
        // An enabled schedule with no timer attached will never fire, and
        // nothing else in the system says so. Record it against the schedule
        // rather than leaving it to a single startup log line.
        schedule.activationError = error.message;
        this.logger?.error('Failed to reactivate schedule — it will NOT run until fixed', {
          scheduleId: schedule.id,
          name: schedule.name,
          error: error.message
        });
      }
    }

    if (failed > 0) await this.saveSchedules();

    this.logger?.info('Schedules reactivated', {
      count: enabledSchedules.length - failed,
      failed
    });
  }

  /**
   * Reconcile every enabled schedule against the clock.
   *
   * The cron evaluator is edge-triggered: it runs a schedule only if the
   * process happens to be alive and responsive during the exact minute the
   * expression matches. Nothing else ever advanced `nextRun`, so a fire missed
   * because the backend was restarting, deploying, or stalled was lost — and
   * the stale `nextRun` sat in the past forever, which is what the schedules
   * screen was showing. For a nightly expression a single miss costs a whole
   * day, and a restart that recurs around that time costs every day.
   *
   * This pass closes both halves of that gap:
   *   - `nextRun` is recomputed whenever it is missing or already past, so the
   *     displayed value is always a real future time.
   *   - a fire that was missed is replayed once (catch-up), the way anacron
   *     runs a job the machine slept through. Set SCHEDULE_CATCHUP=off to keep
   *     the nextRun repair without the replay.
   *
   * `nextRun` is advanced and persisted BEFORE the catch-up run is dispatched,
   * so a backend that restart-loops cannot replay the same fire repeatedly.
   *
   * @param {Object} [options]
   * @param {boolean} [options.startup] True on the initialization pass. Only
   *   affects logging — the work is identical either way.
   * @returns {Promise<{repaired: number, caughtUp: number}>}
   */
  async reconcileSchedules({ startup = false } = {}) {
    if (this._reconciling) return { repaired: 0, caughtUp: 0 };
    this._reconciling = true;

    try {
      const now = Date.now();
      let repaired = 0;
      let caughtUp = 0;
      let dirty = false;

      for (const schedule of this.schedules) {
        if (!schedule.enabled) continue;

        const active = this.activeSchedules.get(schedule.id);
        // A schedule whose cron can never match is reported at activation and
        // has no timer; recomputing its nextRun would just spin.
        if (active && active.type === 'cron-invalid') continue;

        const nextRunMs = schedule.nextRun ? new Date(schedule.nextRun).getTime() : NaN;

        if (Number.isNaN(nextRunMs)) {
          schedule.nextRun = this.calculateNextRun(schedule.cronExpression, schedule.interval);
          dirty = true;
          repaired++;
          continue;
        }

        if (nextRunMs > now - this.catchUpGraceMs) continue; // not overdue

        // Overdue — but a long-running workflow that is still in flight has
        // not missed anything; its nextRun advances when the run completes.
        if (await this._isRunInFlight(schedule.id)) continue;

        const missedRun = schedule.nextRun;
        schedule.nextRun = this.calculateNextRun(schedule.cronExpression, schedule.interval);
        dirty = true;
        repaired++;

        if (!this.catchUpEnabled) {
          this.logger?.warn('Schedule missed a run; nextRun repaired (catch-up disabled)', {
            scheduleId: schedule.id,
            name: schedule.name,
            missedRun,
            nextRun: schedule.nextRun
          });
          continue;
        }

        this.logger?.warn('Schedule missed a run — replaying it now', {
          scheduleId: schedule.id,
          name: schedule.name,
          missedRun,
          nextRun: schedule.nextRun,
          startup
        });

        this._dispatchCatchUp(schedule, caughtUp * this.catchUpStaggerMs);
        caughtUp++;
      }

      if (dirty) await this.saveSchedules();

      if (repaired > 0) {
        this.logger?.info('Schedules reconciled', { repaired, caughtUp, startup });
      }

      return { repaired, caughtUp };
    } catch (error) {
      this.logger?.error('Schedule reconciliation failed', { error: error.message });
      return { repaired: 0, caughtUp: 0 };
    } finally {
      this._reconciling = false;
    }
  }

  /**
   * Start the periodic reconciler. Idempotent.
   */
  startScheduleReconciler() {
    if (this._reconcileTimer) return;

    this._reconcileTimer = setInterval(() => {
      this.reconcileSchedules().catch((error) => {
        this.logger?.error('Scheduled reconciliation tick failed', { error: error.message });
      });
    }, RECONCILE_TICK_MS);

    // Don't hold the process open on the reconciler alone.
    if (typeof this._reconcileTimer.unref === 'function') {
      this._reconcileTimer.unref();
    }
  }

  /**
   * Stop the periodic reconciler (shutdown / tests).
   */
  stopScheduleReconciler() {
    if (!this._reconcileTimer) return;
    clearInterval(this._reconcileTimer);
    this._reconcileTimer = null;
  }

  /**
   * Whether a run for this schedule is currently executing in the core
   * scheduler. Returns false when the core service can't tell us — the
   * fallback timers run workflows in-process and report nothing.
   *
   * @param {string} scheduleId
   * @returns {Promise<boolean>}
   * @private
   */
  async _isRunInFlight(scheduleId) {
    try {
      if (!this.schedulingService || typeof this.schedulingService.getSchedule !== 'function') {
        return false;
      }
      const task = await this.schedulingService.getSchedule(scheduleId);
      return !!(task && task.activeRuns > 0);
    } catch (error) {
      this.logger?.debug('Could not read task state from scheduling service', {
        scheduleId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Dispatch a single catch-up run, optionally after a delay so a batch of
   * overdue schedules doesn't start simultaneously.
   *
   * Runs through the core scheduler where possible so the catch-up uses the
   * same worker thread, timeout, retry and completion-callback path as a
   * normal fire — which is what updates lastRun, executionCount and history.
   *
   * @param {Object} schedule The schedule record.
   * @param {number} delayMs Delay before dispatching.
   * @private
   */
  _dispatchCatchUp(schedule, delayMs) {
    const run = async () => {
      try {
        const active = this.activeSchedules.get(schedule.id);
        const viaCore = active
          && active.type === 'coreservice'
          && this.schedulingService
          && typeof this.schedulingService.runNow === 'function';

        if (viaCore) {
          const dispatched = await this.schedulingService.runNow(schedule.id);
          if (dispatched) return;
          this.logger?.warn('Core scheduler had no task for schedule; running in-process', {
            scheduleId: schedule.id
          });
        }

        // Fallback activation (or a core task that has gone missing): run it
        // here. triggerSchedule keeps lastRun/executionCount/history in step.
        await this.triggerSchedule(schedule.id);
      } catch (error) {
        this.logger?.error('Catch-up run failed', {
          scheduleId: schedule.id,
          name: schedule.name,
          error: error.message
        });
      }
    };

    if (delayMs > 0) {
      const timer = setTimeout(run, delayMs);
      if (typeof timer.unref === 'function') timer.unref();
      return;
    }
    run();
  }

  /**
   * Manually trigger schedule
   */
  async triggerSchedule(scheduleId) {
    const schedule = this.getSchedule(scheduleId);

    try {
      const execution = await this.executeWorkflow(schedule.workflowId, schedule.input);

      schedule.lastRun = new Date().toISOString();
      schedule.executionCount += 1;
      schedule.lastResult = execution.outcome;
      await this.saveSchedules();

      return execution;
    } catch (error) {
      schedule.lastError = error.message;
      await this.saveSchedules();
      throw error;
    }
  }

  /**
   * Get schedule stats
   */
  getScheduleStats() {
    return {
      total: this.schedules.length,
      enabled: this.schedules.filter(s => s.enabled).length,
      active: this.activeSchedules.size,
      totalExecutions: this.schedules.reduce((sum, s) => sum + s.executionCount, 0),
      byType: {
        interval: this.schedules.filter(s => s.interval).length,
        cron: this.schedules.filter(s => s.cronExpression).length
      }
    };
  }
}

module.exports = WorkflowBridge;
