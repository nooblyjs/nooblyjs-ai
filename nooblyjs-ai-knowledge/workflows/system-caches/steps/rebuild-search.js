/**
 * @fileoverview Maintenance step 2 — Rebuild the full-text search index.
 *
 * Force-rebuilds the wiki search index from the documents on disk, skipping the
 * on-disk index cache (force: true), so the index reflects the true current
 * state of every space. Uses the live, already-initialised indexer instance
 * (global.searchIndexer) that the wiki search routes query, so the rebuilt
 * index is the one users immediately search against.
 *
 * Unlike the HTTP /search/rebuild endpoint (which kicks the rebuild off in the
 * background and returns straight away), this step awaits completion so the
 * workflow only reports success once the index is actually ready, and includes
 * the resulting index statistics in its output.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const serviceRegistry = require('nooblyjs-core');

/**
 * @param {Object} data - Workflow context (upstream clear-caches output at data.steps[0].data).
 * @returns {Promise<Object>} Rebuild outcome + index stats.
 */
async function run(data) {
  const logger = serviceRegistry.logger();

  const result = {
    message: '',
    rebuilt: false,
    durationMs: null,
    stats: null,
    upstream: (data && data.steps && data.steps[0]) ? data.steps[0].data : undefined,
    processedAt: new Date().toISOString()
  };

  const indexer = global.searchIndexer;
  if (!indexer || typeof indexer.buildIndex !== 'function') {
    const msg = 'global.searchIndexer not available — is the wiki module initialised in this process?';
    logger.error(`[RebuildSearch] ${msg}`);
    return { ...result, success: false, error: msg };
  }

  try {
    logger.info('[RebuildSearch] Forcing full search index rebuild (skipping disk cache)…');
    const started = Date.now();

    // force: true => ignore the on-disk index snapshot and re-read every doc.
    await indexer.buildIndex({ force: true });

    result.durationMs = Date.now() - started;
    result.rebuilt = true;

    if (typeof indexer.getStats === 'function') {
      try {
        result.stats = indexer.getStats();
      } catch (statErr) {
        logger.warn(`[RebuildSearch] Could not read index stats: ${statErr.message}`);
      }
    }

    result.message = `Search index rebuilt in ${result.durationMs}ms`;
    logger.info(`[RebuildSearch] ${result.message}`, result.stats || {});
    return result;
  } catch (error) {
    logger.error('[RebuildSearch] Failed to rebuild search index:', error.message);
    return { ...result, success: false, error: error.message };
  }
}

module.exports = { run };
