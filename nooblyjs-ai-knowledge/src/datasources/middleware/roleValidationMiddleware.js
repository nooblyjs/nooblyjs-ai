/**
 * @fileoverview Role Validation Middleware
 * Enforces role-based access control for datasources module
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

class RoleValidationMiddleware {
  /**
   * @param {Object} logger
   * @param {Object} [options]
   * @param {boolean} [options.anySignedIn=false] - true when the host has opened the datasources screens to
   *   everyone it signs in (NooblyJS): a sign-in is still required, a role is not.
   */
  constructor(logger, options = {}) {
    this.logger = logger;
    this.anySignedIn = options.anySignedIn === true;
    this.requiredRole = 'Datasources Administrator';
    // A global 'admin' is a superuser and satisfies the datasources requirement
    // too — this matches the /services portal, which gates on 'admin'. Keeping
    // these aligned avoids users bouncing between portals with different roles.
    this.allowedRoles = [this.requiredRole, 'admin'];
  }

  /**
   * Middleware to require Datasources Administrator role
   * Checks if user is authenticated and has the required role
   * For HTML requests, redirects to error page
   * For API requests, returns JSON error response
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  requireDataSourcesAdmin(req, res, next) {
    // Check if user is authenticated
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      this.logger?.warn('Unauthorized access attempt - not authenticated', {
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      // For API requests, return JSON error
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          timestamp: new Date().toISOString()
        });
      }

      // For HTML requests, redirect to the authservice login page with a
      // returnUrl so the user lands back here after signing in. (There is no
      // '/login' route — redirecting there produced a 404 dead-end.)
      const returnUrl = encodeURIComponent(req.originalUrl);
      return res.redirect(`/services/authservice/views/login.html?returnUrl=${returnUrl}`);
    }

    if (this.anySignedIn) return next();

    // Check if user has the required role
    const userRoles = Array.isArray(req.user?.roles) ? req.user.roles : [req.user?.role || 'user'];

    if (!userRoles.some(role => this.allowedRoles.includes(role))) {
      this.logger?.warn('Unauthorized access attempt - insufficient role', {
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        userEmail: req.user?.email,
        userRoles: userRoles,
        requiredRole: this.requiredRole,
        ip: req.ip,
        userAgent: req.get('user-agent')
      });

      // For API requests, return JSON error
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({
          success: false,
          message: `Access denied. Requires one of: ${this.allowedRoles.join(', ')}. Current roles: ${userRoles.join(', ') || 'none'}`,
          requiredRole: this.requiredRole,
          allowedRoles: this.allowedRoles,
          currentRoles: userRoles,
          timestamp: new Date().toISOString()
        });
      }

      // For HTML requests, redirect to error page
      return res.redirect('/services/authservice/invalid.html');
    }

    // User has required role, allow access
    next();
  }
}

module.exports = RoleValidationMiddleware;
