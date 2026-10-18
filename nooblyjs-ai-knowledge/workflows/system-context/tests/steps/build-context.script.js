/**
 * @fileoverview Manual test runner for the build-context workflow step.
 *
 * Thin harness: a settings construct + a worker.start() of the step. All the
 * folder-walking / file-reading lives in the step and its services
 * (DiskFileSource / ContextProcessor) — not here. Sibling of
 * solution-design/tests/steps/businessSolutionContent.js.
 *
 * `path` selects the step's folder mode: it walks that folder (relative to cwd or
 * absolute) and writes the .context sidecars in place — no spaces.json, no
 * backend. (Omit `path` and set `space` instead to walk a space by name/id,
 * resolved to its on-disk baseDir through spaces.json.)
 * `appBaseDir` locates the "Folder Processing" agent (settings-agents.json); the
 * AI provider it points at must be reachable.
 *
 * Usage:
 *   node build-context.js                                   # default path below
 *   node build-context.js "C:/work-dt/knowledge-content/enterprise/Technology"
 *   node build-context.js ../../../knowledge-content/enterprise force
 *
 * @author Digital Technologies Team
 * @version 3.0.0
 */

'use strict';

// Dependancies
const path = require('node:path');
const express = require('express');

// Load the knowledge platform .env (APP_BASE_DIR + AI provider settings).
require('dotenv').config({ path: path.join(__dirname, '../../../../.env'), quiet: true });

// Initialize registry (no public folder needed!)
const app = express();
app.use(express.json());
const serviceRegistry = require('nooblyjs-core');
serviceRegistry.initialize(app);

// The settings for testing.
const settings = {
  path: process.argv[2] || 'C:\\work-content\\knowledge-repository-enterprise-process',     // disk mode: folder to walk
  appBaseDir: 'C:/work-dt/.application',                                   // where settings-agents.json lives
  agent: '',                                                              // '' = the agent tagged "Folder Processing"
  force: false,     // regenerate existing sidecars
};

// Create a worker that runs the step from system-context/steps/.
const queueing = serviceRegistry.queue();
const logger = serviceRegistry.logger();
const worker = serviceRegistry.working('default', {
  maxThreads: 4,
  activitiesFolder: path.join(__dirname, '../../steps/'),
  dependencies: {
    queueing,
    logger,
  },
});

logger.info('Build Context test: starting worker', settings);

// Start the worker — `settings` is delivered verbatim as the step's `run(data)`.
worker.start(
  'build-context.js',
  settings,
  function (status, result) {
    // status is 'completed' (result = run summary) or 'error' (result = message).
    console.log('Worker completed with status:', status);
    console.log('Worker result:', JSON.stringify(result, null, 2));
    process.exit(status === 'completed' ? 0 : 1);
  }
).then((taskId) => {
  logger.info('Build Context Task queued with ID:', taskId);
}).catch((err) => {
  logger.error('Failed to queue Build Context Task:', err);
  process.exit(1);
});
