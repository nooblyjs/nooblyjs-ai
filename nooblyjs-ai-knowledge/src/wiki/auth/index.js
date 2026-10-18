/**
 * @fileoverview Blog Authentication Service
 * Provides authentication and authorization for the blog application.
 * Integrates with noobly Core auth services and session management.
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-09-16
 */

'use strict';

const BlogAuthMiddleware = require('./middleware/authMiddleware');
const BlogAuthRoutes = require('./routes/authRoutes');
const UserManager = require('./components/userManager');

/**
 * Creates the blog authentication service
 * Configures authentication middleware, routes, and user management.
 * @param {Object} options - Configuration options
 * @param {EventEmitter} eventEmitter - Global event emitter
 * @param {Object} serviceRegistry - noobly Core service registry
 * @return {Object} Authentication service instance
 */
module.exports = (options, eventEmitter, serviceRegistry) => {
  // Initialize auth provider from noobly Core
  const authProvider = serviceRegistry.authservice('memory', {
    createDefaultAdmin: true,
    defaultAdminUser: {
      username: 'admin',
      email: 'admin@blog.local',
      password: 'admin123',
      role: 'admin'
    },
    sessionTimeout: 3600000, // 1 hour
    enableUserRegistration: false // Blog is admin-only for now
  });

  const logger = serviceRegistry.logger('console');
  const DataManager = require('../blog/components/dataManager');
  const dataManager = new DataManager('./.application/blog-data');

  // Initialize user manager
  const userManager = new UserManager(authProvider, dataManager, logger);

  // Initialize authentication middleware
  const authMiddleware = new BlogAuthMiddleware(authProvider, logger);

  // Initialize authentication routes
  const authRoutes = new BlogAuthRoutes(authProvider, userManager, logger);

  // Configure authentication service
  const authService = {
    provider: authProvider,
    middleware: authMiddleware,
    routes: authRoutes,
    userManager: userManager,

    /**
     * Register auth routes with Express app
     * @param {Object} app - Express application instance
     */
    registerRoutes(app) {
      authRoutes.register(app);
      logger.info('Blog authentication routes registered');
    },

    /**
     * Get authentication middleware for protecting routes
     * @return {Function} Express middleware function
     */
    getMiddleware() {
      return authMiddleware.requireAuth.bind(authMiddleware);
    },

    /**
     * Get admin-only middleware for admin routes
     * @return {Function} Express middleware function
     */
    getAdminMiddleware() {
      return authMiddleware.requireAdmin.bind(authMiddleware);
    },

    /**
     * Initialize default blog authors
     */
    async initializeBlogAuthors() {
      try {
        await userManager.initializeDefaultAuthors();
        logger.info('Blog authors initialized');
      } catch (error) {
        logger.error('Failed to initialize blog authors:', error);
      }
    }
  };

  // Initialize blog authors
  authService.initializeBlogAuthors();

  // Emit initialization event
  if (eventEmitter) {
    eventEmitter.emit('blog:auth-initialized', {
      service: 'blog-auth',
      message: 'Blog authentication service initialized'
    });
  }

  logger.info('Blog authentication service created successfully');
  return authService;
};