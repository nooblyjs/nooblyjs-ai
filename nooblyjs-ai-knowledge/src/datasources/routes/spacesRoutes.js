/**
 * @fileoverview Spaces API Routes for Datasources Module
 * Provides REST API endpoints for managing organizational spaces
 *
 * Endpoints:
 * - GET /api/spaces - List all spaces (with filters)
 * - POST /api/spaces - Create new space
 * - GET /api/spaces/:id - Get space details
 * - PUT /api/spaces/:id - Update space
 * - DELETE /api/spaces/:id - Delete space
 * - POST /api/spaces/:id/archive - Archive space
 * - POST /api/spaces/:id/restore - Restore archived space
 * - POST /api/spaces/:id/users/:userId - Add user to space
 * - DELETE /api/spaces/:id/users/:userId - Remove user from space
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const { body, param, query, validationResult } = require('express-validator');
const spaceAuthority = require('../../shared/spaces/spaceAuthority');

/**
 * Register spaces routes
 * @param {Object} options - Configuration options
 * @param {express.Application} options.express-app - Express app instance
 * @param {Object} options.dependencies - Services from core
 * @param {Object} eventEmitter - Event emitter
 */
module.exports = function(type, options, eventEmitter) {
  const app = options.app || options['express-app'];
  const { dependencies = {} } = options;
  const services = dependencies;
  const { log } = services;
  const logger = log;

  // Get managers from app (set during module initialization)
  const spaceManager = app.get('spaceManager');
  const securityManager = app.get('securityManager');

  if (!spaceManager) {
    logger?.warn('SpaceManager not yet initialized, spaces routes may not be fully functional');
  }
  if (!securityManager) {
    logger?.warn('SecurityManager not yet initialized, RBAC features may not be fully functional');
  }

  // Middleware to check authentication
  const requireAuth = (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
  };

  /**
   * A `theme` is either the object form or a string naming a preset (SPACES.md).
   * Anything else is rejected outright rather than stored and silently ignored
   * by the frontend, which is indistinguishable from "the brand did not apply".
   * @param {*} value
   * @return {boolean}
   */
  function isThemeShape(value) {
    if (value === null) return true;                 // explicit clear
    if (typeof value === 'string') return true;      // preset name
    return typeof value === 'object' && !Array.isArray(value);
  }

  // Middleware to validate request
  const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    next();
  };

  /**
   * GET /api/spaces
   * List all spaces with optional filtering
   */
  app.get('/api/spaces',
    query('type').optional().trim(),
    query('visibility').optional().trim(),
    query('archived').optional().toBoolean(),
    handleValidationErrors,
    (req, res) => {
      try {
        const filters = {};
        if (req.query.type) filters.type = req.query.type;
        if (req.query.visibility) filters.visibility = req.query.visibility;
        if (req.query.hasOwnProperty('archived')) filters.archived = req.query.archived;

        const spaces = spaceManager.getAllSpaces(filters);

        // Filter spaces the user has access to (if authenticated)
        const filteredSpaces = req.isAuthenticated()
          ? spaces
          : spaces.filter(s => s.visibility === 'public');

        logger.info(`[Spaces API] After auth filter: ${filteredSpaces.length} spaces accessible to user`);

        res.json({
          success: true,
          count: filteredSpaces.length,
          data: filteredSpaces
        });
      } catch (error) {
        logger.error('Error listing spaces:', error);
        res.status(500).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  /**
   * POST /api/spaces
   * Create new space
   */
  app.post('/api/spaces',
    requireAuth,
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('description').optional().trim(),
    body('type').optional().trim(),
    body('visibility').optional().isIn(['public', 'private', 'team']),
    body('permissions').optional().isIn(['read-only', 'read-write']),
    body('allowedUsers').optional().isArray(),
    body('configuration').optional().isObject(),
    body('metadata').optional().isObject(),
    // `theme` is an OBJECT (title/subtitle/image/color/color-highlight/home) or
    // a STRING naming a preset — see SPACES.md. Validated as "one of those two"
    // rather than isObject(), which would reject the preset form.
    body('theme').optional().custom(isThemeShape),
    handleValidationErrors,
    async (req, res) => {
      try {
        const userId = req.user?.id || req.user?.email || 'unknown';

        const newSpace = await spaceManager.createSpace({
          name: req.body.name,
          description: req.body.description,
          type: req.body.type,
          visibility: req.body.visibility,
          permissions: req.body.permissions,
          allowedUsers: req.body.allowedUsers,
          theme: req.body.theme,
          configuration: req.body.configuration,
          metadata: req.body.metadata
        }, userId);

        res.status(201).json({
          success: true,
          message: 'Space created successfully',
          data: newSpace
        });
      } catch (error) {
        logger.error('Error creating space:', error);
        res.status(400).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  /**
   * GET /api/spaces/:id
   * Get space details
   */
  app.get('/api/spaces/:id',
    param('id').toInt(),
    handleValidationErrors,
    (req, res) => {
      try {
        const spaceId = req.params.id;
        const space = spaceManager.getSpaceById(spaceId);

        logger.info(`[GET /api/spaces/${spaceId}] Request received`);
        logger.info(`[GET /api/spaces/${spaceId}] Authenticated: ${req.isAuthenticated()}`);
        if (req.isAuthenticated()) {
          logger.info(`[GET /api/spaces/${spaceId}] User: ${req.user?.id || req.user?.email}`);
          logger.info(`[GET /api/spaces/${spaceId}] Is Admin: ${req.user?.isAdmin}`);
        }

        if (!space) {
          logger.warn(`[GET /api/spaces/${spaceId}] Space not found`);
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        logger.info(`[GET /api/spaces/${spaceId}] Space found: ${space.name}`);
        logger.info(`[GET /api/spaces/${spaceId}] Visibility: ${space.visibility}`);
        logger.info(`[GET /api/spaces/${spaceId}] Created by: ${space.createdBy}`);

        // Public spaces are accessible to everyone
        if (space.visibility === 'public') {
          logger.info(`[GET /api/spaces/${spaceId}] Space is public - access granted`);
          return res.json({
            success: true,
            data: space
          });
        }

        // Private/team spaces require authentication
        if (!req.isAuthenticated()) {
          logger.warn(`[GET /api/spaces/${spaceId}] Not authenticated and space is not public - access denied`);
          return res.status(403).json({ success: false, error: 'Authentication required' });
        }

        if (!spaceAuthority.canReadSpace(req.user, space, securityManager)) {
          // Log WHY. The previous "Access denied" said nothing, and the reason
          // was never the obvious one: admins.json is empty on a real install so
          // nobody held the admin role, and createdBy is "system" so nobody was
          // the creator — the endpoint refused everybody.
          logger.warn(
            `[GET /api/spaces/${spaceId}] Access denied`,
            spaceAuthority.explain(req.user, space, securityManager)
          );
          return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const userId = req.user?.id || req.user?.email;

        logger.info(`[GET /api/spaces/${spaceId}] Access granted to user ${userId}`);
        res.json({
          success: true,
          data: space
        });
      } catch (error) {
        logger.error('Error getting space:', error);
        res.status(500).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  /**
   * PUT /api/spaces/:id
   * Update space
   */
  app.put('/api/spaces/:id',
    requireAuth,
    param('id').toInt(),
    body('name').optional().trim(),
    body('description').optional().trim(),
    body('type').optional().trim(),
    body('visibility').optional().isIn(['public', 'private', 'team']),
    body('permissions').optional().isIn(['read-only', 'read-write']),
    body('allowedUsers').optional().isArray(),
    body('configuration').optional().isObject(),
    body('metadata').optional().isObject(),
    body('theme').optional({ nullable: true }).custom(isThemeShape),
    handleValidationErrors,
    async (req, res) => {
      try {
        const userId = req.user?.id || req.user?.email || 'unknown';
        const space = spaceManager.getSpaceById(req.params.id);

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        if (!spaceAuthority.canManageSpace(req.user, space, securityManager)) {
          logger.warn(
            `[PUT /api/spaces/${req.params.id}] Update refused`,
            spaceAuthority.explain(req.user, space, securityManager)
          );
          return res.status(403).json({ success: false, error: 'Not authorized to update this space' });
        }

        // Presence, not truthiness — otherwise a field can be set but never
        // CLEARED: emptying allowedUsers or dropping a theme sends a falsy-ish
        // value that a truthy guard skips, so the save reports success and the
        // old value is still on disk. `name` keeps its truthy guard on purpose:
        // a space with no name cannot be looked up (every document endpoint
        // resolves spaces by name), so an empty one is rejected, not applied.
        const updates = {};
        if (req.body.name) updates.name = req.body.name;
        if (req.body.description !== undefined) updates.description = req.body.description;
        if (req.body.type !== undefined) updates.type = req.body.type;
        if (req.body.visibility !== undefined) updates.visibility = req.body.visibility;
        if (req.body.permissions !== undefined) updates.permissions = req.body.permissions;
        if (req.body.allowedUsers !== undefined) updates.allowedUsers = req.body.allowedUsers;
        if (req.body.configuration !== undefined) updates.configuration = req.body.configuration;
        if (req.body.metadata !== undefined) updates.metadata = req.body.metadata;
        // null clears the brand; SpaceManager stores whatever it is handed, and
        // the frontend treats a missing theme as "use the default".
        if (req.body.theme !== undefined) updates.theme = req.body.theme;

        const updatedSpace = await spaceManager.updateSpace(req.params.id, updates, userId);

        res.json({
          success: true,
          message: 'Space updated successfully',
          data: updatedSpace
        });
      } catch (error) {
        logger.error('Error updating space:', error);
        res.status(400).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  /**
   * DELETE /api/spaces/:id
   * Delete space
   */
  app.delete('/api/spaces/:id',
    requireAuth,
    param('id').toInt(),
    handleValidationErrors,
    async (req, res) => {
      try {
        const space = spaceManager.getSpaceById(req.params.id);

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        if (!spaceAuthority.canManageSpace(req.user, space, securityManager)) {
          logger.warn(
            `[DELETE /api/spaces/${req.params.id}] Delete refused`,
            spaceAuthority.explain(req.user, space, securityManager)
          );
          return res.status(403).json({ success: false, error: 'Not authorized to delete this space' });
        }

        await spaceManager.deleteSpace(req.params.id);

        res.json({
          success: true,
          message: 'Space deleted successfully'
        });
      } catch (error) {
        logger.error('Error deleting space:', error);
        res.status(500).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  /**
   * POST /api/spaces/:id/archive
   * Archive space (soft delete)
   */
  app.post('/api/spaces/:id/archive',
    requireAuth,
    param('id').toInt(),
    handleValidationErrors,
    async (req, res) => {
      try {
        const space = spaceManager.getSpaceById(req.params.id);

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        const userId = req.user?.id || req.user?.email || 'unknown';

        if (!spaceAuthority.canManageSpace(req.user, space, securityManager)) {
          return res.status(403).json({ success: false, error: 'Not authorized to archive this space' });
        }

        const archivedSpace = await spaceManager.archiveSpace(req.params.id, userId);

        res.json({
          success: true,
          message: 'Space archived successfully',
          data: archivedSpace
        });
      } catch (error) {
        logger.error('Error archiving space:', error);
        res.status(500).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  /**
   * POST /api/spaces/:id/restore
   * Restore archived space
   */
  app.post('/api/spaces/:id/restore',
    requireAuth,
    param('id').toInt(),
    handleValidationErrors,
    async (req, res) => {
      try {
        const space = spaceManager.getSpaceById(req.params.id);

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        const userId = req.user?.id || req.user?.email || 'unknown';

        if (!spaceAuthority.canManageSpace(req.user, space, securityManager)) {
          return res.status(403).json({ success: false, error: 'Not authorized to restore this space' });
        }

        const restoredSpace = await spaceManager.restoreSpace(req.params.id, userId);

        res.json({
          success: true,
          message: 'Space restored successfully',
          data: restoredSpace
        });
      } catch (error) {
        logger.error('Error restoring space:', error);
        res.status(500).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  /**
   * POST /api/spaces/:id/users/:userId
   * Add user to space
   */
  app.post('/api/spaces/:id/users/:userId',
    requireAuth,
    param('id').toInt(),
    param('userId').trim(),
    handleValidationErrors,
    async (req, res) => {
      try {
        const space = spaceManager.getSpaceById(req.params.id);

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        const userId = req.user?.id || req.user?.email || 'unknown';
        const updatedSpace = await spaceManager.addUserToSpace(req.params.id, req.params.userId);

        res.json({
          success: true,
          message: `User ${req.params.userId} added to space`,
          data: updatedSpace
        });
      } catch (error) {
        logger.error('Error adding user to space:', error);
        res.status(400).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  /**
   * DELETE /api/spaces/:id/users/:userId
   * Remove user from space
   */
  app.delete('/api/spaces/:id/users/:userId',
    requireAuth,
    param('id').toInt(),
    param('userId').trim(),
    handleValidationErrors,
    async (req, res) => {
      try {
        const space = spaceManager.getSpaceById(req.params.id);

        if (!space) {
          return res.status(404).json({ success: false, error: 'Space not found' });
        }

        const updatedSpace = await spaceManager.removeUserFromSpace(req.params.id, req.params.userId);

        res.json({
          success: true,
          message: `User ${req.params.userId} removed from space`,
          data: updatedSpace
        });
      } catch (error) {
        logger.error('Error removing user from space:', error);
        res.status(400).json({ success: false, error: error.message || 'Internal server error' });
      }
    }
  );

  logger?.info('Spaces API routes registered');
};
