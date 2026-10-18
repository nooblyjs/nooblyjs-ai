/**
 * @fileoverview Security & Access Control Routes
 * Provides endpoints for managing user roles and permissions
 * Endpoints for adding/removing authorized users and administrators
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

/**
 * Configure security and access control routes
 * @param {string} serviceName - Service name for logging
 * @param {Object} options - Configuration options
 * @param {Object} options['express-app'] - Express application instance
 * @param {Object} options.dependencies - Service dependencies (log, etc.)
 * @param {Object} eventEmitter - Event emitter for logging
 */
module.exports = (serviceName, options, eventEmitter) => {
  const app = options.app || options['express-app'];
  const { log } = options.dependencies;
  const securityManager = app.get('securityManager');

  if (!securityManager && log) {
    log.warn('SecurityManager not yet initialized, security routes may not be fully functional');
  }

  // Middleware to ensure user is authenticated
  const requireAuth = (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    next();
  };

  // Middleware to ensure user is an admin
  const requireAdmin = (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const userRole = securityManager.getUserRole(req.user.email);
    if (userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Administrator access required'
      });
    }

    next();
  };

  /**
   * GET /api/security
   * Get security configuration (users and administrators) (admins only)
   */
  app.get('/api/security', requireAdmin, (req, res) => {
    try {
      log.info('🔐 [/api/security] GET request received');
      log.info('🔐 [/api/security] securityManager exists:', !!securityManager);

      if (!securityManager) {
        log.error('🔐 [/api/security] ✗ SecurityManager is not initialized!');
        return res.status(500).json({
          success: false,
          message: 'SecurityManager not initialized'
        });
      }

      const users = securityManager.getUsers() || [];
      const administrators = securityManager.getAdmins() || [];

      log.info('🔐 [/api/security] Retrieved users:', users);
      log.info('🔐 [/api/security] Retrieved administrators:', administrators);

      res.json({
        success: true,
        data: {
          users: users,
          administrators: administrators
        }
      });

      log.info('🔐 [/api/security] Response sent successfully');
    } catch (error) {
      log.error('🔐 [/api/security] ✗ Error fetching security data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch security data',
        error: error.message
      });
    }
  });

  /**
   * GET /api/security/summary
   * Get security configuration summary (admins only)
   */
  app.get('/api/security/summary', requireAdmin, (req, res) => {
    try {
      const summary = securityManager.getSummary();
      res.json({
        success: true,
        data: summary
      });
    } catch (error) {
      log.error('Error fetching security summary:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch security summary'
      });
    }
  });

  /**
   * POST /api/security/user
   * Add an authorized user (admins only)
   *
   * Request body:
   * - email: User email address
   */
  app.post('/api/security/user', requireAdmin, (req, res) => {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Valid email address is required'
        });
      }

      const result = securityManager.addUser(email);

      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      log.error('Error adding user:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to add user'
      });
    }
  });

  /**
   * DELETE /api/security/user/:email
   * Remove an authorized user (admins only)
   */
  app.delete('/api/security/user/:email', requireAdmin, (req, res) => {
    try {
      const { email } = req.params;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      const result = securityManager.removeUser(decodeURIComponent(email));

      if (result.success) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      log.error('Error removing user:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to remove user'
      });
    }
  });

  /**
   * POST /api/security/admin
   * Add an administrator (admins only)
   *
   * Request body:
   * - email: User email address
   */
  app.post('/api/security/admin', requireAdmin, (req, res) => {
    try {
      const { email } = req.body;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Valid email address is required'
        });
      }

      const result = securityManager.addAdmin(email);

      if (result.success) {
        res.status(201).json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      log.error('Error adding administrator:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to add administrator'
      });
    }
  });

  /**
   * DELETE /api/security/admin/:email
   * Remove an administrator (admins only)
   */
  app.delete('/api/security/admin/:email', requireAdmin, (req, res) => {
    try {
      const { email } = req.params;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      const result = securityManager.removeAdmin(decodeURIComponent(email));

      if (result.success) {
        res.json(result);
      } else {
        res.status(404).json(result);
      }
    } catch (error) {
      log.error('Error removing administrator:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to remove administrator'
      });
    }
  });

  log.info('Security routes registered successfully');
};
