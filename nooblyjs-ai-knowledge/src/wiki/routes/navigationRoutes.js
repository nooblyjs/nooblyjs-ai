/**
 * @fileoverview Navigation API routes for Wiki application
 * Handles folder management, file operations, and document navigation
 *
 * @author noobly Team
 * @version 1.0.14
 * @since 1.0.0
 */

'use strict';
const path = require('node:path');
const { templateWriteCheck } = require('../components/spacePermissions');
const {
  writeFileOrder,
  sanitizeOrderNames,
  renameInFileOrder,
  removeFromFileOrder
} = require('../utils/fileOrder');
const { writeFolderType, sanitizeStatus } = require('../utils/folderTypes');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');
const { isInside } = require('../../shared/utils/pathSafety');

/**
 * Configures and registers navigation routes with the Express application.
 *
 * @param {Object} options - Configuration options object
 * @param {Object} eventEmitter - Event emitter for logging and notifications
 * @param {Object} services - noobly Core services (dataManager, filing, cache, logger, queue, search)
 * @return {void}
 */
module.exports = (options, eventEmitter, services) => {

  const app = options.app;
  const { dataManager, filing, cache, log, queue, search, searchIndexer } = services;
  const logger = log; // Alias for backward compatibility

  // NOTE: the legacy numeric-id move route was removed. Files are moved on disk
  // via the path-based /applications/wiki/api/move endpoint (the filing service
  // is the source of truth).

  // ==========================================================================
  // Keeping a folder's saved order honest after rename / delete / move
  // ==========================================================================
  //
  // The order file records CHILD NAMES, so an item that changes name or leaves
  // the folder would otherwise be stranded: the renamed item silently drops
  // below every ordered sibling, and deleted names accumulate forever.
  //
  // Both helpers only ever rewrite an order file that ALREADY exists in that
  // folder — never create one. With ordering now cascading from ancestors, a
  // folder that inherits its order must keep inheriting after a rename; writing
  // a file here would quietly detach it from its parent. Tidying is also
  // strictly best-effort: it must never turn a successful rename into an error.

  /** Follow a rename in the parent folder's order file, if it has one. */
  async function tidyOrderOnRename(itemAbsPath, newName) {
    try {
      await renameInFileOrder(path.dirname(itemAbsPath), path.basename(itemAbsPath), newName);
    } catch (err) {
      logger.warn(`[folder-order] Could not follow rename in order file: ${err.message}`);
    }
  }

  /** Drop an item that has been deleted or moved away from its parent's order. */
  async function tidyOrderOnRemove(itemAbsPath) {
    try {
      await removeFromFileOrder(path.dirname(itemAbsPath), path.basename(itemAbsPath));
    } catch (err) {
      logger.warn(`[folder-order] Could not prune order file: ${err.message}`);
    }
  }

  // Enhanced folder creation to support system folders like .templates
  app.post('/applications/wiki/api/folders', async (req, res) => {
    try {
      // Require authentication to create folders
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to create folders'
        });
      }

      const { name, spaceId, parentPath } = req.body;

      if (!name || !spaceId) {
        return res.status(400).json({
          success: false,
          message: 'Folder name and space ID are required'
        });
      }

      logger.info(`Creating folder: ${name} in space ${spaceId}, parent: ${parentPath || 'root'}`);
      logger.info(`Raw parentPath value: "${parentPath}", type: ${typeof parentPath}`);

      // Find the space
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === parseInt(spaceId));

      if (!space) {
        return res.status(404).json({ success: false, message: 'Space not found' });
      }

      // Create the physical folder
      const fs = require('node:fs').promises;

      // Use space's configured path if available, otherwise fall back to documents/spaceName
      let spaceBaseDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        spaceBaseDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        spaceBaseDir = path.resolve(documentsDir, space.name);
      }

      const folderPath = parentPath ? `${parentPath}/${name}` : name;
      const absolutePath = path.resolve(spaceBaseDir, folderPath);

      logger.info(`Space base dir: "${spaceBaseDir}"`);
      logger.info(`Computed folderPath: "${folderPath}"`);
      logger.info(`Final absolutePath: "${absolutePath}"`);

      // Security check - ensure the path is within the space's base directory.
      // isInside uses path.relative, which (unlike startsWith on the raw string)
      // is not fooled by a sibling dir sharing the base as a prefix, and treats
      // '..' traversal in parentPath/name as an escape.
      const normalizedBase = path.resolve(spaceBaseDir);
      if (!isInside(normalizedBase, absolutePath)) {
        logger.warn(`Blocked attempt to create folder outside space directory: ${folderPath}`);
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      try {
        await fs.mkdir(absolutePath, { recursive: true });

        const folder = {
          id: Date.now(), // Simple ID generation
          name: name,
          path: folderPath,
          spaceId: parseInt(spaceId),
          spaceName: space.name,
          parentPath: parentPath || null,
          createdAt: new Date().toISOString(),
          type: 'folder'
        };

        logger.info(`Created folder: ${name} at ${folderPath}`);

        // Emit event through EventBus for folder creation
        if (global.eventBus) {
          global.eventBus.emitChange('create', 'folder', {
            spaceId: space.id,
            spaceName: space.name,
            name: name,
            path: folderPath,
            parentPath: parentPath || '',
            created: folder.createdAt,
            modified: folder.createdAt,
            source: 'api',
            userId: req.user?.id || req.user?.username || 'unknown',
            userName: req.user?.username || 'unknown'
          });
        }

        res.json({ success: true, folder });
      } catch (fileError) {
        logger.error(`Failed to create folder ${folderPath}:`, fileError);
        res.status(500).json({
          success: false,
          message: 'Failed to create folder: ' + fileError.message
        });
      }
    } catch (error) {
      logger.error('Error creating folder:', error);
      res.status(500).json({ success: false, message: 'Failed to create folder' });
    }
  });

  // Rename folder endpoint
  app.put('/applications/wiki/api/folders/rename', async (req, res) => {
    try {
      // Require authentication to rename folders
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to rename folders'
        });
      }

      const { spaceId, oldPath, newName } = req.body;

      if (!spaceId || !oldPath || !newName) {
        return res.status(400).json({
          success: false,
          message: 'Space ID, old path, and new name are required'
        });
      }

      logger.info(`Renaming folder: ${oldPath} to ${newName} in space ${spaceId}`);

      // Find the space
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === parseInt(spaceId));

      if (!space) {
        return res.status(404).json({ success: false, message: 'Space not found' });
      }

      // Calculate new path
      const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;

      // Create the physical folder paths
      const fs = require('node:fs').promises;

      // Use space's configured path if available
      let spaceBaseDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        spaceBaseDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        spaceBaseDir = path.resolve(documentsDir, space.name);
      }

      const oldAbsolutePath = path.resolve(spaceBaseDir, oldPath);
      const newAbsolutePath = path.resolve(spaceBaseDir, newPath);

      // Security check
      if (!isInside(spaceBaseDir, oldAbsolutePath) || !isInside(spaceBaseDir, newAbsolutePath)) {
        logger.warn(`Blocked attempt to rename folder outside space directory`);
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      try {
        // Check if old folder exists
        await fs.access(oldAbsolutePath);

        // Check if new name already exists
        try {
          await fs.access(newAbsolutePath);
          return res.status(409).json({
            success: false,
            message: 'A folder with that name already exists'
          });
        } catch (existsError) {
          // Good, new name doesn't exist
        }

        // Rename the folder
        await fs.rename(oldAbsolutePath, newAbsolutePath);

        // Keep the parent's saved order pointing at it under its new name.
        await tidyOrderOnRename(oldAbsolutePath, newName);

        // Suppress fileWatcher events for this rename
        if (global.fileWatcherSuppressed) {
          global.fileWatcherSuppressed.add(oldAbsolutePath);
          global.fileWatcherSuppressed.add(newAbsolutePath);
          setTimeout(() => {
            global.fileWatcherSuppressed.delete(oldAbsolutePath);
            global.fileWatcherSuppressed.delete(newAbsolutePath);
          }, 3000);
        }

        // Emit rename event through EventBus
        if (global.eventBus) {
          global.eventBus.emitChange('rename', 'folder', {
            spaceId: space.id,
            spaceName: space.name,
            name: newName,
            path: newPath,
            oldPath: oldPath,
            newPath: newPath,
            parentPath: parentPath || '',
            source: 'api',
            userId: req.user?.id || req.user?.username || 'unknown',
            userName: req.user?.username || 'unknown'
          });
        }

        logger.info(`Successfully renamed folder from ${oldPath} to ${newPath}`);

        res.json({
          success: true,
          message: 'Folder renamed successfully',
          newPath: newPath
        });
      } catch (fileError) {
        logger.error(`Failed to rename folder ${oldPath}:`, fileError);
        if (fileError.code === 'ENOENT') {
          res.status(404).json({
            success: false,
            message: 'Folder not found'
          });
        } else {
          res.status(500).json({
            success: false,
            message: 'Failed to rename folder: ' + fileError.message
          });
        }
      }
    } catch (error) {
      logger.error('Error renaming folder:', error);
      res.status(500).json({ success: false, message: 'Failed to rename folder' });
    }
  });

  // Rename document/file endpoint
  app.put('/applications/wiki/api/documents/rename', async (req, res) => {
    try {
      // Require authentication to rename documents
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to rename documents'
        });
      }

      const { spaceName, oldPath, newName } = req.body;

      if (!spaceName || !oldPath || !newName) {
        return res.status(400).json({
          success: false,
          message: 'Space name, old path, and new name are required'
        });
      }

      logger.info(`Renaming file: ${oldPath} to ${newName} in space ${spaceName}`);

      // Find the space
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.name === spaceName);

      if (!space) {
        return res.status(404).json({ success: false, message: 'Space not found' });
      }

      // Calculate new path
      const parentPath = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
      const newPath = parentPath ? `${parentPath}/${newName}` : newName;

      // Create the physical file paths
      const fs = require('node:fs').promises;

      // Use space's configured path if available
      let spaceBaseDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        spaceBaseDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        spaceBaseDir = path.resolve(documentsDir, space.name);
      }

      const oldAbsolutePath = path.resolve(spaceBaseDir, oldPath);
      const newAbsolutePath = path.resolve(spaceBaseDir, newPath);

      // Security check
      if (!isInside(spaceBaseDir, oldAbsolutePath) || !isInside(spaceBaseDir, newAbsolutePath)) {
        logger.warn(`Blocked attempt to rename file outside space directory`);
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      try {
        // Check if old file exists
        await fs.access(oldAbsolutePath);

        // Check if new name already exists
        try {
          await fs.access(newAbsolutePath);
          return res.status(409).json({
            success: false,
            message: 'A file with that name already exists'
          });
        } catch (existsError) {
          // Good, new name doesn't exist
        }

        // Rename the file
        await fs.rename(oldAbsolutePath, newAbsolutePath);

        // Keep the parent's saved order pointing at it under its new name.
        await tidyOrderOnRename(oldAbsolutePath, newName);

        // Suppress fileWatcher events for this rename
        if (global.fileWatcherSuppressed) {
          global.fileWatcherSuppressed.add(oldAbsolutePath);
          global.fileWatcherSuppressed.add(newAbsolutePath);
          setTimeout(() => {
            global.fileWatcherSuppressed.delete(oldAbsolutePath);
            global.fileWatcherSuppressed.delete(newAbsolutePath);
          }, 3000);
        }

        // Update search index: remove old path and add new path
        // (space-relative — updateFile(absolutePath) mis-keyed named spaces).
        if (searchIndexer) {
          searchIndexer.removeFileFromIndex(oldPath);
          await searchIndexer.updateFileInSpace(spaceName, newPath);
          logger.info(`Updated search index: renamed ${oldPath} to ${newPath}`);
        }

        // Emit rename event through EventBus
        if (global.eventBus) {
          global.eventBus.emitChange('rename', 'file', {
            spaceId: space.id,
            spaceName: space.name,
            name: newName,
            path: newPath,
            oldPath: oldPath,
            newPath: newPath,
            parentPath: parentPath || '',
            source: 'api',
            userId: req.user?.id || req.user?.username || 'unknown',
            userName: req.user?.username || 'unknown'
          });
        }

        logger.info(`Successfully renamed file from ${oldPath} to ${newPath}`);

        res.json({
          success: true,
          message: 'File renamed successfully',
          newPath: newPath
        });
      } catch (fileError) {
        logger.error(`Failed to rename file ${oldPath}:`, fileError);
        if (fileError.code === 'ENOENT') {
          res.status(404).json({
            success: false,
            message: 'File not found'
          });
        } else {
          res.status(500).json({
            success: false,
            message: 'Failed to rename file: ' + fileError.message
          });
        }
      }
    } catch (error) {
      logger.error('Error renaming file:', error);
      res.status(500).json({ success: false, message: 'Failed to rename file' });
    }
  });

  // Delete folder endpoint
  app.delete('/applications/wiki/api/folders/:path(*)', async (req, res) => {
    try {
      // Require authentication to delete folders
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to delete folders'
        });
      }

      const folderPath = decodeURIComponent(req.params.path);
      const { spaceId } = req.body || {};

      logger.info(`Deleting folder: ${folderPath} in space ${spaceId}`);

      if (!folderPath) {
        return res.status(400).json({ success: false, message: 'Folder path is required' });
      }

      if (!spaceId) {
        return res.status(400).json({ success: false, message: 'Space ID is required' });
      }

      // Find the space
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === parseInt(spaceId));

      if (!space) {
        return res.status(404).json({ success: false, message: 'Space not found' });
      }

      // Build the full path for the folder
      const fs = require('node:fs').promises;

      // Use space's configured path if available
      let spaceBaseDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        spaceBaseDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        spaceBaseDir = path.resolve(documentsDir, space.name);
      }

      const fullFolderPath = path.resolve(spaceBaseDir, folderPath);
      const resolvedBaseDir = path.resolve(spaceBaseDir);

      // Security check - ensure path is within space directory
      const relativePath = path.relative(resolvedBaseDir, fullFolderPath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        logger.warn(`Blocked attempt to delete folder outside space directory: ${folderPath}`);
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      try {
        // Check if folder exists
        await fs.access(fullFolderPath);

        // Delete the folder and all its contents recursively
        await fs.rm(fullFolderPath, { recursive: true, force: true });

        // Drop the now-dead name from the parent's saved order.
        await tidyOrderOnRemove(fullFolderPath);

        // Emit event through EventBus for folder deletion
        if (global.eventBus) {
          global.eventBus.emitChange('delete', 'folder', {
            spaceId: space.id,
            spaceName: space.name,
            name: path.basename(folderPath),
            path: folderPath,
            source: 'api',
            userId: req.user?.id || req.user?.username || 'unknown',
            userName: req.user?.username || 'unknown'
          });
        }

        logger.info(`Successfully deleted folder: ${folderPath}`);
        res.json({ success: true, message: 'Folder deleted successfully' });

      } catch (deleteError) {
        logger.error(`Error deleting folder ${folderPath}:`, deleteError);
        if (deleteError.code === 'ENOENT') {
          res.status(404).json({ success: false, message: 'Folder not found' });
        } else {
          res.status(500).json({ success: false, message: 'Failed to delete folder: ' + deleteError.message });
        }
      }

    } catch (error) {
      logger.error('Error in delete folder endpoint:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Delete document endpoint
  app.delete('/applications/wiki/api/documents/:path(*)', async (req, res) => {
    try {
      // Require authentication to delete documents
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to delete documents'
        });
      }

      const filePath = decodeURIComponent(req.params.path);
      const { spaceId, spaceName } = req.body || {};

      logger.info(`Deleting document: ${filePath} in space ${spaceId}`);

      if (!filePath) {
        return res.status(400).json({ success: false, message: 'File path is required' });
      }

      // Find the space
      const spaces = await dataManager.read('spaces');
      let space;

      if (spaceId) {
        space = spaces.find(s => s.id === parseInt(spaceId));
      } else if (spaceName) {
        space = spaces.find(s => s.name === spaceName);
      }

      if (!space) {
        return res.status(404).json({ success: false, message: 'Space not found' });
      }

      // RBAC for template deletes: space-level templates require a space admin;
      // personal templates require the path's owner to be the caller.
      const delTplCheck = templateWriteCheck(req.user, space, filePath);
      if (!delTplCheck.allowed) {
        return res.status(403).json({ success: false, message: delTplCheck.reason });
      }

      // Build the full path for the file
      const fs = require('node:fs').promises;

      // Use space's configured path if available
      let spaceBaseDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        spaceBaseDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        spaceBaseDir = path.resolve(documentsDir, space.name);
      }

      const fullFilePath = path.resolve(spaceBaseDir, filePath);
      const resolvedBaseDir = path.resolve(spaceBaseDir);

      // Security check - ensure path is within space directory
      const relativePath = path.relative(resolvedBaseDir, fullFilePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        logger.warn(`Blocked attempt to delete file outside space directory: ${filePath}`);
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      try {
        // Check if file exists
        await fs.access(fullFilePath);

        // Delete the file
        await fs.unlink(fullFilePath);

        // Drop the now-dead name from the parent folder's saved order.
        await tidyOrderOnRemove(fullFilePath);

        // Remove from search index (incremental variant also schedules the
        // debounced disk persist, so the deletion survives a restart).
        if (searchIndexer) {
          searchIndexer.removeFileFromIndexIncremental(filePath);
          logger.info(`Removed document from search index: ${filePath}`);
        }

        // Emit event through EventBus for document deletion
        if (global.eventBus) {
          global.eventBus.emitChange('delete', 'file', {
            spaceId: space.id,
            spaceName: space.name,
            name: path.basename(filePath),
            path: filePath,
            source: 'api',
            userId: req.user?.id || req.user?.username || 'unknown',
            userName: req.user?.username || 'unknown'
          });
        }

        logger.info(`Successfully deleted document: ${filePath}`);
        res.json({ success: true, message: 'Document deleted successfully' });

      } catch (deleteError) {
        logger.error(`Error deleting document ${filePath}:`, deleteError);
        if (deleteError.code === 'ENOENT') {
          res.status(404).json({ success: false, message: 'Document not found' });
        } else {
          res.status(500).json({ success: false, message: 'Failed to delete document: ' + deleteError.message });
        }
      }

    } catch (error) {
      logger.error('Error in delete document endpoint:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Move file or folder endpoint (for drag and drop)
  app.post('/applications/wiki/api/move', async (req, res) => {
    try {
      // Require authentication to move items
      if (!req.isAuthenticated()) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required to move items'
        });
      }

      const { sourcePath, targetPath, spaceId, itemType } = req.body;

      // Validation
      if (!sourcePath || !spaceId || !itemType) {
        return res.status(400).json({
          success: false,
          message: 'Source path, space ID, and item type are required'
        });
      }

      if (!['file', 'folder'].includes(itemType)) {
        return res.status(400).json({
          success: false,
          message: 'Item type must be either "file" or "folder"'
        });
      }

      logger.info(`Moving ${itemType}: ${sourcePath} to ${targetPath || 'root'} in space ${spaceId}`);

      // Find the space
      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === parseInt(spaceId));

      if (!space) {
        return res.status(404).json({ success: false, message: 'Space not found' });
      }

      // Determine space base directory
      const fs = require('node:fs').promises;
      let spaceBaseDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        spaceBaseDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        spaceBaseDir = path.resolve(documentsDir, space.name);
      }

      // Build absolute paths
      const sourceAbsolutePath = path.resolve(spaceBaseDir, sourcePath);

      // Calculate destination path
      let destinationAbsolutePath;
      if (!targetPath || targetPath === '' || targetPath === '/') {
        // Moving to root
        const itemName = path.basename(sourcePath);
        destinationAbsolutePath = path.resolve(spaceBaseDir, itemName);
      } else {
        // Moving to a folder
        const itemName = path.basename(sourcePath);
        destinationAbsolutePath = path.resolve(spaceBaseDir, targetPath, itemName);
      }

      // Security checks
      if (!isInside(spaceBaseDir, sourceAbsolutePath)) {
        logger.warn(`Blocked attempt to move from outside space directory: ${sourcePath}`);
        return res.status(403).json({ success: false, message: 'Access denied: Invalid source path' });
      }

      if (!isInside(spaceBaseDir, destinationAbsolutePath)) {
        logger.warn(`Blocked attempt to move to outside space directory: ${targetPath}`);
        return res.status(403).json({ success: false, message: 'Access denied: Invalid destination path' });
      }

      // Prevent moving to same location
      if (sourceAbsolutePath === destinationAbsolutePath) {
        return res.status(400).json({
          success: false,
          message: 'Source and destination are the same'
        });
      }

      // For folders: prevent moving into itself or its subdirectories
      if (itemType === 'folder') {
        if (destinationAbsolutePath.startsWith(sourceAbsolutePath + path.sep) ||
            destinationAbsolutePath === sourceAbsolutePath) {
          return res.status(400).json({
            success: false,
            message: 'Cannot move a folder into itself or its subdirectories'
          });
        }
      }

      try {
        // Check if source exists
        await fs.access(sourceAbsolutePath);

        // Check if destination already exists
        try {
          await fs.access(destinationAbsolutePath);
          return res.status(409).json({
            success: false,
            message: `A ${itemType} with that name already exists at the destination`
          });
        } catch (existsError) {
          // Good, destination doesn't exist
        }

        // Ensure destination directory exists
        const destinationDir = path.dirname(destinationAbsolutePath);
        await fs.mkdir(destinationDir, { recursive: true });

        // Perform the move
        await fs.rename(sourceAbsolutePath, destinationAbsolutePath);

        // The item is gone from its old folder, so drop it from that folder's
        // saved order. It gets no entry in the destination's — an item nobody
        // has positioned there simply sorts with the rest.
        await tidyOrderOnRemove(sourceAbsolutePath);

        // Calculate the new relative path for response (normalize to forward slashes)
        const newRelativePath = path.relative(spaceBaseDir, destinationAbsolutePath).replace(/\\/g, '/');

        // Update search index for moved files
        if (searchIndexer) {
          if (itemType === 'file') {
            // For single file: remove old path and add new path
            // (space-relative — updateFile(absolutePath) mis-keyed named spaces).
            searchIndexer.removeFileFromIndex(sourcePath);
            await searchIndexer.updateFileInSpace(space.name, newRelativePath);
            logger.info(`Updated search index: moved file ${sourcePath} to ${newRelativePath}`);
          } else if (itemType === 'folder') {
            // For a folder: drop everything indexed under the OLD location in
            // one sweep (the previous walker traversed the destination and
            // removed the new paths, leaving all the old entries behind), then
            // re-index each file at its new location.
            searchIndexer.removeFolderFromIndex(sourcePath);

            const indexMovedFolder = async (folderPath, relativeBase) => {
              try {
                const items = await fs.readdir(folderPath, { withFileTypes: true });
                for (const item of items) {
                  const itemAbsPath = path.join(folderPath, item.name);
                  const itemRelativePath = `${relativeBase}/${item.name}`;

                  if (item.isFile()) {
                    await searchIndexer.updateFileInSpace(space.name, itemRelativePath);
                  } else if (item.isDirectory()) {
                    await indexMovedFolder(itemAbsPath, itemRelativePath);
                  }
                }
              } catch (err) {
                logger.warn(`Error updating search index for folder contents: ${err.message}`);
              }
            };

            await indexMovedFolder(destinationAbsolutePath, newRelativePath);
            logger.info(`Updated search index: moved folder ${sourcePath} to ${newRelativePath}`);
          }
        }

        // The move already happened on disk (the filing service is the source of
        // truth), so there is no JSON index to keep in sync. The search index is
        // updated above via searchIndexer, and the tree cache invalidates on the
        // move's change event.

        // Suppress fileWatcher events for this move
        if (global.fileWatcherSuppressed) {
          global.fileWatcherSuppressed.add(sourceAbsolutePath);
          global.fileWatcherSuppressed.add(destinationAbsolutePath);
          setTimeout(() => {
            global.fileWatcherSuppressed.delete(sourceAbsolutePath);
            global.fileWatcherSuppressed.delete(destinationAbsolutePath);
          }, 3000);
        }

        // Emit move event through EventBus
        if (global.eventBus) {
          const oldParentPath = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';
          global.eventBus.emitChange('move', itemType, {
            spaceId: space.id,
            spaceName: space.name,
            name: path.basename(sourcePath),
            path: newRelativePath,
            oldPath: sourcePath,
            newPath: newRelativePath,
            oldParentPath: oldParentPath,
            parentPath: targetPath || '',
            source: 'api',
            userId: req.user?.id || req.user?.username || 'unknown',
            userName: req.user?.username || 'unknown'
          });
        }

        logger.info(`Successfully moved ${itemType} from ${sourcePath} to ${newRelativePath}`);

        res.json({
          success: true,
          message: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} moved successfully`,
          newPath: newRelativePath
        });

      } catch (fileError) {
        logger.error(`Failed to move ${itemType} ${sourcePath}:`, fileError);
        if (fileError.code === 'ENOENT') {
          res.status(404).json({
            success: false,
            message: `${itemType.charAt(0).toUpperCase() + itemType.slice(1)} not found`
          });
        } else {
          res.status(500).json({
            success: false,
            message: `Failed to move ${itemType}: ` + fileError.message
          });
        }
      }

    } catch (error) {
      logger.error('Error in move endpoint:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Save a custom display order for the items inside one folder.
  //
  // Writes <folder>/.system/file-order.json and emits a folder-order-changed
  // event — which is the ONLY thing that invalidates the tree cache here, since
  // writes under `.system` are invisible to the file watcher by design.
  //
  // The order CASCADES to every folder beneath this one that has no order file
  // of its own (see utils/fileOrder.js), so saving here is a subtree-wide act;
  // that is why the payload is validated as child names and the folder is
  // checked against the space's own path curation before anything is written.
  app.put('/applications/wiki/api/spaces/:spaceId/folder-order', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const spaceId = parseInt(req.params.spaceId);
      const { folderPath = '', order } = req.body || {};

      if (typeof folderPath !== 'string') {
        return res.status(400).json({ success: false, message: 'folderPath must be a string' });
      }

      const sanitized = sanitizeOrderNames(order);
      if (!sanitized.ok) {
        return res.status(400).json({ success: false, message: sanitized.message });
      }

      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === spaceId);
      if (!space) {
        return res.status(404).json({ success: false, message: 'Space not found' });
      }

      // Same access test the folder-tree endpoint applies before serving this
      // space: if you may not read the tree, you may not reorder it.
      const hasAccess =
        space.visibility === 'public' ||
        space.visibility === 'team' ||
        (space.visibility === 'private' && space.allowedUsers?.includes(req.user?.email));
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      // A space may expose only a curated subset of its content root; a folder
      // outside it must not be writable through this endpoint either.
      if (!compileVisibility(space).isFolderAccessible(folderPath)) {
        return res.status(404).json({ success: false, message: 'Folder not found' });
      }

      let spaceBaseDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        spaceBaseDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        spaceBaseDir = path.resolve(documentsDir, space.name);
      }

      const resolvedBaseDir = path.resolve(spaceBaseDir);
      const folderAbsPath = folderPath
        ? path.resolve(resolvedBaseDir, folderPath)
        : resolvedBaseDir;

      // Containment by path.relative, not by string prefix: `../SpaceTwo`
      // resolves to a sibling that a startsWith() check happily accepts
      // whenever the sibling's name extends this space's own.
      const relativePath = path.relative(resolvedBaseDir, folderAbsPath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        logger.warn(`[folder-order] Blocked write outside space directory: ${folderPath}`);
        return res.status(403).json({ success: false, message: 'Access denied: invalid folder path' });
      }

      try {
        await writeFileOrder(folderAbsPath, sanitized.names);
      } catch (writeErr) {
        logger.error('[folder-order] Failed to write order file:', writeErr);
        return res.status(500).json({ success: false, message: 'Failed to save order' });
      }

      if (global.eventBus) {
        global.eventBus.emitChange('update', 'folder', {
          spaceId: space.id,
          spaceName: space.name,
          name: folderPath ? path.basename(folderPath) : space.name,
          path: folderPath,
          parentPath: folderPath.includes('/') ? folderPath.substring(0, folderPath.lastIndexOf('/')) : '',
          subtype: 'folder-order-changed',
          orderLength: sanitized.names.length,
          source: 'api',
          userId: req.user?.id || req.user?.username || 'unknown',
          userName: req.user?.username || 'unknown'
        });
      }

      res.json({ success: true, folderPath, order: sanitized.names });
    } catch (error) {
      logger.error('Error in folder-order endpoint:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // Assign (or clear) a status colour for a folder. The status is stored in the
  // PARENT folder's .system/file-types.json keyed by the folder's name (see
  // utils/folderTypes.js), mirroring the folder-order endpoint above. A missing
  // / unrecognised status clears any existing assignment. Emits a folder change
  // event so the tree cache rebuilds and clients pick up the new accent.
  app.put('/applications/wiki/api/spaces/:spaceId/folder-type', async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      const spaceId = parseInt(req.params.spaceId);
      const { folderPath, status } = req.body || {};

      if (!folderPath || typeof folderPath !== 'string') {
        return res.status(400).json({ success: false, message: 'folderPath is required' });
      }

      const spaces = await dataManager.read('spaces');
      const space = spaces.find(s => s.id === spaceId);
      if (!space) {
        return res.status(404).json({ success: false, message: 'Space not found' });
      }

      let spaceBaseDir;
      if (space.path || space.configuration?.filing?.baseDir) {
        spaceBaseDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.resolve(__dirname, '../../../documents');
        spaceBaseDir = path.resolve(documentsDir, space.name);
      }

      // The status is recorded against the folder's name in its parent's
      // .settings, so split the target into parent + child.
      const normalizedPath = folderPath.replace(/\/+$/, '');
      const childName = normalizedPath.includes('/')
        ? normalizedPath.substring(normalizedPath.lastIndexOf('/') + 1)
        : normalizedPath;
      const parentPath = normalizedPath.includes('/')
        ? normalizedPath.substring(0, normalizedPath.lastIndexOf('/'))
        : '';

      if (!childName) {
        return res.status(400).json({ success: false, message: 'Invalid folderPath' });
      }

      const parentAbsPath = parentPath
        ? path.resolve(spaceBaseDir, parentPath)
        : path.resolve(spaceBaseDir);

      // Security check - keep the settings write inside the space directory.
      const relativeParent = path.relative(path.resolve(spaceBaseDir), parentAbsPath);
      if (relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) {
        return res.status(403).json({ success: false, message: 'Access denied: invalid folder path' });
      }

      const applied = sanitizeStatus(status); // null clears the assignment
      try {
        await writeFolderType(parentAbsPath, childName, applied);
      } catch (writeErr) {
        logger.error('[folder-type] Failed to write file-types.json:', writeErr);
        return res.status(500).json({ success: false, message: 'Failed to save folder type' });
      }

      if (global.eventBus) {
        global.eventBus.emitChange('update', 'folder', {
          spaceId: space.id,
          spaceName: space.name,
          name: childName,
          path: normalizedPath,
          parentPath,
          subtype: 'folder-type-changed',
          status: applied,
          source: 'api',
          userId: req.user?.id || req.user?.username || 'unknown',
          userName: req.user?.username || 'unknown'
        });
      }

      res.json({ success: true, folderPath: normalizedPath, status: applied });
    } catch (error) {
      logger.error('Error in folder-type endpoint:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
};
