/**
 * @fileoverview Data Manager Service for Wiki Application
 * Handles JSON file persistence for wiki data (documents, spaces, users, etc.)
 * Uses noobly Core filer service for file operations
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2025-08-24
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs').promises;

/**
 * Data Manager Class
 * Manages all JSON file persistence operations for wiki application data
 */
class DataManager {
  constructor(dataDir = './application/', filerService = null, filingServiceWrapper = null) {
    this.dataDir = dataDir;
    this.filer = filerService;
    this.filingServiceWrapper = filingServiceWrapper;
  }

  /**
   * Set filing service wrapper after initialization
   * Called after wrapper is created
   */
  setFilingServiceWrapper(wrapper) {
    this.filingServiceWrapper = wrapper;
  }

  getFilePath(type) {
    // Spaces configuration goes into /spaces subfolder
    if (type === 'spaces') {
      return path.join(this.dataDir, 'spaces', `${type}.json`);
    }
    // Per-user files (activity, preferences, chat history, pins, content,
    // subscriptions, dashboard) no longer live here — see components/userStore.js.
    return path.join(this.dataDir, `${type}.json`);
  }

  async read(type) {
    const filePath = this.getFilePath(type);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`[DataManager] Failed to read ${type} at ${filePath}:`, error.message);
      }
      const arrayTypes = ['spaces', 'folders', 'users'];
      if (arrayTypes.includes(type)) {
        return [];
      }
      return null;
    }
  }

  async write(type, data) {
    const filePath = this.getFilePath(type);
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error(`[DataManager] Failed to write ${type} at ${filePath}:`, error.message);
      return false;
    }
  }

  async add(type, item) {
    const data = await this.read(type);
    
    // Generate ID if not provided
    if (!item.id) {
      const maxId = data.length > 0 ? Math.max(...data.map(d => d.id || 0)) : 0;
      item.id = maxId + 1;
    }
    
    data.push(item);
    await this.write(type, data);
    return item.id;
  }

  async update(type, id, updates) {
    const data = await this.read(type);
    const index = data.findIndex(item => item.id === id);
    
    if (index !== -1) {
      data[index] = { ...data[index], ...updates };
      await this.write(type, data);
      return data[index];
    }
    return null;
  }

  async remove(type, id) {
    const data = await this.read(type);
    const filtered = data.filter(item => item.id !== id);
    
    if (filtered.length !== data.length) {
      await this.write(type, filtered);
      return true;
    }
    return false;
  }

  async find(type, filter = {}) {
    const data = await this.read(type);
    
    if (Object.keys(filter).length === 0) {
      return data;
    }
    
    return data.filter(item => {
      return Object.entries(filter).every(([key, value]) => {
        return item[key] === value;
      });
    });
  }

  // Folder-specific methods
  async createFolder(spaceId, folderName, parentPath = '') {
    const folders = await this.read('folders');
    const folder = {
      id: folders.length > 0 ? Math.max(...folders.map(f => f.id || 0)) + 1 : 1,
      name: folderName,
      spaceId: spaceId,
      parentPath: parentPath,
      path: parentPath ? `${parentPath}/${folderName}` : folderName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    folders.push(folder);
    await this.write('folders', folders);
    return folder;
  }

  async getFolderTree(spaceId) {
    // Get space name from spaces data
    const spaces = await this.read('spaces');
    const space = spaces.find(s => s.id === spaceId);
    if (!space) {
      return [];
    }

    // Read from physical file system
    return this.getFolderTreeFromFileSystem(space.name);
  }

  async getFolderTreeFromFileSystem(spaceName) {
    try {
      // Use filing service wrapper if available
      if (this.filingServiceWrapper) {
        return await this.filingServiceWrapper.buildFileTree(spaceName, '');
      }

      // Fallback to old filesystem method if wrapper not available
      const spaces = await this.read('spaces');
      const space = spaces.find(s => s.name === spaceName);

      let spaceDir;
      if (space && (space.path || space.configuration?.filing?.baseDir)) {
        spaceDir = space.path || space.configuration.filing.baseDir;
      } else {
        const documentsDir = path.join(process.cwd(), 'documents');
        spaceDir = path.join(documentsDir, spaceName);
      }

      // Check if space directory exists using wrapper if available
      if (this.filingServiceWrapper) {
        const isDir = await this.filingServiceWrapper.isDirectory(spaceName, '');
        if (!isDir) return [];
      } else {
        try {
          const stats = await fs.stat(spaceDir);
          if (!stats.isDirectory()) return [];
        } catch (error) {
          return [];
        }
      }

      return await this.buildFileSystemTree(spaceDir, spaceName);
    } catch (error) {
      return [];
    }
  }

  async isDirectory(fullPath) {
    try {
      const stats = await fs.stat(fullPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async buildFileSystemTree(dirPath, spaceName, relativePath = '') {
    const tree = [];

    try {
      // Use filing service wrapper if available, otherwise fall back to fs
      let entries = [];
      let entryMetadata = {};
      if (this.filingServiceWrapper) {
        const rawEntries = await this.filingServiceWrapper.listDirectory(spaceName, relativePath || '');
        // Normalize entries to strings but preserve metadata
        entries = rawEntries
          .map(item => {
            if (typeof item === 'string') return item;
            const name = item.name || String(item);
            entryMetadata[name] = { size: item.size, created: item.created, modified: item.modified, isSymbolicLink: item.isSymbolicLink === true };
            return name;
          })
          .filter(name => !name.startsWith('.') || name.toLowerCase() === '.home.md' || name === '.aicontext');
      } else {
        // Fallback to filesystem
        entries = (await fs.readdir(dirPath))
          .filter(name => !name.startsWith('.') || name.toLowerCase() === '.home.md' || name === '.aicontext');
      }

      for (const entryName of entries) {
        const relativeEntryPath = relativePath ? `${relativePath}/${entryName}` : entryName;

        // Check if it's a directory using wrapper
        let isDir = false;
        if (this.filingServiceWrapper) {
          isDir = await this.filingServiceWrapper.isDirectory(spaceName, relativeEntryPath);
        } else {
          const fullPath = path.join(dirPath, entryName);
          isDir = await this.isDirectory(fullPath);
        }

        const meta = entryMetadata[entryName] || {};

        if (isDir) {
          // It's a folder - recurse
          const children = await this.buildFileSystemTree(dirPath, spaceName, relativeEntryPath);
          tree.push({
            type: 'folder',
            name: entryName,
            path: relativeEntryPath,
            children: children,
            isSymbolicLink: meta.isSymbolicLink,
            size: meta.size,
            created: meta.created,
            modified: meta.modified
          });
        } else {
          // It's a file
          tree.push({
            type: 'document',
            name: entryName,
            title: entryName,
            path: relativeEntryPath,
            fileName: entryName,
            spaceName: spaceName,
            isSymbolicLink: meta.isSymbolicLink,
            size: meta.size,
            created: meta.created,
            modified: meta.modified
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

    } catch (error) {
      // Error reading directory - log it for debugging
      console.error(`Error reading directory ${dirPath}:`, error.message);
    }

    return tree;
  }

  buildFolderTree(folders, documents) {
    const tree = [];
    const folderMap = new Map();
    
    // Create folder nodes
    folders.forEach(folder => {
      folderMap.set(folder.path, {
        ...folder,
        type: 'folder',
        children: [],
        documents: []
      });
    });
    
    // Add documents to appropriate folders or root
    documents.forEach(doc => {
      const folderPath = doc.folderPath || '';
      if (folderPath && folderMap.has(folderPath)) {
        folderMap.get(folderPath).documents.push({
          ...doc,
          type: 'document'
        });
      } else {
        tree.push({
          ...doc,
          type: 'document'
        });
      }
    });
    
    // Build tree structure
    folders.forEach(folder => {
      if (!folder.parentPath) {
        // Root level folder
        tree.push(folderMap.get(folder.path));
      } else {
        // Child folder
        const parent = folderMap.get(folder.parentPath);
        if (parent) {
          parent.children.push(folderMap.get(folder.path));
        }
      }
    });
    
    return tree;
  }

}

module.exports = DataManager;