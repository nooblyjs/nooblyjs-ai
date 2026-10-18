/**
 * @fileoverview Clean a converted markdown document.
 * Workflow step that runs the DocumentCleaner service over a markdown file to
 * strip cover pages, metadata, sign-off sections and headers/footers.
 *
 * Runs either standalone (settings.sourceDocument = the markdown to clean) or
 * chained after convert-document.js in the "Design: Process File" workflow, in
 * which case the convert step has already written the markdown to
 * settings.outputDocument and we clean that file in place.
 *
 * @author NooblyJS Team
 * @version 4.0.0
 * @lastupdated 2026-06-07
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const serviceRegistry = require('nooblyjs-core');

// Resolves/creates a configured AI agent from the Agents registry.
const { resolveExpert } = require('../../../src/shared/ai/expertResolver');
const { initializeAIInstances } = require('../../../src/datasources/lib/aiInstances');
const DocumentCleaner = require('../services/documentCleaner');
const { libraryFor } = require('../../common/prompts/prompts');

/**
 * Mirror the main app's APP_BASE_DIR resolution. The worker inherits the
 * parent's env, so APP_BASE_DIR carries through; otherwise fall back to the
 * shared .application dir alongside the repos (…/work/.application). Both the
 * Agents file and the prompt library are resolved from here.
 * @returns {string} Absolute application base directory.
 */
function resolveAppBaseDir() {
  return process.env.APP_BASE_DIR
    ? path.resolve(process.env.APP_BASE_DIR)
    : path.resolve(__dirname, '../../../.application');
}

/**
 * Ensure the AI agent registry (global.aiInstances) exists in this context.
 *
 * Workflow steps run in a worker thread, which has its own global scope and
 * does NOT inherit the registry the main app built on startup. When it's
 * missing we build it here from settings-agents.json, so the step can resolve a
 * "Document Processing" agent exactly as the main app would. No-op when the
 * registry already exists (e.g. running in-process).
 *
 * @param {Object} logger - Logger for initializeAIInstances
 * @returns {Promise<void>}
 */
async function ensureAIInstances(logger) {
  if (global.aiInstances) return;

  const appBaseDir = resolveAppBaseDir();

  // initializeAIInstances only uses the app to register optional HTTP routes
  // (aiservice Routes/Views early-return without one) and to stash the registry
  // via app.set. The workflows repo has no express dependency, so a no-op stub
  // is enough and avoids pulling express into the worker.
  const noop = () => {};
  const appStub = { set: noop, get: noop, post: noop, use: noop };
  await initializeAIInstances({
    serviceRegistry,
    app: appStub,
    log: logger,
    appBaseDir
  });
}

/**
 * Clean a markdown document using a configured AI agent from the Agents registry.
 *
 * @async
 * @function run
 * @param {Object} data - The data passed from the parent thread
 * @param {Object} data.settings - The step settings
 * @param {string} data.settings.sourceDocument - Markdown file to clean (standalone runs)
 * @param {string} data.settings.outputDocument - Where to write the cleaned markdown
 * @param {number} [data.settings.maxChunkSize] - Max characters per chunk
 * @param {Array}  [data.steps] - Previous step outputs (set by the workflow engine)
 * @param {string} [data.agent] - Explicit agent name/slug (overrides the usage tag)
 * @returns {Promise<Object>} A promise that resolves with a completion message object
 */
async function run(data) {
  const settings = (data && data.settings) || {};
  const logger = serviceRegistry.logger();

  // When chained after convert-document in the same workflow, that step has
  // already written the converted markdown to settings.outputDocument — clean
  // it in place. When run standalone, settings.sourceDocument is the markdown
  // to clean and we seed settings.outputDocument from it first.
  const priorConvert = Array.isArray(data.steps)
    ? data.steps.map((s) => s && s.data).find((d) => d && typeof d.markdown === 'string' && d.outputDocument)
    : null;

  const sourceMarkdown = priorConvert ? priorConvert.outputDocument : settings.sourceDocument;
  const target = settings.outputDocument || sourceMarkdown;

  if (!sourceMarkdown || !target) {
    const error = 'clean-document requires a markdown source and an output path';
    logger.error(`[clean-document] ${error}`);
    return { response: { success: false, error }, receivedData: data, processedAt: new Date().toISOString() };
  }

  // Seed the output from the source markdown unless they're already the same
  // file (the chained convert step writes straight to the target). This leaves
  // the original converted markdown untouched on standalone runs.
  if (path.resolve(sourceMarkdown) !== path.resolve(target)) {
    await fs.copyFile(sourceMarkdown, target);
  }

  // Make sure the AI agent registry exists in this worker, then resolve the
  // configured "Document Processing" agent (provider/model come from whatever
  // the agent was set up with in the Agents screen).
  await ensureAIInstances(logger);
  const expert = resolveExpert({
    usage: 'Document Processing',
    agentName: data.agent,
    logger,
    label: 'Document Processing'
  });

  // Run the document cleaner over the target copy.
  const cleaner = new DocumentCleaner({
    expert: expert,
    provider: expert.provider,
    deployment: expert.modelName || expert.provider,
    maxChunkSize: settings.maxChunkSize,
    // Cleaning instructions come from the prompt library under the same
    // appBaseDir as the Agents file, so the step does not depend on APP_BASE_DIR
    // reaching this worker.
    prompts: libraryFor(resolveAppBaseDir())
  });
  const response = await cleaner.process(target);

  return {
    response,
    receivedData: data,
    processedAt: new Date().toISOString()
  };
}

module.exports = {
  run,
};
