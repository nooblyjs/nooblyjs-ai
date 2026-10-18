/**
 * @fileoverview Continuous Exploration Template Manager
 *
 * A "template" is a reusable prompt package the AI uses to draft a continuous exploration.
 * It owns:
 *   - systemPrompt: persistent context the AI gets for every doc and every chat
 *     turn under this template (the "what to build" framing).
 *   - documents:    the list of artifacts the AI should produce when a user
 *     hits Generate. Each entry has a name (becomes the .md filename) and a
 *     per-doc prompt that's appended after the requirement.
 *
 * Templates live INSIDE a wiki space, beside that space's continuous exploration projects:
 *
 *   <spaceContentDir>/.system/continuous-explorations/.templates/<id>.json
 *
 * The `.system/continuous-explorations` prefix lives under the platform's shared
 * private per-space `.system/` namespace (alongside `.system/useractivity`,
 * `.system/templates`) so the wiki file-tree, search index and file-watcher all
 * skip it. Because templates are scattered across space
 * folders, id-only operations (get/update/remove) locate the template by
 * scanning each known space — ids are always UUIDs, so they cannot collide
 * across spaces.
 *
 * Templates come in three scopes, mirroring document templates exactly (see
 * `filePolicy.js` and `spacePermissions.js`):
 *
 *   space     <spaceContentDir>/.system/continuous-explorations/.templates/
 *   folder    <spaceContentDir>/<folder>/.system/continuous-explorations/.templates/
 *   personal  <spaceContentDir>/.system/useractivity/<prefix>/continuousexploration/
 *
 * The folder scope is resolved as a CASCADE: listing for a folder walks that
 * folder and every ancestor, closest first, ending at the space tier — so a
 * space-wide playbook reaches everywhere while a team can override one by name
 * in their own subtree.
 *
 * NOTE on id-only lookups: a folder template's directory cannot be derived from
 * its id, and scanning the tree for one is exactly the walk the folder-tree work
 * exists to avoid (thousands of readdirs over symlinked repos — see CLAUDE.md).
 * Callers therefore pass the `folderPath` they listed it from; `_locate` probes
 * that cascade before falling back to the space and personal tiers.
 *
 * A space's template folder is seeded with the default org playbook the first
 * time it is listed (only when the folder does not exist yet — an existing but
 * emptied folder stays empty, so deleting the defaults is respected).
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { ancestorDirsFor, pickClosest } = require('../../shared/utils/filePolicy');
const { compileVisibility } = require('../../shared/spaces/spaceVisibility');

const EXPLORATIONS_DIR = '.system/continuous-explorations';
const TEMPLATES_DIR = '.templates';
// Personal (per-user) CE templates live beside the user's other per-space
// activity: <spaceContentDir>/.system/useractivity/<prefix>/continuousexploration/<id>.json
const USERACTIVITY_DIR = '.system/useractivity';
const PERSONAL_CE_DIR = 'continuousexploration';

class TemplateManager {
  constructor(appBaseDir, log) {
    this.log = log || console;
    this.appBaseDir = appBaseDir || path.join(process.cwd(), '.application');
    this.spacesFile = path.join(this.appBaseDir, 'spaces', 'spaces.json');
  }

  // ─── Space resolution (mirrors projectManager) ──────────────────────────

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

  /**
   * The folder holding a space's templates for the given scope:
   *   scope 'space'    → <space>/.system/continuous-explorations/.templates
   *   scope 'folder'   → <space>/<folderPath>/.system/continuous-explorations/.templates
   *   scope 'personal' → <space>/.system/useractivity/<userDir>/continuousexploration
   */
  _templatesDir(space, scope = 'space', userDir = null, folderPath = '') {
    const base = this._spaceContentDir(space);
    if (scope === 'personal') {
      if (!userDir) throw new Error('userDir is required for personal continuous-exploration templates');
      return path.join(base, USERACTIVITY_DIR, userDir, PERSONAL_CE_DIR);
    }
    if (scope === 'folder') {
      const rel = this._normaliseFolder(folderPath);
      if (!rel) throw new Error('folderPath is required for folder-scoped continuous-exploration templates');
      return path.join(base, rel, EXPLORATIONS_DIR, TEMPLATES_DIR);
    }
    return path.join(base, EXPLORATIONS_DIR, TEMPLATES_DIR);
  }

  /**
   * Normalise a caller-supplied folder to a safe space-relative POSIX path.
   * Returns '' for the space root. Throws on traversal — a folderPath is used to
   * build a directory name, so it gets the same treatment as any other path from
   * a client.
   */
  _normaliseFolder(folderPath) {
    const norm = String(folderPath || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!norm) return '';
    if (norm.split('/').includes('..')) throw new Error('Invalid folderPath');
    return norm;
  }

  /**
   * The template directories that apply to `folderPath`, closest first, ending at
   * the space tier. Each entry carries where it came from so listings can label it.
   *
   * Tiers the space does not expose are DROPPED. The walk crosses folders the
   * caller never named, so on a shared content root it otherwise reaches straight
   * through a pass-through container into a subtree the space curates away — the
   * same hole the document-template cascade had (see spacesRoutes'
   * resolveTemplateCascade). The root tier is always kept: its owner folder is
   * '', the root-level exemption that keeps a space's own configuration reachable.
   *
   * @returns {Array<{dir: string, scope: string, folderPath: string, distance: number}>}
   */
  _cascadeDirs(space, folderPath) {
    const base = this._spaceContentDir(space);
    const rel = this._normaliseFolder(folderPath);
    const subDir = `${EXPLORATIONS_DIR}/${TEMPLATES_DIR}`;
    const relDirs = ancestorDirsFor(rel, subDir);
    const visibility = compileVisibility(space);
    return relDirs.map((relDir, distance) => {
      const isRoot = distance === relDirs.length - 1;
      const owner = isRoot ? '' : relDir.slice(0, relDir.lastIndexOf(`/${subDir}`));
      if (!isRoot && visibility.restricted && !visibility.isFileVisible(`${relDir}/probe.json`)) {
        return null;
      }
      return {
        dir: path.join(base, relDir),
        scope: isRoot ? 'space' : 'folder',
        folderPath: owner,
        distance
      };
    }).filter(Boolean);
  }

  async _resolveSpace(spaceId) {
    if (spaceId === undefined || spaceId === null || spaceId === '') return null;
    const spaces = await this._readSpaces();
    return spaces.find(s => String(s.id) === String(spaceId)) || null;
  }

  /** Public alias so route handlers can fetch a space record for RBAC checks. */
  async resolveSpace(spaceId) {
    return this._resolveSpace(spaceId);
  }

  // ─── Listing ─────────────────────────────────────────────────────────────

  /**
   * Read one template directory, stamping each record with spaceId/spaceName and
   * whatever provenance the caller supplies. A missing directory reads as empty.
   */
  async _readDir(space, dir, stamps = {}) {
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const templates = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, entry), 'utf8');
        const tpl = JSON.parse(raw);
        tpl.spaceId = Number(space.id);
        tpl.spaceName = space.name || '';
        Object.assign(tpl, stamps);
        templates.push(tpl);
      } catch (err) {
        this.log.warn(`[continuous-exploration] skipped malformed template ${entry} in space ${space.name}: ${err.message}`);
      }
    }
    templates.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return templates;
  }

  /**
   * All templates of one scope in one space, stamped with spaceId/spaceName,
   * `scope`, and (for personal) `owner`.
   */
  async _listIn(space, scope = 'space', userDir = null) {
    if (scope === 'personal' && !userDir) return [];
    const stamps = scope === 'personal' ? { scope, owner: userDir } : { scope };
    return this._readDir(space, this._templatesDir(space, scope, userDir), stamps);
  }

  /**
   * List templates. Pass a spaceId to list only that space's templates; omit it
   * to aggregate across every space. Pass { userDir } to also include the
   * caller's personal templates (scope: 'personal') alongside the space-level
   * ones (scope: 'space').
   *
   * Pass { folderPath } to resolve the FOLDER cascade for that folder instead of
   * the bare space tier: the folder and each ancestor, closest first, ending at
   * the space tier, with a nearer template of the same NAME hiding the ones above
   * it. Only meaningful with a spaceId — a cascade is rooted in one space.
   * Personal templates are space-wide and never take part in shadowing.
   */
  async list(spaceId, { userDir = null, folderPath = null } = {}) {
    const spaces = await this._readSpaces();
    const scoped = spaceId !== undefined && spaceId !== null && spaceId !== '';
    const targets = scoped
      ? spaces.filter(s => String(s.id) === String(spaceId))
      : spaces;

    const all = [];
    for (const space of targets) {
      if (scoped && folderPath !== null) {
        const cascade = [];
        for (const level of this._cascadeDirs(space, folderPath)) {
          const { dir, ...stamps } = level;
          cascade.push(...await this._readDir(space, dir, stamps));
        }
        all.push(...pickClosest(cascade));
      } else {
        all.push(...await this._listIn(space, 'space'));
      }
      if (userDir) all.push(...await this._listIn(space, 'personal', userDir));
    }
    all.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return all;
  }

  /**
   * Read one candidate template file, or null when it isn't there.
   * @private
   */
  async _readOne(space, file, stamps) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const template = JSON.parse(raw);
      template.spaceId = Number(space.id);
      template.spaceName = space.name || '';
      Object.assign(template, stamps);
      return { space, file, template, scope: stamps.scope };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return null;
    }
  }

  /**
   * Find a template by id. Scans every space's space-level folder, and — when
   * a userDir is supplied — that user's personal folder in every space too.
   *
   * A folder-scoped template is NOT discoverable from its id alone (its directory
   * is not derivable, and searching for it means walking the tree). Pass the
   * `folderPath` it was listed from and the cascade for that folder is probed
   * first; without one, folder templates are invisible here — which is why the
   * routes forward the client's folderPath on update and delete.
   *
   * PASS `spaceId` WHENEVER THE CALLER KNOWS IT. Several spaces share one content
   * root, so the same file on disk is reachable through every one of them — and
   * an unconstrained scan returns whichever space happens to come first in
   * spaces.json. That matters because the space in the result is what
   * `templateRbacDenial` then evaluates admin rights against: without this, a
   * user could be judged an admin (or not) of a space they are not even working
   * in. Scoping to the requested space makes the RBAC question the right one.
   *
   * Returns { space, file, template, scope } or null.
   */
  async _locate(id, { userDir = null, folderPath = null, spaceId = null } = {}) {
    if (!id) return null;
    const all = await this._readSpaces();
    const spaces = (spaceId !== null && spaceId !== undefined && spaceId !== '')
      ? all.filter(s => String(s.id) === String(spaceId))
      : all;

    for (const space of spaces) {
      if (folderPath !== null) {
        for (const level of this._cascadeDirs(space, folderPath)) {
          const { dir, ...stamps } = level;
          const found = await this._readOne(space, path.join(dir, `${id}.json`), stamps);
          if (found) return found;
        }
      }

      const spaceLevel = await this._readOne(
        space, path.join(this._templatesDir(space, 'space'), `${id}.json`), { scope: 'space' });
      if (spaceLevel) return spaceLevel;

      if (userDir) {
        const personal = await this._readOne(
          space,
          path.join(this._templatesDir(space, 'personal', userDir), `${id}.json`),
          { scope: 'personal', owner: userDir });
        if (personal) return personal;
      }
    }
    return null;
  }

  async get(id, opts = {}) {
    const found = await this._locate(id, opts);
    return found ? found.template : null;
  }

  // ─── Mutation ────────────────────────────────────────────────────────────

  _normaliseDocuments(documents) {
    if (!Array.isArray(documents)) return [];
    return documents
      .filter(d => d && typeof d.name === 'string' && d.name.trim())
      .map(d => ({
        name: d.name.trim().replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'document',
        prompt: typeof d.prompt === 'string' ? d.prompt : ''
      }));
  }

  async create({ spaceId, scope = 'space', userDir = null, folderPath = '', name, description, systemPrompt, documents }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new Error('name is required');
    }
    if (scope === 'personal' && !userDir) {
      throw new Error('userDir is required to create a personal template');
    }
    const space = await this._resolveSpace(spaceId);
    if (!space) {
      throw new Error('A valid spaceId is required — continuous exploration templates live in a space');
    }

    const dir = this._templatesDir(space, scope, userDir, folderPath);
    await fs.mkdir(dir, { recursive: true });

    const now = new Date().toISOString();
    const template = {
      id: crypto.randomUUID(),
      name: name.trim(),
      description: (description || '').trim(),
      systemPrompt: (systemPrompt || '').trim(),
      documents: this._normaliseDocuments(documents),
      createdAt: now,
      updatedAt: now
    };
    await fs.writeFile(path.join(dir, `${template.id}.json`), JSON.stringify(template, null, 2), 'utf8');

    template.spaceId = Number(space.id);
    template.spaceName = space.name || '';
    template.scope = scope;
    if (scope === 'personal') template.owner = userDir;
    if (scope === 'folder') template.folderPath = this._normaliseFolder(folderPath);
    return template;
  }

  async update(id, patch, opts = {}) {
    const found = await this._locate(id, opts);
    if (!found) return null;
    const { file, template } = found;

    const allowed = ['name', 'description', 'systemPrompt'];
    for (const key of allowed) {
      if (patch[key] !== undefined) template[key] = patch[key];
    }
    if (patch.documents !== undefined) {
      template.documents = this._normaliseDocuments(patch.documents);
    }
    template.updatedAt = new Date().toISOString();

    // spaceId/spaceName/scope/owner/folderPath/distance are derived stamps — they
    // describe where the file was FOUND, so persisting them would let a stale copy
    // contradict the directory the file actually sits in.
    const { spaceId, spaceName, scope, owner, folderPath, distance, canEdit, ...persisted } = template;
    await fs.writeFile(file, JSON.stringify(persisted, null, 2), 'utf8');
    return template;
  }

  async remove(id, opts = {}) {
    const found = await this._locate(id, opts);
    if (!found) return false;
    await fs.unlink(found.file);
    return true;
  }

  // ─── Seeding ─────────────────────────────────────────────────────────────

  /**
   * Seed the default org templates into a space the first time its template
   * folder is touched. Only fires when `.system/continuous-explorations/.templates/`
   * does not exist — a folder the user has emptied on purpose stays empty.
   */
  async seedIfMissing(spaceId, defaults) {
    const space = await this._resolveSpace(spaceId);
    if (!space) return [];

    try {
      await fs.access(this._templatesDir(space));
      return []; // folder exists — never re-seed
    } catch (_) { /* missing — seed below */ }

    const created = [];
    for (const def of defaults) {
      // Strip any fixed id from the defaults — per-space templates always get
      // fresh UUIDs so ids stay unique across spaces.
      const { id, ...rest } = def;
      created.push(await this.create({ ...rest, spaceId }));
    }
    this.log.info(`[continuous-exploration] seeded ${created.length} default templates into space "${space.name}"`);
    return created;
  }
}

module.exports = TemplateManager;
