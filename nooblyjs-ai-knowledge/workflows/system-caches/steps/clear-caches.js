/**
 * @fileoverview Maintenance step 1 — Clear server-side caches.
 *
 * Flushes the in-memory cache service that backs the cached wiki API responses
 * (search, suggestions, navigation, spaces, …) and invalidates the per-space
 * folder tree cache. After this runs, the next client request for any of those
 * resources is a cache MISS and is served fresh from disk; ETag-based clients
 * (the navigation tree) revalidate because the tree cache bumps its version.
 *
 * Runs in-process against the live backend: the workflow engine and the wiki
 * module share the same singleton cache (serviceRegistry.caching('memory')) and
 * the same global.treeCache, so clearing them here clears what the HTTP layer
 * reads. No auth token or base URL needed.
 *
 * Input (optional, from defaultInput):
 *   - cacheKeyPrefixes {string[]} key prefixes to delete (default ['wiki:'])
 *   - clearAllCacheKeys {boolean} when true, deletes every cache key (overrides prefixes)
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const serviceRegistry = require('nooblyjs-core');

/**
 * @param {Object} data - Workflow context / input.
 * @returns {Promise<Object>} Summary of what was cleared.
 */
async function run(data) {
  const logger = serviceRegistry.logger();

  const prefixes = Array.isArray(data && data.cacheKeyPrefixes) && data.cacheKeyPrefixes.length
    ? data.cacheKeyPrefixes
    : ['wiki:'];
  const clearAll = !!(data && data.clearAllCacheKeys);

  const result = {
    message: '',
    cacheKeysDeleted: 0,
    deletedKeys: [],
    treeCacheCleared: false,
    clearAll,
    prefixes,
    processedAt: new Date().toISOString()
  };

  try {
    // 1) In-memory cache service (same singleton the cacheMiddleware writes to).
    const cache = serviceRegistry.caching('memory');

    if (cache && typeof cache.keys === 'function' && typeof cache.delete === 'function') {
      const allKeys = typeof cache.keys === 'function' ? (cache.keys() || []) : (cache.keys || []);
      const keysToDelete = clearAll
        ? allKeys
        : allKeys.filter(key => prefixes.some(p => String(key).startsWith(p) || String(key).includes(p)));

      for (const key of keysToDelete) {
        try {
          await cache.delete(key);
          result.deletedKeys.push(key);
        } catch (err) {
          logger.warn(`[ClearCaches] Failed to delete cache key "${key}": ${err.message}`);
        }
      }
      result.cacheKeysDeleted = result.deletedKeys.length;
      logger.info(`[ClearCaches] Deleted ${result.cacheKeysDeleted} cache key(s) (clearAll=${clearAll}, prefixes=${prefixes.join(',')})`);
    } else {
      logger.warn('[ClearCaches] Cache service has no keys()/delete() — skipping cache flush');
    }

    // 2) Per-space folder tree cache (in-memory, ETag-validated).
    if (global.treeCache && typeof global.treeCache.invalidateAll === 'function') {
      global.treeCache.invalidateAll();
      result.treeCacheCleared = true;
      logger.info('[ClearCaches] Folder tree cache invalidated (all spaces)');
    } else {
      logger.warn('[ClearCaches] global.treeCache not available — skipping tree cache invalidation');
    }

    result.message = `Cleared ${result.cacheKeysDeleted} cache key(s); treeCache ${result.treeCacheCleared ? 'invalidated' : 'skipped'}`;
    return result;
  } catch (error) {
    logger.error('[ClearCaches] Error clearing caches:', error.message);
    return {
      ...result,
      success: false,
      error: error.message
    };
  }
}

module.exports = { run };
