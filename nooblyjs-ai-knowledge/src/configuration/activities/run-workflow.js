
/**
 * Activity: Execute a workflow by name/ID
 * This activity runs inside a worker thread, so it cannot access the parent
 * process's workflow service (worker threads get an isolated service registry
 * with no workflows defined). Instead it loads the workflow definition from
 * disk and executes each step sequentially.
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent workflow
 * @param {string} data.workflowId - The workflow name or sanitized ID to execute
 * @param {Object} data.payload - Optional input data to pass to the workflow
 * @returns {Promise<Object>} Execution result
 */
'use strict';

const fs = require('fs');
const path = require('path');
const serviceRegistry = require('nooblyjs-core');
const { sanitizeDirectoryName } = require('../../datasources/utils/pathSanitizer');
const { definitionFilesIn } = require('../../datasources/utils/workflowDefinitionFiles');

// Base path for workflow definitions. Must match WorkflowBridge/WorkflowManager:
// definitions live in this repo's workflows/ folder.
// Override with the WORKFLOWS_PATH env var if located elsewhere.
const WORKFLOWS_BASE = process.env.WORKFLOWS_PATH
  || path.resolve(__dirname, '../../../workflows');

/**
 * Resolve a step path: if absolute return as-is, otherwise resolve relative to workflowDir
 */
function resolveStepPath(workflowDir, stepPath) {
  if (path.isAbsolute(stepPath)) {
    return stepPath;
  }
  return path.resolve(workflowDir, stepPath);
}

/**
 * Find a workflow definition by sanitized ID across all workflow group folders.
 *
 * A group folder holds the bare `workflow-definition.json` PLUS any
 * `workflow-definition-<suffix>.json` sub-group files, and every one of them may
 * hold an array of definitions. Scanning only the bare file — which this did —
 * makes every workflow in a suffixed file unschedulable: the bridge loads it, so
 * it lists in the UI and runs fine from "Run now" (that executes in the main
 * process), but the scheduled run lands here and dies with "not found on disk".
 * `definitionFilesIn` is shared with the bridge so the two cannot diverge again.
 *
 * Matching is on sanitizeDirectoryName(name), the same ID the bridge assigns.
 *
 * @param {string} targetId - Sanitized workflow ID to find
 * @param {Object} logger - Logger for skipped/unreadable files
 * @param {{ scanned: number }} [stats] - Populated with how many definitions were
 *   examined, so a miss can report whether anything was readable at all.
 * @returns {{ definition: Object, workflowDir: string } | null}
 */
function findWorkflowDefinition(targetId, logger, stats = { scanned: 0 }) {
  if (!fs.existsSync(WORKFLOWS_BASE)) {
    throw new Error(
      `Workflows directory not found: ${WORKFLOWS_BASE}. ` +
      `Set the WORKFLOWS_PATH env var if the workflows live somewhere else.`
    );
  }
  const groups = fs.readdirSync(WORKFLOWS_BASE, { withFileTypes: true });

  for (const entry of groups) {
    if (!entry.isDirectory()) continue;

    const workflowDir = path.join(WORKFLOWS_BASE, entry.name);

    let dirEntries;
    try {
      dirEntries = fs.readdirSync(workflowDir);
    } catch (error) {
      logger.warn(`run-workflow activity: cannot read workflow folder "${entry.name}": ${error.message}`);
      continue;
    }

    for (const { fileName } of definitionFilesIn(dirEntries)) {
      // Read/parse per file: one malformed definition file must not abort the
      // scan, or a single bad edit makes every workflow unschedulable.
      let definitions;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(workflowDir, fileName), 'utf-8'));
        definitions = Array.isArray(parsed) ? parsed : [parsed];
      } catch (error) {
        logger.warn(
          `run-workflow activity: skipping unreadable definition file "${entry.name}/${fileName}": ${error.message}`
        );
        continue;
      }

      for (const definition of definitions) {
        if (!definition || !definition.name) continue;
        stats.scanned += 1;
        if (sanitizeDirectoryName(definition.name) === targetId) {
          return { definition, workflowDir };
        }
      }
    }
  }

  return null;
}

async function run(data) {
  // Validate input
  if (!data || !data.workflowId) {
    throw new Error('Missing required parameter: workflowId');
  }

  const logger = serviceRegistry.logger('console');

  // Normalize to sanitized ID
  const resolvedId = sanitizeDirectoryName(data.workflowId);

  logger.info('run-workflow activity: looking up workflow', {
    workflowId: data.workflowId,
    resolvedId
  });

  // Find the workflow definition on disk
  const stats = { scanned: 0 };
  const found = findWorkflowDefinition(resolvedId, logger, stats);
  if (!found) {
    throw new Error(
      `Workflow '${data.workflowId}' (resolved: '${resolvedId}') not found on disk. ` +
      `Scanned ${stats.scanned} definition(s) under ${WORKFLOWS_BASE}.`
    );
  }

  const { definition, workflowDir } = found;
  const steps = (definition.steps || []).filter(s => typeof s === 'string');

  if (steps.length === 0) {
    throw new Error(`Workflow '${resolvedId}' has no steps defined`);
  }

  // Build initial input: use payload if provided, otherwise use workflow's defaultInput
  const input = (data.payload && Object.keys(data.payload).length > 0)
    ? data.payload
    : (definition.defaultInput || {});

  logger.info('run-workflow activity: executing steps', {
    resolvedId,
    stepCount: steps.length
  });

  // Execute steps sequentially, passing accumulated context
  let context = { ...input };
  const stepResults = [];

  for (let i = 0; i < steps.length; i++) {
    const stepRelPath = steps[i];
    const stepAbsPath = resolveStepPath(workflowDir, stepRelPath);
    const stepName = path.basename(stepRelPath, '.js');

    logger.info(`run-workflow activity: running step ${i + 1}/${steps.length}`, {
      stepName,
      stepPath: stepAbsPath
    });

    // Load and execute the step module
    const stepModule = require(stepAbsPath);

    if (typeof stepModule.run !== 'function') {
      throw new Error(`Step '${stepName}' does not export a run function`);
    }

    const stepOutput = await stepModule.run(context);

    // Merge step output into context for subsequent steps
    if (stepOutput && typeof stepOutput === 'object') {
      context = { ...context, ...stepOutput };
    }

    stepResults.push({
      stepNumber: i + 1,
      stepName,
      data: stepOutput
    });
  }

  logger.info('run-workflow activity: complete', {
    resolvedId,
    stepsExecuted: stepResults.length
  });

  return {
    success: true,
    workflowId: data.workflowId,
    resolvedId,
    stepsExecuted: stepResults.length,
    steps: stepResults,
    executedAt: new Date().toISOString()
  };
}

module.exports = { run };
