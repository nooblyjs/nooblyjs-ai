/**
 * @fileoverview Cache Middleware
 * Provides generic caching decorator for Express route handlers
 * Supports TTL-based invalidation and cache key generation
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

/**
 * Creates a cache middleware wrapper for an async route handler
 * Intercepts requests, checks cache, and stores responses
 *
 * @param {Object} cacheService - Cache service instance from digital-technologies-core
 * @param {Function} handler - Express route handler to wrap
 * @param {Object} options - Configuration options
 * @param {string} options.keyPrefix - Prefix for cache keys (e.g., 'workflows')
 * @param {number} options.ttl - Time-to-live in seconds (default: 300)
 * @param {Function} options.keyGenerator - Custom key generator function(req)
 * @returns {Function} Express middleware function
 */
function cacheMiddleware(cacheService, handler, options = {}) {
  const {
    keyPrefix = 'cache',
    ttl = 300,
    keyGenerator = defaultKeyGenerator
  } = options;

  return async (req, res) => {
    // Skip caching for authenticated users with bypass flag
    if (req.query.__nocache === 'true') {
      return handler(req, res);
    }

    // Generate cache key
    const cacheKey = keyGenerator(req, keyPrefix);

    try {
      // Try to get from cache
      const cached = await cacheService.get(cacheKey);
      if (cached !== undefined && cached !== null) {
        // Set cache hit header
        res.set('X-Cache', 'HIT');
        return res.json(cached);
      }
    } catch (error) {
      // Log error but continue to handler (it's a miss)
      if (req.app?.get?.('logger')?.debug) {
        req.app.get('logger').debug('Cache read error', { cacheKey, error });
      }
    }

    // Mark cache miss
    res.set('X-Cache', 'MISS');

    // Intercept res.json to cache the response
    const originalJson = res.json;
    res.json = function(data) {
      // Cache successful responses if they have content
      let hasContent = false;
      if (Array.isArray(data)) {
        hasContent = data.length > 0;
      } else if (data?.data) {
        hasContent = Array.isArray(data.data) ? data.data.length > 0 :
                     typeof data.data === 'object' ? Object.keys(data.data).length > 0 :
                     true;
      } else if (typeof data === 'object' && data !== null) {
        hasContent = Object.keys(data).length > 0;
      }

      if (res.statusCode === 200 && data?.success !== false && hasContent) {
        // Cache write is async
        try {
          const result = cacheService.set(cacheKey, data, { ttl });
          if (result && typeof result.catch === 'function') {
            result.catch(error => {
              if (req.app?.get?.('logger')?.error) {
                req.app.get('logger').error('Cache write error', { cacheKey, error });
              }
            });
          }
        } catch (error) {
          if (req.app?.get?.('logger')?.error) {
            req.app.get('logger').error('Cache write error', { cacheKey, error });
          }
        }
      }
      return originalJson.apply(res, arguments);
    };

    // Call the original handler (await it if it's async)
    return await handler(req, res);
  };
}

/**
 * Default cache key generator
 * Creates a key from prefix, path, and query parameters
 *
 * @param {Object} req - Express request object
 * @param {string} keyPrefix - Cache key prefix
 * @returns {string} Cache key
 */
function defaultKeyGenerator(req, keyPrefix) {
  // Create consistent cache key from path and query (excluding __nocache)
  const queryParts = [];
  Object.entries(req.query || {})
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .forEach(([key, value]) => {
      if (key !== '__nocache') {
        queryParts.push(`${key}=${encodeURIComponent(value)}`);
      }
    });

  const queryStr = queryParts.length > 0 ? '?' + queryParts.join('&') : '';
  const basePath = req.path.replace(/^\/api\//, '');
  return `${keyPrefix}:${basePath}${queryStr}`;
}

/**
 * Creates a cache invalidation middleware
 * Clears cache entries matching a pattern when called
 *
 * @param {Object} cacheService - Cache service instance
 * @param {string|Array} keyPatterns - Cache key pattern(s) to invalidate
 * @returns {Function} Express middleware
 */
function invalidateCache(cacheService, keyPatterns = []) {
  return async (req, res, next) => {
    try {
      const patterns = Array.isArray(keyPatterns) ? keyPatterns : [keyPatterns];

      for (const pattern of patterns) {
        // Get all cache keys and filter by pattern
        const allKeys = typeof cacheService.keys === 'function' ? cacheService.keys() : (cacheService.keys || []);
        const keysToDelete = allKeys.filter(key =>
          key.includes(pattern) || pattern instanceof RegExp && pattern.test(key)
        );

        // Delete matching keys
        await Promise.all(keysToDelete.map(async (key) => {
          try {
            await cacheService.delete(key);
          } catch (error) {
            // Continue deleting other keys even if one fails
          }
        }));
      }
    } catch (error) {
      // Log but don't fail the request
      if (req.app?.get?.('logger')?.error) {
        req.app.get('logger').error('Cache invalidation error', { keyPatterns, error });
      }
    }

    next();
  };
}

/**
 * Wraps a route handler with caching
 * Simplifies the pattern of: cache check → handler → cache store
 *
 * Usage:
 *   const cached = withCache(cacheService, handler, { keyPrefix: 'workflows', ttl: 300 });
 *   app.get('/api/workflows', cached);
 *
 * @param {Object} cacheService - Cache service instance
 * @param {Function} handler - Async route handler
 * @param {Object} options - Cache options
 * @returns {Function} Wrapped handler
 */
function withCache(cacheService, handler, options = {}) {
  return cacheMiddleware(cacheService, handler, options);
}

module.exports = {
  cacheMiddleware,
  withCache,
  invalidateCache,
  defaultKeyGenerator
};
