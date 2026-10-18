/**
 * @fileoverview Bearer Token Authentication Middleware
 * Validates Bearer tokens from Authorization headers for API clients (VS Code extension, etc)
 * This middleware enables API clients to authenticate without requiring session cookies.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-01-14
 */

'use strict';

/**
 * In-memory store for valid tokens during runtime
 * Maps token -> {userId, email, username, createdAt, expiresAt}
 * @type {Map<string, Object>}
 */
const validTokens = new Map();

/**
 * Bearer Token Authentication Middleware
 * Checks Authorization header for Bearer tokens and validates them
 */
class BearerTokenMiddleware {
  /**
   * Initialize the bearer token middleware
   * @param {Object} logger - Logger instance
   * @param {Object} cache - Cache service (optional, for persistence)
   */
  constructor(logger, cache = null) {
    this.logger = logger;
    this.cache = cache;
  }

  /**
   * Register a token as valid when user logs in
   * Called from login endpoint after successful authentication
   *
   * @param {string} token - The session token to validate
   * @param {Object} user - User object {id, username, email, etc}
   * @param {number} expiresIn - Expiration time in milliseconds (default 24 hours)
   */
  registerToken(token, user, expiresIn = 24 * 60 * 60 * 1000) {
    if (!token || !user) {
      this.logger.warn('[BearerTokenMiddleware] Cannot register token: missing token or user');
      return;
    }

    const expiresAt = new Date(Date.now() + expiresIn);
    const userRoles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];
    const tokenData = {
      userId: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
      roles: userRoles,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    validTokens.set(token, tokenData);
    this.logger.info(`[BearerTokenMiddleware] Registered token for user: ${user.email}`);
  }

  /**
   * Revoke a token (logout)
   * @param {string} token - The token to revoke
   */
  revokeToken(token) {
    if (validTokens.delete(token)) {
      this.logger.info('[BearerTokenMiddleware] Token revoked');
    }
  }

  /**
   * Get all valid tokens (for debugging)
   * @returns {number} Number of valid tokens
   */
  getTokenCount() {
    return validTokens.size;
  }

  /**
   * Clear expired tokens
   */
  clearExpiredTokens() {
    const now = new Date();
    let clearedCount = 0;

    for (const [token, data] of validTokens.entries()) {
      if (new Date(data.expiresAt) < now) {
        validTokens.delete(token);
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      this.logger.info(`[BearerTokenMiddleware] Cleared ${clearedCount} expired tokens`);
    }
  }

  /**
   * Express middleware to validate Bearer tokens
   * Checks Authorization header and sets req.user if token is valid
   *
   * @returns {Function} Express middleware function
   */
  middleware() {
    return (req, res, next) => {
      // Get authorization header
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return next();
      }

      // Check for Bearer token format
      if (!authHeader.startsWith('Bearer ')) {
        return next();
      }

      // Extract token
      const token = authHeader.substring('Bearer '.length);

      // Look up token
      const tokenData = validTokens.get(token);

      if (!tokenData) {
        return next();
      }

      // Check if token is expired
      if (new Date(tokenData.expiresAt) < new Date()) {
        validTokens.delete(token);
        return next();
      }

      // Token is valid! Set user in request
      req.user = {
        id: tokenData.userId,
        username: tokenData.username,
        email: tokenData.email,
        name: tokenData.name,
        roles: Array.isArray(tokenData.roles) ? tokenData.roles : ['user']
      };

      // Override isAuthenticated() to return true for Bearer token auth.
      // Do NOT mutate req.session.passport — bearer auth is stateless. If a
      // browser session cookie is also present (e.g. the Chrome extension
      // sends credentials: 'include'), writing to session.passport.user
      // overwrites the real web user's id with this token's id and
      // express-session persists it, silently logging the web user out.
      const originalIsAuthenticated = req.isAuthenticated
        ? req.isAuthenticated.bind(req)
        : () => false;
      req.isAuthenticated = function() {
        return req.user !== undefined || originalIsAuthenticated();
      };

      next();
    };
  }

  /**
   * Get token statistics for debugging
   * @returns {Object} Token statistics
   */
  getStats() {
    let expiredCount = 0;
    const now = new Date();

    for (const [token, data] of validTokens.entries()) {
      if (new Date(data.expiresAt) < now) {
        expiredCount++;
      }
    }

    return {
      totalTokens: validTokens.size,
      expiredTokens: expiredCount,
      validTokens: validTokens.size - expiredCount
    };
  }
}

module.exports = BearerTokenMiddleware;
