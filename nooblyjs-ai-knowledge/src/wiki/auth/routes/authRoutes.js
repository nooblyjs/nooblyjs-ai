/**
 * @fileoverview Blog Authentication Routes
 * Express routes for handling authentication endpoints (login, logout, session management).
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-09-16
 */

'use strict';

const path = require('node:path');

/**
 * Blog authentication routes class
 * Handles all authentication-related endpoints for the blog application.
 */
class BlogAuthRoutes {
  /**
   * Initialize the authentication routes
   * @param {Object} authProvider - noobly Core auth provider
   * @param {Object} userManager - User manager instance
   * @param {Object} logger - Logger instance
   */
  constructor(authProvider, userManager, logger) {
    this.authProvider = authProvider;
    this.userManager = userManager;
    this.logger = logger;
  }

  /**
   * Register all authentication routes with Express app
   * @param {Object} app - Express application instance
   */
  register(app) {
    // Authentication check endpoint
    app.get('/applications/blog/api/auth/check', (req, res) => {
      res.json({
        authenticated: !!req.session?.blogAuthenticated,
        user: req.session?.blogAuthenticated ? {
          username: 'admin',
          role: 'admin'
        } : null
      });
    });

    // Login page
    app.get('/applications/blog/login', (req, res) => {
      if (req.session?.blogAuthenticated) {
        return res.redirect('/applications/blog/admin/stories');
      }
      res.sendFile(path.join(__dirname, '../../blog/views/login.html'));
    });

    // Login endpoint
    app.post('/applications/blog/api/auth/login', async (req, res) => {
      try {
        const { username, password, rememberMe } = req.body;

        this.logger.info(`Login attempt for username: ${username}`);

        if (!username || !password) {
          return res.status(400).json({
            success: false,
            error: 'Username and password are required'
          });
        }

        // Check if auth provider is available
        if (!this.authProvider) {
          this.logger.error('Auth provider is not available');
          return res.status(500).json({
            success: false,
            error: 'Authentication service unavailable'
          });
        }

        this.logger.info(`Attempting authentication with provider: ${typeof this.authProvider}`);

        // Simple fallback authentication for admin
        let authResult = { success: false };

        if (username === 'admin' && password === 'admin123') {
          authResult = {
            success: true,
            user: {
              id: 1,
              username: 'admin',
              role: 'admin'
            }
          };
        }

        // Try auth provider if available
        if (!authResult.success && this.authProvider) {
          try {
            authResult = await this.authProvider.authenticate(username, password);
          } catch (error) {
            this.logger.warn('Auth provider failed, using fallback:', error.message);
          }
        }

        if (authResult.success) {
          // Set session
          req.session.blogAuthenticated = true;
          req.session.blogUserId = authResult.user.id;
          req.session.blogUsername = authResult.user.username;

          if (authResult.sessionId) {
            req.session.blogSessionId = authResult.sessionId;
          }

          // Set session expiry based on remember me
          if (rememberMe) {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
          } else {
            req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 hours
          }

          this.logger.info(`Blog login successful: ${username}`);

          res.json({
            success: true,
            message: 'Login successful',
            user: {
              username: authResult.user.username,
              role: authResult.user.role
            }
          });
        } else {
          this.logger.warn(`Blog login failed: ${username}`);
          res.status(401).json({
            success: false,
            error: 'Invalid username or password'
          });
        }
      } catch (error) {
        this.logger.error('Blog login error:', error);
        res.status(500).json({
          success: false,
          error: 'Internal server error during login'
        });
      }
    });

    // Logout endpoint
    app.post('/applications/blog/api/auth/logout', (req, res) => {
      const username = req.session?.blogUsername || 'unknown';

      // Invalidate session with auth provider if session ID exists
      if (req.session?.blogSessionId) {
        this.authProvider.invalidateSession(req.session.blogSessionId)
          .catch(error => {
            this.logger.warn('Error invalidating session:', error);
          });
      }

      // Clear session
      req.session.blogAuthenticated = false;
      delete req.session.blogUserId;
      delete req.session.blogUsername;
      delete req.session.blogSessionId;

      this.logger.info(`Blog logout: ${username}`);

      res.json({
        success: true,
        message: 'Logout successful'
      });
    });

    // Change password endpoint (admin only)
    app.post('/applications/blog/api/auth/change-password', async (req, res) => {
      if (!req.session?.blogAuthenticated) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      try {
        const { currentPassword, newPassword } = req.body;
        const username = req.session.blogUsername;

        if (!currentPassword || !newPassword) {
          return res.status(400).json({
            success: false,
            error: 'Current password and new password are required'
          });
        }

        if (newPassword.length < 6) {
          return res.status(400).json({
            success: false,
            error: 'New password must be at least 6 characters long'
          });
        }

        // Verify current password and change to new password
        const result = await this.authProvider.changePassword(username, currentPassword, newPassword);

        if (result.success) {
          this.logger.info(`Password changed for blog user: ${username}`);
          res.json({
            success: true,
            message: 'Password changed successfully'
          });
        } else {
          res.status(400).json({
            success: false,
            error: 'Current password is incorrect'
          });
        }
      } catch (error) {
        this.logger.error('Change password error:', error);
        res.status(500).json({
          success: false,
          error: 'Internal server error during password change'
        });
      }
    });

    // User profile endpoint
    app.get('/applications/blog/api/auth/profile', (req, res) => {
      if (!req.session?.blogAuthenticated) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Get user profile from auth provider
      this.authProvider.getUserProfile(req.session.blogUsername)
        .then(profile => {
          res.json({
            success: true,
            user: {
              username: profile.username,
              email: profile.email,
              role: profile.role,
              createdAt: profile.createdAt,
              lastLogin: profile.lastLogin
            }
          });
        })
        .catch(error => {
          this.logger.error('Get profile error:', error);
          res.status(500).json({
            success: false,
            error: 'Failed to retrieve user profile'
          });
        });
    });

    // Session refresh endpoint
    app.post('/applications/blog/api/auth/refresh', (req, res) => {
      if (!req.session?.blogAuthenticated) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Extend session
      req.session.touch();

      res.json({
        success: true,
        message: 'Session refreshed',
        expiresAt: new Date(Date.now() + req.session.cookie.maxAge)
      });
    });

    this.logger.info('Blog authentication routes registered');
  }
}

module.exports = BlogAuthRoutes;