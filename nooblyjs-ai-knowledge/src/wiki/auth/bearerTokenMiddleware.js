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
    const tokenData = {
      userId: user.id,
      username: user.username,
      email: user.email,
      // Persist the caller's roles so role-gated routes (e.g. the
      // requireDataSourcesAdmin guard on /api/workflows) see the real
      // privileges. Without this the static WORKFLOW_API_TOKEN service account
      // is downgraded to a role-less 'user' and schedule creation is rejected.
      roles: user.roles,
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
    return async (req, res, next) => {
      // Get authorization header
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        // Silently pass through if no Authorization header (using Passport session instead)
        return next();
      }

      // Check for Bearer token format
      if (!authHeader.startsWith('Bearer ')) {
        this.logger.debug(`[BearerTokenMiddleware] Invalid Authorization header format for ${req.method} ${req.path}`);
        return next();
      }

      // Extract token
      const token = authHeader.substring('Bearer '.length);
      this.logger.debug(`[BearerTokenMiddleware] Validating token for ${req.method} ${req.path}:`, token.substring(0, 10) + '...');

      // Look up token in local store
      const tokenData = validTokens.get(token);

      if (tokenData) {
        // Check if token is expired
        if (new Date(tokenData.expiresAt) < new Date()) {
          this.logger.warn(`[BearerTokenMiddleware] Token expired:`, token.substring(0, 10) + '...');
          validTokens.delete(token);
          return next();
        }

        // Token is valid! Set user in request
        this.logger.info(`[BearerTokenMiddleware] Token valid for user: ${tokenData.email}`);
        this._setAuthenticatedUser(req, {
          id: tokenData.userId,
          username: tokenData.username,
          email: tokenData.email,
          roles: tokenData.roles
        });
        return next();
      }

      // User-issued personal access token (dtk_) from the core auth service.
      // These act as the owning user with their live roles. Deliberately NOT
      // cached in validTokens: validateApiToken is an O(1) in-memory lookup, and
      // skipping the cache means revoking a token in the core takes effect on the
      // very next request rather than after the local cache entry expires.
      if (token.startsWith('dtk_')) {
        try {
          const authservice = req.app.get('authservice');
          if (authservice && typeof authservice.validateApiToken === 'function') {
            const result = await authservice.validateApiToken(token);
            if (result && result.email) {
              this.logger.info(`[BearerTokenMiddleware] API token valid for user: ${result.email}`);
              this._setAuthenticatedUser(req, {
                id: result.user && result.user.id,
                username: result.email,
                email: result.email,
                name: result.user && result.user.fullName,
                roles: result.roles
              });
              return next();
            }
          }
        } catch (e) {
          this.logger.debug(`[BearerTokenMiddleware] API token validation failed: ${e.message}`);
        }
        // A dtk_ token was presented but is invalid/expired/revoked — pass
        // through unauthenticated rather than falling back to session lookup.
        return next();
      }

      // Token not in local store — try core auth service as fallback
      try {
        const authservice = req.app.get('authservice');
        if (authservice && authservice.validateSession) {
          const session = await authservice.validateSession(token);
          if (session) {
            this.logger.info(`[BearerTokenMiddleware] Token validated via core auth service for user: ${session.username}`);
            // Cache the token locally for future requests
            const user = { id: session.userId, username: session.username, email: session.username };
            this.registerToken(token, user, session.expiresAt ? new Date(session.expiresAt) - Date.now() : undefined);
            this._setAuthenticatedUser(req, user);
            return next();
          }
        }
      } catch (e) {
        this.logger.debug(`[BearerTokenMiddleware] Core auth validation failed:`, e.message);
      }

      this.logger.warn(`[BearerTokenMiddleware] Token not found or invalid:`, token.substring(0, 10) + '...');
      return next();
    };
  }

  /**
   * Set the authenticated user on the request object
   * @param {Object} req - Express request
   * @param {Object} user - User data {id, username, email}
   * @private
   */
  _setAuthenticatedUser(req, user) {
    req.user = user;

    // Override isAuthenticated() to return true for Bearer token auth.
    // Do NOT mutate req.session.passport — bearer auth is stateless. If a
    // browser session cookie is also present (e.g. the Chrome extension
    // sends credentials: 'include'), writing to session.passport.user
    // overwrites the real web user's id with this token's id and
    // express-session persists it, silently logging the web user out.
    const originalIsAuthenticated = req.isAuthenticated ? req.isAuthenticated.bind(req) : () => false;
    req.isAuthenticated = function() {
      return req.user !== undefined || originalIsAuthenticated();
    };

    this.logger.debug(`[BearerTokenMiddleware] Request marked as authenticated for user: ${user.email || user.username}`);
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
