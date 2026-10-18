/**
 * @fileoverview Blog Authentication Middleware
 * Express middleware for handling authentication and authorization in the blog application.
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-09-16
 */

'use strict';

/**
 * Blog authentication middleware class
 * Provides middleware functions for protecting routes and checking permissions.
 */
class BlogAuthMiddleware {
  /**
   * Initialize the authentication middleware
   * @param {Object} authProvider - noobly Core auth provider
   * @param {Object} logger - Logger instance
   */
  constructor(authProvider, logger) {
    this.authProvider = authProvider;
    this.logger = logger;
  }

  /**
   * Middleware to require authentication
   * Checks if user is logged in and has a valid session
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  requireAuth(req, res, next) {
    // Check session-based authentication (matching wiki pattern)
    if (!req.session || !req.session.blogAuthenticated) {
      if (req.headers.accept && req.headers.accept.includes('application/json')) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'Please log in to access this resource'
        });
      }
      return res.redirect('/applications/blog/login');
    }

    // Validate session with auth provider if session ID exists
    if (req.session.blogSessionId) {
      this.authProvider.validateSession(req.session.blogSessionId)
        .then(sessionData => {
          if (sessionData && sessionData.user) {
            req.user = sessionData.user;
            req.blogAuth = {
              authenticated: true,
              user: sessionData.user,
              roles: sessionData.user.roles || ['user']
            };
            next();
          } else {
            this.handleAuthFailure(req, res);
          }
        })
        .catch(error => {
          this.logger.warn('Session validation error:', error);
          this.handleAuthFailure(req, res);
        });
    } else {
      // Basic session check passed, continue
      req.blogAuth = {
        authenticated: true,
        user: { username: 'admin', role: 'admin' }, // Default for simple session
        roles: ['admin']
      };
      next();
    }
  }

  /**
   * Middleware to require admin privileges
   * Checks if user is authenticated and has admin role
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  requireAdmin(req, res, next) {
    // First check authentication
    this.requireAuth(req, res, (authError) => {
      if (authError) return;

      // Check for admin role
      const userRoles = req.blogAuth?.roles || [];
      if (!userRoles.includes('admin')) {
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
          return res.status(403).json({
            error: 'Insufficient privileges',
            message: 'Admin access required'
          });
        }
        return res.redirect('/applications/blog?error=access_denied');
      }

      next();
    });
  }

  /**
   * Middleware to check if user is already authenticated
   * Redirects authenticated users away from login pages
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  redirectIfAuthenticated(req, res, next) {
    if (req.session && req.session.blogAuthenticated) {
      return res.redirect('/applications/blog/admin/stories');
    }
    next();
  }

  /**
   * Optional authentication middleware
   * Adds user info to request if authenticated but doesn't require it
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  optionalAuth(req, res, next) {
    if (req.session && req.session.blogAuthenticated) {
      req.blogAuth = {
        authenticated: true,
        user: { username: 'admin', role: 'admin' },
        roles: ['admin']
      };
    } else {
      req.blogAuth = {
        authenticated: false,
        user: null,
        roles: ['guest']
      };
    }
    next();
  }

  /**
   * Handle authentication failure
   * @private
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  handleAuthFailure(req, res) {
    // Clear invalid session
    if (req.session) {
      req.session.blogAuthenticated = false;
      delete req.session.blogSessionId;
    }

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or expired session'
      });
    }
    return res.redirect('/applications/blog/login');
  }

  /**
   * Middleware to log authentication events
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  logAuthEvents(req, res, next) {
    const userInfo = req.blogAuth?.user?.username || 'anonymous';
    this.logger.info(`Blog auth: ${req.method} ${req.path} - User: ${userInfo}`);
    next();
  }
}

module.exports = BlogAuthMiddleware;