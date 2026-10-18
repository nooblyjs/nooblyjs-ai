/**
 * @fileoverview Workflow Authentication Middleware
 * Provides authentication and authorization middleware for workflow API endpoints
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

/**
 * Workflow Authentication Middleware
 * Protects workflow endpoints with authentication and authorization checks
 */
class WorkflowAuthMiddleware {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Middleware to require authentication
   * Checks if user is logged in via Passport/session
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  requireAuth(req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      this.logger?.warn('Unauthorized access attempt', {
        path: req.path,
        method: req.method,
        ip: req.ip
      });

      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        timestamp: new Date().toISOString()
      });
    }

    next();
  }

  /**
   * Middleware to require admin privileges
   * Checks if user is authenticated and has admin role
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  requireAdmin(req, res, next) {
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        timestamp: new Date().toISOString()
      });
    }

    // Check if user has admin role
    if (!req.user || !req.user.isAdmin) {
      this.logger?.warn('Unauthorized admin access attempt', {
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        ip: req.ip
      });

      return res.status(403).json({
        success: false,
        message: 'Admin privileges required',
        timestamp: new Date().toISOString()
      });
    }

    next();
  }
}

module.exports = WorkflowAuthMiddleware;
