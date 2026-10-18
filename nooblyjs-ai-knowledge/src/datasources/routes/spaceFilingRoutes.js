/**
 * @fileoverview Space Filing Routes
 * Provides file management endpoints for each space
 * Enables browsing, uploading, downloading, and deleting files within spaces
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const express = require('express');
const path = require('node:path');
const multer = require('multer');
const mimeTypes = require('mime-types');

module.exports = (name, options, eventEmitter) => {
  const app = options.app || options['express-app'];
  const { dependencies = {} } = options;
  const { log = console, authservice } = dependencies;

  // Configure multer for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
  });

  // Middleware: Require authentication
  const requireAuth = (req, res, next) => {
    if (!req.isAuthenticated?.()) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    next();
  };

  // Middleware: Check space access
  const checkSpaceAccess = (spaceManager) => {
    return (req, res, next) => {
      const spaceId = parseInt(req.params.id);
      const space = spaceManager?.getSpaceById(spaceId);

      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      // Check user access (public spaces or user in allowedUsers)
      const userEmail = req.user?.email;
      if (space.visibility !== 'public' && !space.allowedUsers?.includes(userEmail)) {
        return res.status(403).json({ error: 'Access denied to this space' });
      }

      // Attach space to request
      req.space = space;
      next();
    };
  };

  // Wait for managers to be ready
  const getManagers = () => {
    const spaceManager = app.get('spaceManager');
    const spaceFilingManager = app.get('spaceFilingManager');
    const securityManager = app.get('securityManager');
    return { spaceManager, spaceFilingManager, securityManager };
  };

  // ========================================================================
  // GET /api/spaces/:id/files/browse/* - Browse files in space
  // ========================================================================

  app.get('/api/spaces/:id/files/browse/*', requireAuth, (req, res) => {
    try {
      const { spaceManager, spaceFilingManager, securityManager } = getManagers();

      if (!spaceManager || !spaceFilingManager) {
        return res.status(503).json({ error: 'Filing service not yet initialized' });
      }

      const spaceId = parseInt(req.params.id);
      const pathParam = req.params[0] || '/';

      // Check space access
      const space = spaceManager.getSpaceById(spaceId);
      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      const userEmail = req.user?.email;
      const userRole = securityManager?.getUserRole(userEmail) || 'user';
      const isAdmin = userRole === 'admin';
      const isAllowed = space.allowedUsers?.includes(userEmail) || space.createdBy === userEmail;

      if (space.visibility !== 'public' && !isAllowed && !isAdmin) {
        return res.status(403).json({ error: 'Access denied to this space' });
      }

      // Get filing service for this space
      spaceFilingManager.getFilingService(spaceId).then((filing) => {
        // List files at path
        const files = filing.list?.(`/spaces/${spaceId}/files${pathParam}`) || [];

        res.json({
          items: Array.isArray(files) ? files : [],
          space: {
            id: space.id,
            name: space.name
          }
        });
      }).catch((error) => {
        log.error('Error browsing files:', error);
        res.status(500).json({ error: 'Failed to browse files' });
      });
    } catch (error) {
      log.error('Error in browse endpoint:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/spaces/:id/files/tree - Get full file tree for space
  // ========================================================================

  app.get('/api/spaces/:id/files/tree', requireAuth, (req, res) => {
    try {
      const { spaceManager, spaceFilingManager, securityManager } = getManagers();

      if (!spaceManager || !spaceFilingManager) {
        return res.status(503).json({ error: 'Filing service not yet initialized' });
      }

      const spaceId = parseInt(req.params.id);
      const space = spaceManager.getSpaceById(spaceId);

      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      const userEmail = req.user?.email;
      const userRole = securityManager?.getUserRole(userEmail) || 'user';
      const isAdmin = userRole === 'admin';
      const isAllowed = space.allowedUsers?.includes(userEmail) || space.createdBy === userEmail;

      if (space.visibility !== 'public' && !isAllowed && !isAdmin) {
        return res.status(403).json({ error: 'Access denied to this space' });
      }

      spaceFilingManager.getFilingService(spaceId).then((filing) => {
        const tree = {
          name: space.name,
          type: 'folder',
          path: '/',
          children: filing.list?.(`/spaces/${spaceId}/files`) || []
        };

        res.json(tree);
      }).catch((error) => {
        log.error('Error getting file tree:', error);
        res.status(500).json({ error: 'Failed to get file tree' });
      });
    } catch (error) {
      log.error('Error in tree endpoint:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // ========================================================================
  // POST /api/spaces/:id/files/upload/:key - Upload file to space
  // ========================================================================

  app.post('/api/spaces/:id/files/upload/:key', requireAuth, upload.single('file'), (req, res) => {
    try {
      const { spaceManager, spaceFilingManager, securityManager } = getManagers();

      if (!spaceManager || !spaceFilingManager) {
        return res.status(503).json({ error: 'Filing service not yet initialized' });
      }

      const spaceId = parseInt(req.params.id);
      const fileKey = req.params.key;
      const space = spaceManager.getSpaceById(spaceId);

      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      const userEmail = req.user?.email;
      const userRole = securityManager?.getUserRole(userEmail) || 'user';
      const isAdmin = userRole === 'admin';
      const isAllowed = space.allowedUsers?.includes(userEmail) || space.createdBy === userEmail;

      if (space.visibility !== 'public' && !isAllowed && !isAdmin) {
        return res.status(403).json({ error: 'Access denied to this space' });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      // Get filing service and upload file
      spaceFilingManager.getFilingService(spaceId).then((filing) => {
        return filing.create(fileKey, req.file.buffer).then(() => {
          res.status(201).json({
            success: true,
            file: {
              name: req.file.originalname,
              size: req.file.size,
              path: fileKey,
              mimetype: req.file.mimetype
            }
          });
        });
      }).catch((error) => {
        log.error('Error uploading file:', error);
        res.status(500).json({ error: 'Failed to upload file', details: error.message });
      });
    } catch (error) {
      log.error('Error in upload endpoint:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/spaces/:id/files/download/:key - Download file from space
  // ========================================================================

  app.get('/api/spaces/:id/files/download/:key', requireAuth, (req, res) => {
    try {
      const { spaceManager, spaceFilingManager, securityManager } = getManagers();

      if (!spaceManager || !spaceFilingManager) {
        return res.status(503).json({ error: 'Filing service not yet initialized' });
      }

      const spaceId = parseInt(req.params.id);
      const fileKey = req.params.key;
      const space = spaceManager.getSpaceById(spaceId);

      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      const userEmail = req.user?.email;
      const userRole = securityManager?.getUserRole(userEmail) || 'user';
      const isAdmin = userRole === 'admin';
      const isAllowed = space.allowedUsers?.includes(userEmail) || space.createdBy === userEmail;

      if (space.visibility !== 'public' && !isAllowed && !isAdmin) {
        return res.status(403).json({ error: 'Access denied to this space' });
      }

      // Get filing service and download file
      spaceFilingManager.getFilingService(spaceId).then((filing) => {
        return filing.read(fileKey).then((buffer) => {
          // Extract filename from file key
          const fileName = path.basename(fileKey);
          const mimeType = mimeTypes.lookup(fileKey) || 'application/octet-stream';

          res.setHeader('Content-Type', mimeType);
          res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
          res.setHeader('Content-Length', buffer.length);
          res.send(buffer);
        });
      }).catch((error) => {
        if (error.code === 'ENOENT') {
          res.status(404).json({ error: 'File not found' });
        } else {
          log.error('Error downloading file:', error);
          res.status(500).json({ error: 'Failed to download file', details: error.message });
        }
      });
    } catch (error) {
      log.error('Error in download endpoint:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // ========================================================================
  // DELETE /api/spaces/:id/files/remove/:key - Delete file from space
  // ========================================================================

  app.delete('/api/spaces/:id/files/remove/:key', requireAuth, (req, res) => {
    try {
      const { spaceManager, spaceFilingManager, securityManager } = getManagers();

      if (!spaceManager || !spaceFilingManager) {
        return res.status(503).json({ error: 'Filing service not yet initialized' });
      }

      const spaceId = parseInt(req.params.id);
      const fileKey = req.params.key;
      const space = spaceManager.getSpaceById(spaceId);

      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      const userEmail = req.user?.email;
      const userRole = securityManager?.getUserRole(userEmail) || 'user';
      const isAdmin = userRole === 'admin';
      const isAllowed = space.allowedUsers?.includes(userEmail) || space.createdBy === userEmail;

      if (space.visibility !== 'public' && !isAllowed && !isAdmin) {
        return res.status(403).json({ error: 'Access denied to this space' });
      }

      // Get filing service and delete file
      spaceFilingManager.getFilingService(spaceId).then((filing) => {
        return filing.delete(fileKey).then(() => {
          res.json({
            success: true,
            message: 'File deleted successfully',
            fileKey: fileKey
          });
        });
      }).catch((error) => {
        if (error.code === 'ENOENT') {
          res.status(404).json({ error: 'File not found' });
        } else {
          log.error('Error deleting file:', error);
          res.status(500).json({ error: 'Failed to delete file', details: error.message });
        }
      });
    } catch (error) {
      log.error('Error in delete endpoint:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  // ========================================================================
  // GET /api/spaces/:id/files/config - Get filing configuration for space
  // ========================================================================

  app.get('/api/spaces/:id/files/config', requireAuth, (req, res) => {
    try {
      const { spaceManager, spaceFilingManager, securityManager } = getManagers();

      if (!spaceManager || !spaceFilingManager) {
        return res.status(503).json({ error: 'Filing service not yet initialized' });
      }

      const spaceId = parseInt(req.params.id);
      const space = spaceManager.getSpaceById(spaceId);

      if (!space) {
        return res.status(404).json({ error: 'Space not found' });
      }

      const userEmail = req.user?.email;
      const userRole = securityManager?.getUserRole(userEmail) || 'user';
      const isAdmin = userRole === 'admin';
      const isAllowed = space.allowedUsers?.includes(userEmail) || space.createdBy === userEmail;

      if (space.visibility !== 'public' && !isAllowed && !isAdmin) {
        return res.status(403).json({ error: 'Access denied to this space' });
      }

      const config = spaceFilingManager.getSpaceConfig(spaceId);
      res.json({ success: true, configuration: config });
    } catch (error) {
      log.error('Error getting filing config:', error);
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
  });

  log.debug(`Space filing routes registered for module: ${name}`);
};
