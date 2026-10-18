/**
 * @fileoverview Continuous Exploration Project Manager
 *
 * A continuous exploration is a VISIBLE folder inside a wiki space, created where the user
 * right-clicked. The folder carries the continuous exploration's working files as hidden
 * dot-entries and its generated documents as plain wiki markdown:
 *
 *   <spaceContentDir>/<parentPath>/<Project Name>/
 *     .continuous-exploration.json    — metadata (name, description, templateId, owner, …)
 *     .chat.json         — conversation history with the assistant
 *     <doc>.md           — generated artifacts, one file per doc (normal,
 *                          searchable wiki documents)
 *
 * The folder is marked with the 'continuous-exploration' folder type in its parent's
 * `.system/file-types.json`, which gives it a continuous exploration icon in the
 * navigation and makes clicking it open the continuous exploration workspace.
 *
 * Operations that receive only an `:id` locate the project by scanning each
 * known space's tree (depth-capped, dot-folders skipped).
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');

const { writeFolderType } = require('../utils/folderTypes');

const META_FILE = '.continuous-exploration.json';
const CHAT_FILE = '.chat.json';
const MAX_SCAN_DEPTH = 8;

class ProjectManager {
  constructor(appBaseDir, log) {
    this.log = log || console;
    this.appBaseDir = appBaseDir || path.join(process.cwd(), '.application');
    this.spacesFile = path.join(this.appBaseDir, 'spaces', 'spaces.json');
  }

  // ─── Space resolution ──────────────────────────────────────────────────────

  /** Read the persisted spaces list (source of truth shared with the wiki). */
  async _readSpaces() {
    try {
      const raw = await fs.readFile(this.spacesFile, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  /** Absolute content directory for a space (where its files live). */
  _spaceContentDir(space) {
    return space.path
      || space.configuration?.filing?.baseDir
      || path.join(this.appBaseDir, 'spaces', String(space.id), 'files');
  }

  async _resolveSpace(spaceId) {
    if (spaceId === undefined || spaceId === null || spaceId === '') return null;
    const spaces = await this._readSpaces();
    return spaces.find(s => String(s.id) === String(spaceId)) || null;
  }

  // ─── Path helpers ────────────────────────────────────────────────────────────

  /**
   * Normalise a space-relative folder path: forward slashes, no leading or
   * trailing separators, and no traversal segments. Throws on `..`.
   */
  _safeRelPath(p) {
    const rel = String(p || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!rel) return '';
    const segments = rel.split('/');
    if (segments.some(s => s === '..' || s === '')) {
      throw new Error('Invalid folder path');
    }
    return segments.join('/');
  }

  /** A filesystem-safe folder name derived from the project name (keeps spaces). */
  _folderNameFor(name) {
    return String(name || '').trim()
      .replace(/[<>:"/\\|?*]+/g, '-')
      .replace(/^\.+/, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Continuous Exploration';
  }

  // ─── Location: { dir, meta, space } ──────────────────────────────────────────

  async _readJsonAt(file) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Stamp derived fields the frontend relies on onto a meta record. */
  _stamp(meta, space, relPath) {
    meta.spaceId = Number(space.id);
    meta.spaceName = space.name || meta.spaceName || '';
    meta.path = relPath;
    return meta;
  }

  /**
   * Find every continuous exploration in one space: visible folders that
   * contain a .continuous-exploration.json meta file.
   */
  async _scanSpace(space) {
    const base = this._spaceContentDir(space);
    const out = [];

    const walk = async (dir, rel, depth) => {
      if (depth > MAX_SCAN_DEPTH) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      if (entries.some(e => e.isFile() && e.name === META_FILE)) {
        const meta = await this._readJsonAt(path.join(dir, META_FILE));
        if (meta) out.push({ dir, meta: this._stamp(meta, space, rel), space });
        return; // continuous explorations don't nest
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        await walk(path.join(dir, entry.name), rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
      }
    };
    await walk(base, '', 0);

    return out;
  }

  /** Find a project's folder + metadata by id across every space. */
  async _locate(id) {
    if (!id) return null;
    const spaces = await this._readSpaces();
    for (const space of spaces) {
      const found = (await this._scanSpace(space)).find(f => f.meta.id === id);
      if (found) return found;
    }
    return null;
  }

  /** Generated documents live directly in the project folder. */
  _docsDirOf(found) { return found.dir; }
  _chatFileOf(found) { return path.join(found.dir, CHAT_FILE); }

  async _writeMeta(found) {
    // `path` is a derived stamp — never persisted.
    const { path: relPath, ...persisted } = found.meta;
    await fs.mkdir(found.dir, { recursive: true });
    await fs.writeFile(
      path.join(found.dir, META_FILE),
      JSON.stringify(persisted, null, 2),
      'utf8'
    );
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  /**
   * List projects. Pass a spaceId to list only that space's continuous explorations;
   * omit it to aggregate across every space.
   */
  async list(userId, spaceId) {
    const spaces = await this._readSpaces();
    const targets = (spaceId !== undefined && spaceId !== null && spaceId !== '')
      ? spaces.filter(s => String(s.id) === String(spaceId))
      : spaces;

    const projects = [];
    for (const space of targets) {
      for (const found of await this._scanSpace(space)) {
        if (userId && found.meta.ownerId && found.meta.ownerId !== userId) continue;
        projects.push(found.meta);
      }
    }
    projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return projects;
  }

  async get(id, userId) {
    const found = await this._locate(id);
    if (!found) return null;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return null;
    return found.meta;
  }

  /**
   * Resolve a continuous exploration by its visible folder path within a space — the
   * lookup behind "click a continuous exploration folder, open the workspace".
   */
  async getByPath(spaceId, folderPath, userId) {
    const space = await this._resolveSpace(spaceId);
    if (!space) return null;
    let rel;
    try {
      rel = this._safeRelPath(folderPath);
    } catch {
      return null;
    }
    if (!rel) return null;
    const dir = path.join(this._spaceContentDir(space), rel);
    const meta = await this._readJsonAt(path.join(dir, META_FILE));
    if (!meta) return null;
    if (userId && meta.ownerId && meta.ownerId !== userId) return null;
    return this._stamp(meta, space, rel);
  }

  /** Absolute path to a project's generated-documents folder, or null. */
  async documentsDir(id, userId) {
    const found = await this._locate(id);
    if (!found) return null;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return null;
    return this._docsDirOf(found);
  }

  /**
   * Normalise a wikiContext selection.
   *
   * ORDER IS DATA — wikiContextLoader reads the entries in array order and
   * stops at its byte budget, and the picker lets the user arrange them for
   * exactly that reason, so this maps but never sorts or dedupes.
   *
   * `kind` ('folder' | 'file') is a HINT for the UI's icon and label. The
   * loader still stats the path, so an entry written before `kind` existed —
   * or one whose target changed from a file to a folder — resolves correctly
   * either way.
   */
  _normaliseContext(ctx) {
    if (!Array.isArray(ctx)) return [];
    return ctx
      .filter(c => c && (c.spaceId !== undefined && c.spaceId !== null))
      .map(c => ({
        spaceId: Number(c.spaceId),
        spaceName: c.spaceName || '',
        folderPath: typeof c.folderPath === 'string' ? c.folderPath : '',
        name: c.name || (c.folderPath ? c.folderPath.split('/').pop() : c.spaceName || 'root'),
        kind: c.kind === 'file' ? 'file' : 'folder'
      }));
  }

  /**
   * Create a continuous exploration as a visible folder under `parentPath` (space root when
   * omitted) and mark it with the 'continuous-exploration' folder type so the navigation
   * picks it up.
   */
  async create({ name, description, templateId, ownerId, wikiContext, requirement, spaceId, spaceName, parentPath }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('name is required');
    }
    const space = await this._resolveSpace(spaceId);
    if (!space) {
      throw new Error('A valid spaceId is required — a continuous exploration must live in a space');
    }

    const base = this._spaceContentDir(space);
    const parentRel = this._safeRelPath(parentPath || '');
    const parentAbs = parentRel ? path.join(base, parentRel) : base;

    // The parent must already exist (it's the folder the user right-clicked).
    try {
      await fs.access(parentAbs);
    } catch {
      throw new Error(`Parent folder "${parentRel || '/'}" not found in space "${space.name}"`);
    }

    // Unique visible folder name derived from the project name.
    const baseName = this._folderNameFor(name);
    let folderName = baseName;
    for (let i = 2; ; i++) {
      try {
        await fs.access(path.join(parentAbs, folderName));
        folderName = `${baseName} ${i}`;
      } catch {
        break; // free name found
      }
    }

    const dir = path.join(parentAbs, folderName);
    await fs.mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    const relPath = parentRel ? `${parentRel}/${folderName}` : folderName;
    const found = {
      dir,
      space,
      meta: {
        id: crypto.randomUUID(),
        name: name.trim(),
        description: (description || '').trim(),
        templateId: templateId || null,
        ownerId: ownerId || null,
        spaceId: Number(space.id),
        spaceName: space.name || spaceName || '',
        requirement: typeof requirement === 'string' ? requirement : '',
        wikiContext: this._normaliseContext(wikiContext),
        documents: [],          // [{ name, path, generatedAt, model }]
        createdAt: now,
        updatedAt: now
      }
    };
    await this._writeMeta(found);

    // Give the folder its continuous exploration identity in the navigation.
    try {
      await writeFolderType(parentAbs, folderName, 'continuous-exploration');
    } catch (err) {
      this.log.warn(`[continuous-exploration] could not set folder type for "${relPath}": ${err.message}`);
    }

    return this._stamp(found.meta, space, relPath);
  }

  async update(id, patch, userId) {
    const found = await this._locate(id);
    if (!found) return null;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return null;

    const allowed = ['name', 'description', 'templateId', 'requirement'];
    for (const key of allowed) {
      if (patch[key] !== undefined) found.meta[key] = patch[key];
    }
    if (patch.wikiContext !== undefined) {
      found.meta.wikiContext = this._normaliseContext(patch.wikiContext);
    }
    found.meta.updatedAt = new Date().toISOString();
    await this._writeMeta(found);
    return found.meta;
  }

  async remove(id, userId) {
    const found = await this._locate(id);
    if (!found) return false;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return false;
    await fs.rm(found.dir, { recursive: true, force: true });
    // Clear the 'continuous-exploration' folder-type entry left in the parent's .settings.
    try {
      await writeFolderType(path.dirname(found.dir), path.basename(found.dir), null);
    } catch (err) {
      this.log.warn(`[continuous-exploration] could not clear folder type after delete: ${err.message}`);
    }
    return true;
  }

  // ─── Documents ───────────────────────────────────────────────────────────────

  /**
   * Generated-document names must be plain visible markdown files — never a
   * dot-file, so they can't collide with .continuous-exploration.json / .chat.json.
   */
  _safeDocName(name) {
    const safe = String(name || '').trim()
      .replace(/[^a-zA-Z0-9_.-]+/g, '-')
      .replace(/^[-.]+|-+$/g, '') || 'document';
    return safe.endsWith('.md') ? safe : `${safe}.md`;
  }

  /**
   * Write a generated document to disk and register it in the metadata.
   * If a document with the same name exists, it's overwritten and its
   * registry entry's generatedAt is bumped.
   */
  async writeDocument(id, { name, content, model }, userId) {
    const found = await this._locate(id);
    if (!found) return null;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return null;

    const filename = this._safeDocName(name);
    const docsDir = this._docsDirOf(found);
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, filename), content || '', 'utf8');

    const now = new Date().toISOString();
    found.meta.documents = found.meta.documents || [];
    const existing = found.meta.documents.find(d => d.name === filename);
    if (existing) {
      existing.generatedAt = now;
      existing.model = model || existing.model || null;
    } else {
      found.meta.documents.push({
        name: filename,
        path: filename,
        generatedAt: now,
        model: model || null
      });
    }
    found.meta.updatedAt = now;
    await this._writeMeta(found);

    return found.meta.documents.find(d => d.name === filename);
  }

  async readDocument(id, name, userId) {
    const found = await this._locate(id);
    if (!found) return null;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return null;
    const safeName = path.basename(String(name || ''));
    if (!safeName || safeName.startsWith('.')) return null;
    try {
      const content = await fs.readFile(path.join(this._docsDirOf(found), safeName), 'utf8');
      return { name: safeName, content };
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async deleteDocument(id, name, userId) {
    const found = await this._locate(id);
    if (!found) return false;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return false;
    const safeName = path.basename(String(name || ''));
    if (!safeName || safeName.startsWith('.')) return false;
    try {
      await fs.unlink(path.join(this._docsDirOf(found), safeName));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    found.meta.documents = (found.meta.documents || []).filter(d => d.name !== safeName);
    found.meta.updatedAt = new Date().toISOString();
    await this._writeMeta(found);
    return true;
  }

  // ─── Chat history ──────────────────────────────────────────────────────────────

  async readChat(id, userId) {
    const found = await this._locate(id);
    if (!found) return null;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return null;
    const parsed = await this._readJsonAt(this._chatFileOf(found));
    return Array.isArray(parsed) ? parsed : [];
  }

  async appendChat(id, messages, userId) {
    const found = await this._locate(id);
    if (!found) return null;
    if (userId && found.meta.ownerId && found.meta.ownerId !== userId) return null;
    const existing = await this._readJsonAt(this._chatFileOf(found));
    const next = (Array.isArray(existing) ? existing : []).concat(messages.map(m => ({
      role: m.role,
      content: m.content,
      at: m.at || new Date().toISOString()
    })));
    await fs.writeFile(this._chatFileOf(found), JSON.stringify(next, null, 2), 'utf8');
    return next;
  }
}

module.exports = ProjectManager;
