/**
 * @fileoverview Filing Service Wrapper Utility
 * Provides convenient methods to access filing services for document operations
 * Abstracts away the complexity of space-aware filing service access
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

/**
 * Wrapper for filing service access
 * Handles space-aware document operations using the filing service
 */
class FilingServiceWrapper {
  /**
   * Initialize wrapper with required services
   * @param {Object} spaceManager - SpaceManager instance
   * @param {Object} spaceFilingManager - SpaceFilingManager instance
   * @param {Object} defaultFiling - Default filing service (fallback)
   * @param {Object} logger - Logger instance
   */
  constructor(spaceManager, spaceFilingManager, defaultFiling, logger) {
    this.spaceManager = spaceManager;
    this.spaceFilingManager = spaceFilingManager;
    this.defaultFiling = defaultFiling;
    this.logger = logger;
  }

  /**
   * Get filing service for a specific space
   * @param {string} spaceName - Name of space or spaceId
   * @returns {Promise<Object>} Filing service instance
   */
  async getFilingServiceForSpace(spaceName) {
    try {
      // Try to find space by name
      let space = null;
      if (typeof spaceName === 'string') {
        const spaces = this.spaceManager.getAllSpaces();
        space = spaces.find(s => s.name === spaceName || s.id == spaceName);
      }

      if (!space) {
        this.logger.warn(`[FilingServiceWrapper] Space not found: ${spaceName}`);
        return this.defaultFiling;
      }

      // Get filing service for this space
      const filingService = await this.spaceFilingManager.getFilingService(space.id);
      return filingService;
    } catch (error) {
      this.logger.warn(`[FilingServiceWrapper] Error getting filing service: ${error.message}`);
      return this.defaultFiling;
    }
  }

  /**
   * Read document content from filing service
   * @param {string} spaceName - Name of space
   * @param {string} documentPath - Path to document (relative to space)
   * @returns {Promise<string>} Document content
   */
  async readDocument(spaceName, documentPath) {
    try {
      const filing = await this.getFilingServiceForSpace(spaceName);
      const content = await filing.read(documentPath);
      return content;
    } catch (error) {
      this.logger.error(`[FilingServiceWrapper] Error reading document: ${spaceName}/${documentPath}`, error);
      throw error;
    }
  }

  /**
   * List documents in a directory
   * @param {string} spaceName - Name of space
   * @param {string} dirPath - Directory path (relative to space)
   * @returns {Promise<Array>} List of files/folders
   */
  async listDirectory(spaceName, dirPath = '') {
    try {
      const filing = await this.getFilingServiceForSpace(spaceName);
      const items = await filing.list(dirPath || '.');
      return items || [];
    } catch (error) {
      this.logger.warn(`[FilingServiceWrapper] Error listing directory: ${spaceName}/${dirPath}`, error);
      return [];
    }
  }

  /**
   * Get file metadata (size, type, etc)
   * @param {string} spaceName - Name of space
   * @param {string} filePath - Path to file
   * @returns {Promise<Object>} File metadata
   */
  async getFileMetadata(spaceName, filePath) {
    try {
      const filing = await this.getFilingServiceForSpace(spaceName);

      // Try to get metadata if filing service supports it
      if (filing.stat) {
        return await filing.stat(filePath);
      }

      // Fallback: try to read and check if it's a directory by attempting to list it
      try {
        const items = await filing.list(filePath);
        return {
          isDirectory: true,
          path: filePath,
          itemCount: items ? items.length : 0
        };
      } catch {
        // It's probably a file
        const content = await filing.read(filePath);
        return {
          isDirectory: false,
          path: filePath,
          size: content ? content.length : 0
        };
      }
    } catch (error) {
      this.logger.warn(`[FilingServiceWrapper] Error getting file metadata: ${spaceName}/${filePath}`, error);
      throw error;
    }
  }

  /**
   * Write document content
   * @param {string} spaceName - Name of space
   * @param {string} documentPath - Path to document
   * @param {string} content - Document content
   * @returns {Promise<boolean>} Success
   */
  async writeDocument(spaceName, documentPath, content) {
    try {
      const filing = await this.getFilingServiceForSpace(spaceName);
      await filing.update(documentPath, content);
      this.logger.info(`[FilingServiceWrapper] Document written: ${spaceName}/${documentPath}`);
      return true;
    } catch (error) {
      this.logger.error(`[FilingServiceWrapper] Error writing document: ${spaceName}/${documentPath}`, error);
      throw error;
    }
  }

  /**
   * Delete document
   * @param {string} spaceName - Name of space
   * @param {string} documentPath - Path to document
   * @returns {Promise<boolean>} Success
   */
  async deleteDocument(spaceName, documentPath) {
    try {
      const filing = await this.getFilingServiceForSpace(spaceName);
      if (filing.delete) {
        await filing.delete(documentPath);
        this.logger.info(`[FilingServiceWrapper] Document deleted: ${spaceName}/${documentPath}`);
        return true;
      } else {
        this.logger.warn(`[FilingServiceWrapper] Filing service does not support delete operation`);
        return false;
      }
    } catch (error) {
      this.logger.error(`[FilingServiceWrapper] Error deleting document: ${spaceName}/${documentPath}`, error);
      throw error;
    }
  }

  /**
   * Check if path is a directory
   * @param {string} spaceName - Name of space
   * @param {string} dirPath - Path to check
   * @returns {Promise<boolean>} True if directory
   */
  async isDirectory(spaceName, dirPath) {
    try {
      const filing = await this.getFilingServiceForSpace(spaceName);

      // Try to list the directory
      try {
        await filing.list(dirPath);
        return true;
      } catch {
        return false;
      }
    } catch (error) {
      this.logger.warn(`[FilingServiceWrapper] Error checking if directory: ${spaceName}/${dirPath}`, error);
      return false;
    }
  }

  /**
   * Recursively build file tree for a directory
   *
   * `options.shouldDescend` prunes the walk at the DIRECTORY level: return
   * false for a folder and neither it nor anything under it is listed. This is
   * how a curated space (allowedPaths/excludedPaths) avoids paying for content
   * it will only discard — filtering the finished tree, which is what callers
   * did before, still performs the entire disk walk first. On a content root of
   * ~6,000 directories that is the difference between one request and dozens.
   * Omit it and the walk is exhaustive, exactly as before.
   *
   * @param {string} spaceName - Name of space
   * @param {string} dirPath - Directory path
   * @param {Object} [options]
   * @param {function(string): boolean} [options.shouldDescend] - Given a
   *   space-relative folder path, may the walk enter it?
   * @returns {Promise<Array>} File tree
   */
  async buildFileTree(spaceName, dirPath = '', options = {}) {
    const shouldDescend = typeof options.shouldDescend === 'function'
      ? options.shouldDescend
      : null;

    try {
      const filing = await this.getFilingServiceForSpace(spaceName);
      const items = await filing.list(dirPath || '.');

      if (!items) return [];

      // Normalize entries - preserve metadata if available (isDirectory, type, size, created, modified)
      const normalizedItems = items
        .map(item => {
          if (typeof item === 'string') {
            return { name: item, isDirectory: null }; // unknown, will need to probe
          }
          return {
            name: item.name || String(item),
            isDirectory: item.isDirectory === true || item.type === 'folder',
            isSymbolicLink: item.isSymbolicLink === true,
            size: item.size,
            created: item.created,
            modified: item.modified
          };
        })
        .filter(item => !item.name.startsWith('.') || item.name.toLowerCase() === '.home.md' || item.name === '.aicontext');

      const tree = [];

      for (const item of normalizedItems) {
        const itemPath = dirPath ? `${dirPath}/${item.name}` : item.name;

        // Use metadata if available, otherwise fall back to probing
        let isDir = item.isDirectory;
        if (isDir === null) {
          isDir = await this.isDirectory(spaceName, itemPath);
        }

        if (isDir) {
          // Pruned: drop the folder entirely rather than emitting it with no
          // children. A caller's own tree filter discards an empty non-allowed
          // folder anyway, so an empty shell would only differ in cost.
          if (shouldDescend && !shouldDescend(itemPath)) continue;

          // Recursively build tree for subdirectory
          const children = await this.buildFileTree(spaceName, itemPath, options);
          tree.push({
            type: 'folder',
            name: item.name,
            path: itemPath,
            children: children,
            isSymbolicLink: item.isSymbolicLink,
            size: item.size,
            created: item.created,
            modified: item.modified
          });
        } else {
          tree.push({
            type: 'document',
            name: item.name,
            title: item.name,
            path: itemPath,
            spaceName: spaceName,
            isSymbolicLink: item.isSymbolicLink,
            size: item.size,
            created: item.created,
            modified: item.modified
          });
        }
      }

      // Sort: folders first, then files, both alphabetically
      tree.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

      return tree;
    } catch (error) {
      this.logger.warn(`[FilingServiceWrapper] Error building file tree: ${spaceName}/${dirPath}`, error);
      return [];
    }
  }

  /**
   * Get all files in a directory (recursively)
   * Used for indexing and searching
   * @param {string} spaceName - Name of space
   * @param {string} dirPath - Directory path
   * @returns {Promise<Array>} Flat list of all files with paths
   */
  async getAllFilesRecursive(spaceName, dirPath = '') {
    try {
      const tree = await this.buildFileTree(spaceName, dirPath);
      const files = [];

      const flattenTree = (items) => {
        for (const item of items) {
          if (item.type === 'document') {
            files.push(item.path);
          } else if (item.type === 'folder' && item.children) {
            flattenTree(item.children);
          }
        }
      };

      flattenTree(tree);
      return files;
    } catch (error) {
      this.logger.warn(`[FilingServiceWrapper] Error getting all files: ${spaceName}/${dirPath}`, error);
      return [];
    }
  }
}

module.exports = FilingServiceWrapper;
