/**
 * @fileoverview Continuous Exploration → Wiki Exporter
 *
 * Copies a project's generated Markdown documents into the Wiki module
 * so the rest of the platform (search, viewers, daemons) can use them.
 *
 * Each export is written into a single "Continuous Explorations" wiki space under a
 * slugged subfolder per project:
 *
 *   <space.path>/<project-slug>/<doc>.md
 *
 * The exporter is intentionally lazy about its dependencies: it grabs
 * spaceManager + wikiDataManager off the Express app at call time, so
 * continuous exploration module init order doesn't matter (continuous exploration runs after wiki,
 * but this also keeps the helper safe to import at module-load time).
 *
 * It also tolerates the wiki module being absent — callers get a clear
 * "wiki module not available" error rather than a crash.
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

const EXPLORATIONS_SPACE_NAME = 'Continuous Explorations';

class WikiExporter {
  /**
   * @param {Object} opts
   * @param {Object} opts.app           Express app (used to resolve managers)
   * @param {string} opts.appBaseDir    .application root (used to default the space's baseDir)
   * @param {Object} opts.log
   */
  constructor({ app, appBaseDir, log }) {
    this.app = app;
    this.appBaseDir = appBaseDir;
    this.log = log || console;
  }

  _spaceManager() { return this.app.get('spaceManager'); }
  _wikiDataManager() { return this.app.get('wikiDataManager'); }

  available() {
    return !!(this._spaceManager() && this._wikiDataManager());
  }

  // ─── Space resolution ───────────────────────────────────────────────

  /**
   * Find the Continuous Explorations space; create it if missing. Returns the space.
   */
  async ensureContinuousExplorationsSpace(userId) {
    const spaceManager = this._spaceManager();
    if (!spaceManager) throw new Error('SpaceManager not available — datasources module did not initialize');

    let space = spaceManager.getSpaceByName(EXPLORATIONS_SPACE_NAME);
    if (space) return space;

    const baseDir = path.join(this.appBaseDir, 'wiki-files', 'Continuous Explorations');
    await fs.mkdir(baseDir, { recursive: true });

    space = await spaceManager.createSpace({
      name: EXPLORATIONS_SPACE_NAME,
      description: 'Architecture & design documents drafted by Continuous Exploration.',
      type: 'documentation',
      visibility: 'team',
      permissions: 'read-write',
      allowedUsers: userId ? [userId] : [],
      configuration: {
        filing: {
          provider: 'local',
          baseDir,
          maxFileSize: 10485760,
          allowedExtensions: ['md', 'markdown', 'txt']
        }
      },
      metadata: {
        tags: ['continuous-exploration', 'generated'],
        archived: false,
        createdBy: 'continuous-exploration'
      }
    }, userId || 'continuous-exploration');

    this.log.info(`[continuous-exploration] created Continuous Explorations wiki space at ${baseDir}`);
    return space;
  }

  // ─── Export ─────────────────────────────────────────────────────────

  /**
   * Export a project's documents into a wiki space.
   *
   * @param {Object} args
   * @param {Object} args.project        Project metadata (from ProjectManager.get)
   * @param {string} args.sourceDocsDir  Absolute path to the project's documents/ folder
   * @param {string} args.userId         User performing the export (for documents.json author)
   * @param {number} [args.spaceId]      Override target space; defaults to Continuous Explorations
   *
   * @returns {Promise<{ spaceId, spaceName, folderPath, documents: [{ name, wikiPath }] }>}
   */
  async exportProject({ project, sourceDocsDir, userId, spaceId }) {
    if (!this.available()) {
      throw new Error('Wiki module not available — cannot export');
    }
    if (!project || !Array.isArray(project.documents) || !project.documents.length) {
      throw new Error('No documents to export');
    }

    const spaceManager = this._spaceManager();
    const dataManager = this._wikiDataManager();

    const space = spaceId
      ? spaceManager.getSpaceById(spaceId)
      : await this.ensureContinuousExplorationsSpace(userId);
    if (!space) throw new Error('Target space not found');

    const spaceBase = space.path
      || (space.configuration && space.configuration.filing && space.configuration.filing.baseDir);
    if (!spaceBase) throw new Error(`Space "${space.name}" has no filing baseDir configured`);

    const projectSlug = this._slug(project.name || project.id);
    const targetDir = path.join(spaceBase, projectSlug);
    await fs.mkdir(targetDir, { recursive: true });

    // Read current documents registry once, mutate, write once at the end.
    const registry = await this._safeRead(dataManager, 'documents');
    let nextId = registry.length ? Math.max(...registry.map(d => Number(d.id) || 0)) + 1 : 1;

    const exported = [];
    for (const doc of project.documents) {
      const sourcePath = path.join(sourceDocsDir, doc.name);
      let content;
      try {
        content = await fs.readFile(sourcePath, 'utf8');
      } catch (err) {
        this.log.warn(`[continuous-exploration] export: skipping ${doc.name} (${err.code || err.message})`);
        continue;
      }

      const wikiRelativePath = `${projectSlug}/${doc.name}`;
      const absolutePath = path.join(targetDir, doc.name);
      await fs.writeFile(absolutePath, content, 'utf8');

      // Replace any prior registry entry for the same path so a re-export
      // updates rather than duplicates.
      const priorIdx = registry.findIndex(d => d.path === wikiRelativePath && d.spaceId === space.id);
      const now = new Date().toISOString();
      const excerpt = (content || '').replace(/[#*`>_-]+/g, '').trim().slice(0, 150);

      const entry = {
        id: priorIdx >= 0 ? registry[priorIdx].id : nextId++,
        title: this._title(doc.name),
        path: wikiRelativePath,
        spaceId: space.id,
        spaceName: space.name,
        tags: ['continuous-exploration', `project:${projectSlug}`],
        excerpt: excerpt + (content.length > 150 ? '…' : ''),
        size: Buffer.byteLength(content, 'utf8'),
        mimeType: 'text/markdown',
        createdAt: priorIdx >= 0 ? registry[priorIdx].createdAt : now,
        updatedAt: now,
        author: userId || 'continuous-exploration',
        source: 'continuous-exploration',
        continuousExplorationProjectId: project.id
      };

      if (priorIdx >= 0) registry[priorIdx] = entry;
      else registry.push(entry);

      exported.push({ name: doc.name, wikiPath: wikiRelativePath });

      this._emitChange(priorIdx >= 0 ? 'update' : 'create', space, wikiRelativePath, doc.name, userId, entry);
    }

    if (exported.length) {
      await dataManager.write('documents', registry);
    }

    return {
      spaceId: space.id,
      spaceName: space.name,
      folderPath: projectSlug,
      documents: exported
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  _slug(s) {
    return String(s || 'project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'project';
  }

  _title(filename) {
    return String(filename || '')
      .replace(/\.md$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase()) || 'Untitled';
  }

  async _safeRead(dataManager, type) {
    try {
      const data = await dataManager.read(type);
      return Array.isArray(data) ? data : [];
    } catch (err) {
      this.log.warn(`[continuous-exploration] could not read wiki ${type}: ${err.message}`);
      return [];
    }
  }

  _emitChange(operation, space, relPath, name, userId, entry) {
    if (!global.eventBus || typeof global.eventBus.emitChange !== 'function') return;
    try {
      global.eventBus.emitChange(operation, 'file', {
        spaceId: space.id,
        spaceName: space.name,
        name,
        path: relPath,
        parentPath: path.dirname(relPath) === '.' ? '' : path.dirname(relPath),
        created: entry.createdAt,
        modified: entry.updatedAt,
        source: 'continuous-exploration-export',
        userId: userId || 'continuous-exploration',
        userName: userId || 'continuous-exploration'
      });
    } catch (err) {
      this.log.warn(`[continuous-exploration] eventBus emit failed: ${err.message}`);
    }
  }
}

module.exports = WikiExporter;
