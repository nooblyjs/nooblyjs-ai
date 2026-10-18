/**
 * @fileoverview Notification Routes
 * REST API endpoints for notification subscriptions and history
 * All routes require authentication via Bearer token
 *
 * Endpoints:
 * - GET  /api/notifications/subscriptions         — Get user's subscriptions
 * - POST /api/notifications/subscriptions         — Subscribe to document/folder
 * - DELETE /api/notifications/subscriptions       — Unsubscribe
 * - GET  /api/notifications/                      — Get notification history
 * - PATCH /api/notifications/:id/read             — Mark single notification as read
 * - POST /api/notifications/read-all              — Mark all as read
 * - GET  /api/notifications/preferences           — Get user preferences
 * - POST /api/notifications/preferences           — Save preferences
 *
 * @author noobly Team
 * @since 2026-04-08
 */

'use strict';

const spaceUserStore = require('../components/spaceUserStore');

module.exports = (options, eventEmitter, services) => {
  const { app } = options;
  const { notificationManager, log } = services;

  if (!notificationManager) {
    log.warn('NotificationRoutes: notificationManager not provided, skipping route registration');
    return;
  }

  // Middleware to extract authenticated user
  const getAuthenticatedUser = (req) => {
    if (!req.isAuthenticated() || !req.user) {
      return null;
    }
    // Try different user identifier fields
    return req.user?.email || req.user?.username || req.user?.name || req.user?.id || null;
  };

  // Notifications/subscriptions are space-scoped — resolve the current space
  // from the request (query ?space= or body spaceName).
  const spaceOf = (req) => spaceUserStore.spaceOf(req);

  /**
   * GET /api/notifications/subscriptions
   * Get all subscriptions for the current user
   */
  app.get('/applications/wiki/api/notifications/subscriptions', async (req, res) => {
    try {
      const userId = getAuthenticatedUser(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const subs = await notificationManager.getSubscriptions(userId, spaceOf(req));
      res.json({ success: true, data: subs });
    } catch (error) {
      log.error('GET subscriptions error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/notifications/subscriptions
   * Subscribe to a document or folder
   * Body: { type: 'document'|'folder', path: '/folder/doc.md' }
   */
  app.post('/applications/wiki/api/notifications/subscriptions', async (req, res) => {
    try {
      const userId = getAuthenticatedUser(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const { type, path: filePath } = req.body;
      const space = spaceOf(req);

      if (!type || !filePath) {
        return res.status(400).json({ success: false, error: 'Missing type or path' });
      }
      if (!space) {
        return res.status(400).json({ success: false, error: 'Missing spaceName' });
      }

      log.debug('Subscribe request', { userId, space, type, filePath });

      const sub = await notificationManager.subscribe(userId, space, type, filePath);
      res.status(201).json({ success: true, data: sub });
      log.info('User subscribed', { userId, type, filePath });
    } catch (error) {
      log.error('POST subscriptions error:', { userId: getAuthenticatedUser(req), error: error.message, stack: error.stack });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * DELETE /api/notifications/subscriptions
   * Unsubscribe from a document or folder
   * Body: { type: 'document'|'folder', path: '/folder/doc.md' }
   */
  app.delete('/applications/wiki/api/notifications/subscriptions', async (req, res) => {
    try {
      const userId = getAuthenticatedUser(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const { type, path } = req.body;

      if (!type || !path) {
        return res.status(400).json({ success: false, error: 'Missing type or path' });
      }

      const unsubscribed = await notificationManager.unsubscribe(userId, spaceOf(req), type, path);
      if (!unsubscribed) {
        return res.status(404).json({ success: false, error: 'Subscription not found' });
      }

      res.json({ success: true, message: 'Unsubscribed' });
      log.info('User unsubscribed', { userId, type, path });
    } catch (error) {
      log.error('DELETE subscriptions error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/notifications/
   * Get notification history for the current user
   * Query params: ?limit=50
   */
  app.get('/applications/wiki/api/notifications/', async (req, res) => {
    try {
      const userId = getAuthenticatedUser(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const limit = Math.min(parseInt(req.query.limit) || 50, 200);

      const space = spaceOf(req);
      const history = await notificationManager.getHistory(userId, space, limit);
      const unreadCount = await notificationManager.getUnreadCount(userId, space);

      res.json({ success: true, data: history, unreadCount });
    } catch (error) {
      log.error('GET notifications error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * PATCH /api/notifications/:id/read
   * Mark a single notification as read
   */
  app.patch('/applications/wiki/api/notifications/:id/read', async (req, res) => {
    try {
      const userId = getAuthenticatedUser(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const { id } = req.params;
      const space = spaceOf(req);

      const marked = await notificationManager.markRead(userId, space, id);
      if (!marked) {
        return res.status(404).json({ success: false, error: 'Notification not found' });
      }

      const unreadCount = await notificationManager.getUnreadCount(userId, space);
      res.json({ success: true, unreadCount });
    } catch (error) {
      log.error('PATCH notification read error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/notifications/read-all
   * Mark all notifications as read for the current user
   */
  app.post('/applications/wiki/api/notifications/read-all', async (req, res) => {
    try {
      const userId = getAuthenticatedUser(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const count = await notificationManager.markAllRead(userId, spaceOf(req));

      res.json({ success: true, markedCount: count, unreadCount: 0 });
      log.info('Marked all notifications as read', { userId, count });
    } catch (error) {
      log.error('POST read-all error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/notifications/preferences
   * Get notification preferences for the current user
   */
  app.get('/applications/wiki/api/notifications/preferences', async (req, res) => {
    try {
      const userId = getAuthenticatedUser(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const prefs = await notificationManager.getPreferences(userId, spaceOf(req));

      res.json({ success: true, data: prefs });
    } catch (error) {
      log.error('GET preferences error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/notifications/preferences
   * Save notification preferences for the current user
   * Body: { enabled: boolean, maxHistory: number }
   */
  app.post('/applications/wiki/api/notifications/preferences', async (req, res) => {
    try {
      const userId = getAuthenticatedUser(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const { enabled, maxHistory } = req.body;

      const prefs = await notificationManager.savePreferences(userId, spaceOf(req), { enabled, maxHistory });
      res.json({ success: true, data: prefs });
      log.info('User preferences updated', { userId, ...prefs });
    } catch (error) {
      log.error('POST preferences error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  log.info('Notification routes registered');
};
