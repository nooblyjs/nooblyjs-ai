/**
 * @fileoverview Content Review Routes - API endpoints for JSON, Markdown, and Diff operations
 * Provides comprehensive endpoints for content browsing, viewing, searching, and downloading
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { promises: fsPromises } = require('node:fs');
const { containedPath, handlePathError } = require('../../shared/utils/pathSafety');

/**
 * Content Routes Module
 *
 * @function
 * @param {Object} options - Configuration options
 * @param {express.Application} options.app - The Express application instance
 * @param {Object} eventEmitter - Event emitter instance
 * @returns {void}
 */
module.exports = (type, options, eventEmitter) => {
  const app = options.app || options['express-app'];
  const logger = options.dependencies?.logging || console;

  const outputDir = path.join(__dirname, '../../output');
  const jsonDir = path.join(outputDir, 'json');
  const markdownDir = path.join(outputDir, 'markdown');

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  /**
   * Get file metadata
   */
  async function getFileMetadata(filePath) {
    try {
      const stats = await fsPromises.stat(filePath);
      return {
        name: path.basename(filePath),
        size: stats.size,
        created: stats.birthtime.toISOString(),
        modified: stats.mtime.toISOString(),
        isDirectory: stats.isDirectory(),
        sizeFormatted: formatFileSize(stats.size)
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Format file size
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Read directory recursively
   */
  async function readDirRecursive(dir) {
    const items = [];
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const metadata = await getFileMetadata(fullPath);
        if (metadata) {
          items.push({
            ...metadata,
            path: fullPath,
            relativePath: path.relative(outputDir, fullPath)
          });
        }
      }
    } catch (error) {
      logger.error('Error reading directory:', error);
    }
    return items;
  }

  /**
   * Search in JSON file
   */
  async function searchInFile(filePath, query) {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      const matches = [];
      const queryLower = query.toLowerCase();

      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(queryLower)) {
          matches.push({
            lineNumber: idx + 1,
            line: line.substring(0, 200)
          });
        }
      });

      return matches;
    } catch (error) {
      return [];
    }
  }

  // ============================================
  // JSON CONTENT ROUTES
  // ============================================

  /**
   * GET /api/content/json
   * List all JSON files in output/json/ directory
   */
  app.get('/api/content/json', async (req, res) => {
    try {
      // Ensure directory exists
      if (!fs.existsSync(jsonDir)) {
        await fsPromises.mkdir(jsonDir, { recursive: true });
      }

      const files = await readDirRecursive(jsonDir);
      res.json({
        success: true,
        data: files.filter(f => f.relativePath.endsWith('.json') || f.isDirectory)
      });
    } catch (error) {
      logger.error('Error listing JSON files:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/content/json/:path
   * Get specific JSON file content
   */
  app.get('/api/content/json/:path(*)', async (req, res) => {
    try {
      let filePath;
      try {
        filePath = containedPath(jsonDir, decodeURIComponent(req.params.path));
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      const stats = await fsPromises.stat(filePath);
      if (stats.isDirectory()) {
        const files = await readDirRecursive(filePath);
        return res.json({
          success: true,
          data: {
            isDirectory: true,
            files: files
          }
        });
      }

      const content = await fsPromises.readFile(filePath, 'utf-8');
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = null;
      }

      const metadata = await getFileMetadata(filePath);
      res.json({
        success: true,
        data: {
          ...metadata,
          content: content,
          parsed: parsed
        }
      });
    } catch (error) {
      res.status(404).json({ success: false, error: 'File not found' });
    }
  });

  /**
   * POST /api/content/json/search
   * Search in JSON files
   */
  app.post('/api/content/json/search', async (req, res) => {
    try {
      const { query, filename } = req.body;
      if (!query) {
        return res.status(400).json({ success: false, error: 'Query required' });
      }

      let filePath;
      if (filename) {
        try {
          filePath = containedPath(jsonDir, decodeURIComponent(filename));
        } catch (err) {
          if (handlePathError(res, err)) return;
          throw err;
        }
        if (!fs.existsSync(filePath)) {
          return res.status(404).json({ success: false, error: 'File not found' });
        }
      } else {
        filePath = jsonDir;
      }

      const results = [];
      if (fs.lstatSync(filePath).isDirectory()) {
        const files = await readDirRecursive(filePath);
        for (const file of files) {
          if (file.name.endsWith('.json')) {
            const matches = await searchInFile(file.path, query);
            if (matches.length > 0) {
              results.push({
                file: file.relativePath,
                matches: matches
              });
            }
          }
        }
      } else {
        const matches = await searchInFile(filePath, query);
        if (matches.length > 0) {
          results.push({
            file: path.basename(filePath),
            matches: matches
          });
        }
      }

      res.json({
        success: true,
        data: {
          query: query,
          count: results.reduce((sum, r) => sum + r.matches.length, 0),
          results: results
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/content/json/:path/download
   * Download JSON file
   */
  app.get('/api/content/json/:path(*)/download', async (req, res) => {
    try {
      let filePath;
      try {
        filePath = containedPath(jsonDir, decodeURIComponent(req.params.path));
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      const stats = await fsPromises.stat(filePath);
      if (stats.isDirectory()) {
        return res.status(400).json({ success: false, error: 'Cannot download directory' });
      }

      res.download(filePath);
    } catch (error) {
      res.status(404).json({ success: false, error: 'File not found' });
    }
  });

  // ============================================
  // MARKDOWN CONTENT ROUTES
  // ============================================

  /**
   * GET /api/content/markdown
   * List all Markdown files
   */
  app.get('/api/content/markdown', async (req, res) => {
    try {
      if (!fs.existsSync(markdownDir)) {
        await fsPromises.mkdir(markdownDir, { recursive: true });
      }

      const files = await readDirRecursive(markdownDir);
      res.json({
        success: true,
        data: files.filter(f => f.relativePath.endsWith('.md') || f.isDirectory)
      });
    } catch (error) {
      logger.error('Error listing Markdown files:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/content/markdown/:path
   * Get specific Markdown file content
   */
  app.get('/api/content/markdown/:path(*)', async (req, res) => {
    try {
      let filePath;
      try {
        filePath = containedPath(markdownDir, decodeURIComponent(req.params.path));
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      const stats = await fsPromises.stat(filePath);
      if (stats.isDirectory()) {
        const files = await readDirRecursive(filePath);
        return res.json({
          success: true,
          data: {
            isDirectory: true,
            files: files
          }
        });
      }

      const content = await fsPromises.readFile(filePath, 'utf-8');
      const metadata = await getFileMetadata(filePath);

      res.json({
        success: true,
        data: {
          ...metadata,
          content: content
        }
      });
    } catch (error) {
      res.status(404).json({ success: false, error: 'File not found' });
    }
  });

  /**
   * PUT /api/content/markdown/:path
   * Update Markdown file content
   */
  app.put('/api/content/markdown/:path(*)', async (req, res) => {
    try {
      let filePath;
      try {
        filePath = containedPath(markdownDir, decodeURIComponent(req.params.path));
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      const { content } = req.body;
      if (!content) {
        return res.status(400).json({ success: false, error: 'Content required' });
      }

      // Ensure directory exists
      const dir = path.dirname(filePath);
      await fsPromises.mkdir(dir, { recursive: true });

      await fsPromises.writeFile(filePath, content, 'utf-8');
      const metadata = await getFileMetadata(filePath);

      res.json({
        success: true,
        message: 'File updated successfully',
        data: metadata
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/content/markdown/search
   * Search in Markdown files
   */
  app.post('/api/content/markdown/search', async (req, res) => {
    try {
      const { query, filename } = req.body;
      if (!query) {
        return res.status(400).json({ success: false, error: 'Query required' });
      }

      let filePath;
      if (filename) {
        try {
          filePath = containedPath(markdownDir, decodeURIComponent(filename));
        } catch (err) {
          if (handlePathError(res, err)) return;
          throw err;
        }
      } else {
        filePath = markdownDir;
      }

      const results = [];
      if (fs.existsSync(filePath)) {
        const stats = fs.lstatSync(filePath);
        if (stats.isDirectory()) {
          const files = await readDirRecursive(filePath);
          for (const file of files) {
            if (file.name.endsWith('.md')) {
              const matches = await searchInFile(file.path, query);
              if (matches.length > 0) {
                results.push({
                  file: file.relativePath,
                  matches: matches
                });
              }
            }
          }
        } else if (filePath.endsWith('.md')) {
          const matches = await searchInFile(filePath, query);
          if (matches.length > 0) {
            results.push({
              file: path.basename(filePath),
              matches: matches
            });
          }
        }
      }

      res.json({
        success: true,
        data: {
          query: query,
          count: results.reduce((sum, r) => sum + r.matches.length, 0),
          results: results
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/content/markdown/:path/download
   * Download Markdown file
   */
  app.get('/api/content/markdown/:path(*)/download', async (req, res) => {
    try {
      let filePath;
      try {
        filePath = containedPath(markdownDir, decodeURIComponent(req.params.path));
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      const stats = await fsPromises.stat(filePath);
      if (stats.isDirectory()) {
        return res.status(400).json({ success: false, error: 'Cannot download directory' });
      }

      res.download(filePath);
    } catch (error) {
      res.status(404).json({ success: false, error: 'File not found' });
    }
  });

  // ============================================
  // DIFF/COMPARISON ROUTES
  // ============================================

  /**
   * GET /api/diff/:executionId1/:executionId2
   * Get diff between two execution versions
   */
  app.get('/api/diff/:executionId1/:executionId2', async (req, res) => {
    try {
      const { executionId1, executionId2 } = req.params;

      // This would compare two execution outputs
      // For now, return a structure that the frontend can use
      res.json({
        success: true,
        data: {
          executionId1: executionId1,
          executionId2: executionId2,
          diffs: []
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/diff/files
   * Get diff between two files
   */
  app.post('/api/diff/files', async (req, res) => {
    try {
      const { file1, file2 } = req.body;
      if (!file1 || !file2) {
        return res.status(400).json({ success: false, error: 'Both file paths required' });
      }

      let path1;
      let path2;
      try {
        path1 = containedPath(outputDir, decodeURIComponent(file1));
        path2 = containedPath(outputDir, decodeURIComponent(file2));
      } catch (err) {
        if (handlePathError(res, err)) return;
        throw err;
      }

      const content1 = fs.existsSync(path1) ? await fsPromises.readFile(path1, 'utf-8') : '';
      const content2 = fs.existsSync(path2) ? await fsPromises.readFile(path2, 'utf-8') : '';

      const lines1 = content1.split('\n');
      const lines2 = content2.split('\n');

      // Simple line-based diff
      const diffs = [];
      const maxLines = Math.max(lines1.length, lines2.length);

      for (let i = 0; i < maxLines; i++) {
        const line1 = lines1[i] || '';
        const line2 = lines2[i] || '';

        if (line1 !== line2) {
          diffs.push({
            lineNumber: i + 1,
            type: line1 === '' ? 'added' : line2 === '' ? 'removed' : 'modified',
            oldLine: line1,
            newLine: line2
          });
        }
      }

      res.json({
        success: true,
        data: {
          file1: file1,
          file2: file2,
          diffs: diffs,
          changeCount: diffs.length
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  logger.info('Content routes initialized');
};
