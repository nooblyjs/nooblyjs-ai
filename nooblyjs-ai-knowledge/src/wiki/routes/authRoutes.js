/**
 * @fileoverview Wiki Authentication Routes Bridge
 * Provides authentication endpoints for the Wiki application by bridging to the
 * nooblyjs-core authentication service. Handles user registration, login, logout,
 * and session validation while maintaining wiki-specific behavior (wizard redirects, etc.)
 *
 * This module acts as an adapter layer between the frontend's expected `/api/auth/`
 * endpoints and the core service's `/services/authservice/api/` endpoints.
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-11-06
 */

'use strict';

const { userDir: toUserDir } = require('../components/spacePermissions');

/**
 * Configures and registers wiki authentication routes with the Express application.
 * Bridges frontend requests to the nooblyjs-core authentication service.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} options.app - The Express application instance
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services object
 * @param {Object} services.dataManager - Data manager for wiki data persistence
 * @param {Object} services.logger - Logger service instance
 * @param {Object} services.userInitializer - User initialization tracker
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {
  const app = options.app;
  const { log, userInitializer } = services;

  // Helper function to handle async route errors with proper error response
  const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      log.error('Auth route error:', err.message);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    });
  };

  /**
   * POST /api/auth/register
   * Registers a new user account and creates a session.
   * Delegates to nooblyjs-core auth service.
   *
   * Request body:
   * - name: User's full name
   * - email: User's email address
   * - password: User's password
   *
   * Response:
   * - success: boolean
   * - needsWizard: boolean - indicates if user should complete setup wizard
   * - user: object with id, email, name, initialized flag
   * - message: string
   */
  app.post('/api/auth/register', asyncHandler(async (req, res) => {
    try {
      const { email, password, name } = req.body;

      // Validate required fields
      if (!email || !password || !name) {
        return res.status(400).json({
          success: false,
          message: 'Email, password, and name are required'
        });
      }

      log.info(`Registration attempt for email: ${email}`);

      // Call the core auth service's createUser method
      // The auth service is available via serviceRegistry, which was initialized in app.js
      // We need to access it from the app context where it's available
      const authService = req.app.get('authservice');

      if (!authService) {
        log.error('Auth service not available in app context');
        return res.status(500).json({
          success: false,
          message: 'Authentication service unavailable'
        });
      }

      // Generate username from email (convert email to valid username)
      // Use the part before @ and replace invalid chars with underscores
      const username = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

      // Create user through the auth service
      // The core service requires: username, email, password
      const user = await authService.createUser({
        username,
        email,
        password,
        role: 'user'
      });

      log.info(`User created successfully: ${username} (id: ${user.id})`);

      // Establish session through Passport so req.isAuthenticated() works
      if (req.logIn) {
        await new Promise((resolve, reject) => {
          req.logIn(user, (err) => {
            if (err) {
              log.error('Error establishing session after registration:', err.message);
              return reject(err);
            }
            resolve();
          });
        });
      }

      eventEmitter.emit('wiki:user-registered', { email });

      // Ensure user initializer has this user marked as not initialized
      if (userInitializer) {
        await userInitializer.ensureFiles();
        // User already defaults to not initialized (no entry in file means false)
      }

      res.status(201).json({
        success: true,
        needsWizard: true,  // New users always need to complete wizard
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: name,  // Use the name from request, as core service doesn't store it
          initialized: false
        },
        message: 'Registration successful'
      });
    } catch (error) {
      log.error('Registration error:', error.message);

      // Check if user already exists
      if (error.message && error.message.includes('already exists')) {
        return res.status(400).json({
          success: false,
          message: 'User already exists with this email'
        });
      }

      res.status(500).json({
        success: false,
        message: error.message || 'Registration failed'
      });
    }
  }));

  /**
   * POST /api/auth/login
   * Authenticates a user and creates a session.
   * Delegates to nooblyjs-core auth service.
   *
   * Request body:
   * - email: User's email address
   * - password: User's password
   *
   * Response:
   * - success: boolean
   * - needsWizard: boolean - indicates if user should complete setup wizard
   * - user: object with id, email, name, initialized flag
   * - message: string
   */
  app.post('/api/auth/login', asyncHandler(async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validate required fields
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Email and password are required'
        });
      }

      log.info(`Login attempt for email: ${email}`);

      const authService = req.app.get('authservice');

      if (!authService) {
        log.error('Auth service not available in app context');
        return res.status(500).json({
          success: false,
          message: 'Authentication service unavailable'
        });
      }

      // Log which auth provider is being used
      const authProviderType = authService.constructor.name;
      log.info(`Using auth provider: ${authProviderType}`);

      // Generate username from email (same logic as register)
      const normalizedUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

      log.info(`Generated username from email: ${normalizedUsername}`);

      // Authenticate user through the auth service using username
      // The core service authenticates via username + password
      // Try both the normalized username and the full email (for backward compatibility)
      // Returns { user: {...}, session: {...} }
      let authResult = null;

      try {
        log.info(`Calling authenticateUser on ${authProviderType} with username: ${normalizedUsername}`);
        authResult = await authService.authenticateUser(normalizedUsername, password);
      } catch (error) {
        // If normalized username fails, try with full email address
        log.info(`Normalized username failed, trying full email: ${email}`);
        try {
          authResult = await authService.authenticateUser(email, password);
        } catch (emailError) {
          // Both failed, let the original error through
          throw error;
        }
      }

      if (!authResult || !authResult.user) {
        log.warn(`Login failed for email: ${email}`);
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      const user = authResult.user;
      const session = authResult.session;

      log.info(`Auth service result: user=${user ? 'present' : 'missing'}, session=${session ? 'present' : 'missing'}`);

      // Establish session through Passport so req.isAuthenticated() works
      if (req.logIn) {
        await new Promise((resolve, reject) => {
          req.logIn(user, (err) => {
            if (err) {
              log.error('Error establishing session after login:', err.message);
              return reject(err);
            }
            resolve();
          });
        });
      }

      // Register Bearer token for API client access (VS Code extension, etc)
      if (session && session.token && global.bearerTokenMiddleware) {
        log.info(`Registering Bearer token for user: ${email}`);
        global.bearerTokenMiddleware.registerToken(session.token, user);
        log.info(`Bearer token registered, active tokens: ${global.bearerTokenMiddleware.getTokenCount()}`);
      } else {
        log.warn(`Could not register Bearer token: session=${!!session}, token=${session?.token ? 'present' : 'missing'}, middleware=${!!global.bearerTokenMiddleware}`);
      }

      // Check if user has initialized via user initializer
      let isInitialized = false;
      if (userInitializer) {
        isInitialized = await userInitializer.isInitialized(user.username);
      }

      eventEmitter.emit('wiki:user-login', { email });
      log.info(`Login successful for email: ${email}`);

      res.status(200).json({
        success: true,
        needsWizard: !isInitialized,  // Check if user completed wizard
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name || user.username,  // Use username as fallback for name
          initialized: isInitialized
        },
        data: {
          user: {
            id: user.id,
            username: user.username,
            email: user.email
          },
          session: session || {}  // Include session token in response for API clients
        },
        message: 'Login successful'
      });
    } catch (error) {
      log.error('Login error:', error.message);
      res.status(500).json({
        success: false,
        message: error.message || 'Login failed'
      });
    }
  }));

  /**
   * POST /api/auth/logout
   * Logs out the current user and destroys their session.
   *
   * Response:
   * - success: boolean
   * - message: string
   */
  app.post('/api/auth/logout', asyncHandler(async (req, res) => {
    try {
      const email = req.user?.email || 'unknown';
      log.info(`Logout request for user: ${email}`);

      // Revoke Bearer token if present
      if (req.headers.authorization && global.bearerTokenMiddleware) {
        const authHeader = req.headers.authorization;
        if (authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring('Bearer '.length);
          global.bearerTokenMiddleware.revokeToken(token);
          log.info(`Bearer token revoked for user: ${email}`);
        }
      }

      // Destroy the session
      req.logout((err) => {
        if (err) {
          log.error('Error during logout:', err.message);
          return res.status(500).json({
            success: false,
            message: 'Error during logout'
          });
        }

        // Also destroy the session data
        req.session.destroy((sessErr) => {
          if (sessErr) {
            log.warn('Error destroying session:', sessErr.message);
            // Still return success even if session destroy fails
          }

          eventEmitter.emit('wiki:user-logout', { email });
          log.info(`Logout successful for user: ${email}`);

          res.status(200).json({
            success: true,
            message: 'Logout successful'
          });
        });
      });
    } catch (error) {
      log.error('Logout error:', error.message);
      res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }
  }));

  /**
   * POST /api/auth/identity
   * Authenticates a user based on a trusted external identity (Chrome profile, Teams, etc.).
   * Generates a bearer token for the identity-verified user.
   *
   * @param {express.Request} req - Express request object
   * @param {Object} req.body - Request body
   * @param {string} req.body.email - User email (from Chrome profile, Teams UPN, etc.)
   * @param {string} req.body.externalId - External identity ID (Chrome Gaia ID, Teams AAD ID, etc.) - optional
   * @param {string} req.body.source - Identity source ('chrome', 'teams', etc.) - optional, for audit
   * @param {express.Response} res - Express response object
   * @return {void}
   */
  app.post('/api/auth/identity', asyncHandler(async (req, res) => {
    // Support both new naming and legacy (gaiaId) for backwards compat
    const { email, externalId, gaiaId, source, fullName, displayName } = req.body;
    const idValue = externalId || gaiaId;
    const sourceLabel = source || 'unknown';
    // Display name from the trusted host profile (Teams displayName, etc.).
    const providedName = (fullName || displayName || '').trim();

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email provided'
      });
    }

    const emailLower = email.toLowerCase();
    const crypto = require('crypto');

    log.info(`Identity login [${sourceLabel}]: ${emailLower}`);

    try {
      // Fallback user ID for accounts that don't exist yet in authservice
      // (Chrome/Teams identity for a first-time visitor). Deterministic so
      // repeat visits land on the same id.
      const fallbackUserId = crypto.createHash('sha256').update(emailLower).digest('hex').substring(0, 16);

      // Try to find existing user in authservice — we want their REAL id, not
      // a hash, otherwise per-user storage (pins, activity, etc.) diverges
      // between the extension and the web session for the same person.
      let userId = fallbackUserId;
      let userRoles = ['user'];
      let userName = providedName || emailLower.split('@')[0];
      const authservice = req.app?.get?.('authservice');
      if (authservice && typeof authservice.listUsers === 'function') {
        try {
          const allUsers = await authservice.listUsers();
          const existingUser = allUsers.find(u => u.email && u.email.toLowerCase() === emailLower);
          if (existingUser) {
            if (existingUser.id) userId = existingUser.id;
            userRoles = Array.isArray(existingUser.roles) ? existingUser.roles : [existingUser.role || 'user'];
            const storedName = existingUser.fullName || existingUser.name || '';
            // Keep the wiki identity's name in sync with the trusted host
            // profile (Teams displayName, etc.) on every login. Only act when
            // the host actually supplied a name and it differs from what we
            // have stored. Persist both `fullName` (canonical) and `name`
            // (legacy field some call sites read) so every surface — header,
            // profile, comments — agrees. Keyed by email like the auth store.
            if (providedName && providedName !== storedName && typeof authservice.updateUser === 'function') {
              try {
                const updated = await authservice.updateUser(emailLower, { fullName: providedName, name: providedName });
                userName = updated?.fullName || updated?.name || providedName;
                log.info(`[auth/identity] Synced display name for ${emailLower}: "${storedName}" -> "${providedName}"`);
              } catch (err) {
                // Non-fatal: still reflect the host name for this session even
                // if the persistent update failed.
                userName = providedName;
                log.warn(`[auth/identity] Could not sync display name for ${emailLower}: ${err.message}`);
              }
            } else {
              userName = storedName || userName;
            }
            log.info(`[auth/identity] Found user: ${emailLower} id=${userId} roles=[${userRoles.join(', ')}]`);
          } else if (typeof authservice.createUser === 'function') {
            // First sight of a trusted (Teams/Chrome) identity: provision a
            // real local account so this person gets a stable user id and
            // per-user storage instead of a throwaway hash. They never type a
            // password (they always arrive via verified identity), so mint a
            // strong random one. The display name comes from the host profile,
            // falling back to the email's local-part.
            const newPassword = typeof authservice.generateStrongPassword === 'function'
              ? authservice.generateStrongPassword()
              : crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '') + 'Aa1!';
            const newFullName = providedName || emailLower.split('@')[0];
            try {
              const created = await authservice.createUser({
                email: emailLower,
                fullName: newFullName,
                password: newPassword
              });
              if (created?.id) userId = created.id;
              userRoles = Array.isArray(created?.roles) ? created.roles : ['user'];
              userName = created?.fullName || newFullName;
              log.info(`[auth/identity] Auto-provisioned user: ${emailLower} id=${userId} roles=[${userRoles.join(', ')}]`);
            } catch (err) {
              // Non-fatal: fall through to the hash-based identity so the user
              // still gets in this session even if account creation failed.
              log.error(`[auth/identity] Create failed for ${emailLower}: ${err.message}`);
            }
          } else {
            const knownEmails = allUsers.map(u => u.email).filter(Boolean).join(', ');
            log.warn(`[auth/identity] User NOT found by email "${emailLower}" and createUser unavailable. Known emails: [${knownEmails}]. Defaulting to roles: [user]`);
          }
        } catch (lookupError) {
          log.warn(`[auth/identity] Failed to look up user ${emailLower}: ${lookupError.message}`);
        }
      } else {
        log.warn('[auth/identity] authservice or listUsers not available — using default roles: [user]');
      }

      // Create user object for token registration
      const user = {
        id: userId,
        email: emailLower,
        username: emailLower.split('@')[0],
        name: userName,
        roles: userRoles
      };

      // Generate bearer token
      const token = crypto.randomBytes(32).toString('hex');

      // Register with bearer token middleware (24 hour TTL)
      if (global.bearerTokenMiddleware && global.bearerTokenMiddleware.registerToken) {
        global.bearerTokenMiddleware.registerToken(token, user, 24 * 60 * 60 * 1000);
        log.info(`Bearer token registered for: ${emailLower}`);
      }

      eventEmitter.emit('auth:identity-login', {
        email: emailLower,
        externalId: idValue,
        source: sourceLabel,
        timestamp: new Date().toISOString()
      });

      res.status(200).json({
        success: true,
        message: 'Identity authentication successful',
        data: {
          token: token,
          user: {
            id: user.id,
            email: user.email,
            username: user.username,
            name: user.name,
            roles: user.roles
          },
          expiresIn: 86400 // 24 hours in seconds
        }
      });
    } catch (error) {
      log.error(`Identity auth error: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Authentication failed'
      });
    }
  }));

  /**
   * POST /api/auth/extension-token
   * Creates a bearer token for Chrome/VS Code extensions from the current session.
   * Requires an active Passport session (browser cookie). Returns a 24hr bearer token
   * that can be used with Authorization: Bearer <token> on all /applications/wiki/api/* routes.
   * This enables the extension to remain authenticated independently of browser cookies.
   *
   * @param {express.Request} req - Express request object
   * @param {express.Response} res - Express response object
   * @return {void}
   */
  app.post('/api/auth/extension-token', asyncHandler(async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
          message: 'A valid browser session (cookie) is required'
        });
      }

      const user = req.user;
      const crypto = require('crypto');

      // Generate a cryptographically secure random token
      const token = crypto.randomBytes(32).toString('hex');

      // Register the token with bearer token middleware for 24hr use
      if (global.bearerTokenMiddleware && global.bearerTokenMiddleware.registerToken) {
        global.bearerTokenMiddleware.registerToken(token, user, 24 * 60 * 60 * 1000);
      } else {
        log.warn('bearerTokenMiddleware not available for extension token');
      }

      eventEmitter.emit('auth:extension-token-created', {
        email: user.email,
        timestamp: new Date().toISOString()
      });

      const userRoles = Array.isArray(user.roles) ? user.roles : [user.role || 'user'];
      res.status(200).json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          roles: userRoles
        },
        expiresIn: 86400  // seconds (24 hours)
      });
    } catch (error) {
      log.error('Extension token creation error:', error.message);
      res.status(500).json({
        success: false,
        error: 'Token creation failed'
      });
    }
  }));

  /**
   * GET /api/auth/check
   * Checks if the current user is authenticated and returns their status.
   * Includes a flag indicating if the user needs to complete the setup wizard.
   * Also returns the user's role (admin or user) for access control.
   *
   * Response:
   * - authenticated: boolean
   * - needsWizard: boolean (only if authenticated)
   * - user: object with id, email, name, role (only if authenticated)
   */
  app.get('/api/auth/check', asyncHandler(async (req, res) => {
    try {
      if (req.isAuthenticated()) {
        log.info(`Auth check successful for user: ${req.user?.email}`);

        // Check if user has any allowed spaces (same logic as wizard endpoint)
        let needsWizard = true;
        const spaceManager = req.app?.get?.('spaceManager');
        if (spaceManager) {
          const userEmail = req.user.email;
          const allSpaces = spaceManager.getAllSpaces();

          // User has access to a space if it's public/team or they're in allowedUsers
          const userSpaces = allSpaces.filter(space => {
            if (space.visibility === 'public') return true;
            if (space.visibility === 'team') return true;
            if (space.allowedUsers && space.allowedUsers.includes(userEmail)) return true;
            return false;
          });

          needsWizard = userSpaces.length === 0;
        }

        // Get user roles from authentication system
        const userRoles = Array.isArray(req.user.roles) ? req.user.roles : [req.user.role || 'user'];

        res.status(200).json({
          authenticated: true,
          needsWizard,
          user: {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
            roles: userRoles,
            // Canonical per-space folder name (email local-part) so the client
            // builds personal-template paths with the exact server value.
            userDir: req.user.email ? toUserDir(req.user.email) : null
          }
        });
      } else {
        // Require authentication - redirect to login
        res.status(200).json({
          authenticated: false,
          allowsPublicAccess: false
        });
      }
    } catch (error) {
      log.error('Auth check error:', error.message);
      res.status(200).json({
        authenticated: false,
        allowsPublicAccess: false
      });
    }
  }));

  /**
   * POST /api/auth/change-password
   * Changes the password for the authenticated user.
   * Requires current password verification before allowing the change.
   *
   * Request body:
   * - currentPassword: User's current password
   * - newPassword: User's new password
   *
   * Response:
   * - success: boolean
   * - message: string
   */
  app.post('/api/auth/change-password', asyncHandler(async (req, res) => {
    try {
      // Verify user is authenticated
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      const { currentPassword, newPassword } = req.body;

      // Validate required fields
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password and new password are required'
        });
      }

      // Validate new password length
      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters'
        });
      }

      log.info(`Password change requested for user: ${req.user?.email}`);

      const authService = req.app.get('authservice');

      if (!authService) {
        return res.status(500).json({
          success: false,
          message: 'Authentication service unavailable'
        });
      }

      // Verify current password and change to new password
      // Use username for auth service (which is stored in req.user.username from Passport)
      const username = req.user.username || req.user.email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      const result = await authService.changePassword(
        username,
        currentPassword,
        newPassword
      );

      if (result.success) {
        eventEmitter.emit('wiki:password-changed', { email: req.user.email });
        log.info(`Password changed successfully for user: ${req.user?.email}`);

        res.status(200).json({
          success: true,
          message: 'Password changed successfully'
        });
      } else {
        log.warn(`Password change failed for user: ${req.user?.email}`);
        res.status(400).json({
          success: false,
          message: result.message || 'Current password is incorrect'
        });
      }
    } catch (error) {
      log.error('Change password error:', error.message);
      res.status(500).json({
        success: false,
        message: error.message || 'Change password failed'
      });
    }
  }));

  log.info('Wiki authentication routes registered successfully');
};
