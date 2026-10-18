/**
 * @fileoverview Wiki data initialization check.
 *
 * Spaces are a small JSON registry (spaces.json). Documents are NOT tracked in
 * JSON — they are derived live from each space's filing service (see
 * DocumentService) and indexed for search by the SearchIndexer reading from
 * disk. So initialization only needs to ensure the spaces registry exists.
 *
 * @author noobly Team
 * @version 2.0.0
 * @since 2025-08-25
 */

'use strict';

/**
 * Initialize default wiki data.
 *
 * Extra service args (filing, cache, queue, search) are retained for call-site
 * compatibility but are no longer needed here.
 */
async function run(dataManager, _filing, _cache, logger, _queue, _search) {
  try {
    logger.info('Checking wiki data initialization...');

    const existingSpaces = await dataManager.read('spaces');
    logger.info(`Found ${existingSpaces.length} existing space(s)`);

    if (existingSpaces.length === 0) {
      // Wizard will populate this on first run.
      await dataManager.write('spaces', []);
      logger.info('Initialized empty spaces.json - waiting for wizard setup');
    } else {
      logger.info('Wiki spaces already exist, skipping initialization');
    }
  } catch (error) {
    logger.error('Error initializing wiki data:', error?.message || 'Unknown error');
    if (error?.stack) {
      logger.error('Stack trace:', error.stack);
    }
    // Re-throw to propagate the error
    throw error;
  }
}

module.exports = { run };
