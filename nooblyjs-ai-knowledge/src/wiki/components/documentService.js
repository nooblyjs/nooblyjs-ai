/**
 * @fileoverview Document Service for the Wiki.
 *
 * The single source of truth for "what documents exist" is the filesystem,
 * accessed through each space's configured filing service. This service derives
 * document metadata live from disk — there is NO documents.json index to drift
 * out of sync. It is a thin shaping layer over FilingServiceWrapper.buildFileTree
 * (which already lists recursively, skips dotfiles, and returns size/created/
 * modified per entry).
 *
 * Metadata mapping (disk → document):
 *   path/name/size/created/modified  ← filing service (fs.stat)
 *   title                            ← file name
 *   mimeType                         ← file extension
 *   id                               ← the path (stable, unique within a space)
 *
 * Excerpts and tags are intentionally NOT carried here: excerpts are generated
 * on demand by the search indexer from file content, and free-form tags were
 * removed when documents.json was retired.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const { compileVisibility } = require('../../shared/spaces/spaceVisibility');
const { contentRootKey } = require('../../shared/spaces/contentRoot');

// mime-types is already a dependency (used by documentRoutes). Guard the require
// so the service degrades gracefully rather than failing to load.
let mimeLookup;
try {
  // eslint-disable-next-line global-require
  mimeLookup = require('mime-types').lookup;
} catch {
  mimeLookup = () => false;
}

class DocumentService {
  /**
   * @param {Object} deps
   * @param {Object} deps.dataManager        Reads the spaces registry.
   * @param {Object} deps.filingServiceWrapper Per-space, disk-backed file access.
   * @param {Object} [deps.logger]
   */
  constructor({ dataManager, filingServiceWrapper, logger } = {}) {
    this.dataManager = dataManager;
    this.filingServiceWrapper = filingServiceWrapper;
    this.logger = logger || console;
  }

  /** Map a filing-tree file node to a document descriptor. */
  _toDocument(node, space) {
    return {
      // The path is the document's stable identity now that numeric ids are gone.
      id: node.path,
      path: node.path,
      name: node.name,
      title: node.title || node.name,
      spaceId: space.id,
      spaceName: space.name,
      size: node.size,
      mimeType: mimeLookup(node.name) || 'application/octet-stream',
      createdAt: node.created,
      modifiedAt: node.modified,
      isSymbolicLink: node.isSymbolicLink === true,
      type: 'document'
    };
  }

  /** Flatten a filing tree (folders + files) into a flat document list. */
  _flatten(tree, space, acc) {
    for (const node of tree) {
      if (node.type === 'folder') {
        if (Array.isArray(node.children)) this._flatten(node.children, space, acc);
      } else {
        acc.push(this._toDocument(node, space));
      }
    }
    return acc;
  }

  /**
   * The content root a space's documents live under, normalised for comparison.
   *
   * Two spaces MAY point at the same root and show different slices of it — the
   * Retail and Engineering spaces both sit on `knowledge-content/engineering`.
   * A space with no configured root gets a value unique to itself, so it never
   * accidentally shares a walk with another.
   *
   * @param {Object} space
   * @return {string}
   */
  _contentRoot(space) {
    // Delegates to shared/spaces/contentRoot.js — the search route and the
    // indexer group by the same key, and a private copy that drifts from
    // either of them fails silently (see that module's header).
    return contentRootKey(space);
  }

  /**
   * Walk one content root ONCE and append the documents each space on it can
   * see. This is the choke point for the whole listing family — listAll,
   * listBySpace(Id), countBySpaceId, get() and the search fallback all come
   * through here.
   *
   * Two costs are avoided:
   *
   *   1. The walk is shared. Engineering and Retail are the same ~6,000
   *      directories; walking per space did it twice for one identical tree.
   *      The result is safe to share because a document descriptor is stamped
   *      from the SPACE (`_toDocument` reads space.id/space.name, never the
   *      node's), and `filing.list()` output is a pure function of the
   *      directory — the per-space filing config that differs (maxFileSize,
   *      allowedExtensions) governs writes, not listings.
   *   2. Curated spaces prune AS they walk. `filterTree` still runs per space
   *      and remains the authority on what is visible; `shouldDescend` only
   *      stops the walk entering directories NO space in the group could use.
   *      It is the union, so it can never hide something one member needs — and
   *      with an unrestricted space present it is skipped entirely and the walk
   *      is exhaustive, as before.
   *
   * @param {Object[]} group Spaces sharing one content root (non-empty).
   * @param {Object[]} acc   Accumulator, appended in place.
   * @returns {Promise<void>}
   * @private
   */
  async _collectGroup(group, acc) {
    const members = group.map(space => ({ space, visibility: compileVisibility(space) }));

    // An unrestricted member sees everything, so there is nothing to prune.
    const restrictedOnly = members.every(m => m.visibility.restricted);
    const options = restrictedOnly
      ? { shouldDescend: (folderPath) => members.some(m => m.visibility.isFolderAccessible(folderPath)) }
      : {};

    let tree;
    try {
      tree = await this.filingServiceWrapper.buildFileTree(group[0].name, '', options);
    } catch (error) {
      this.logger.warn(`[DocumentService] Failed to list documents for space "${group[0].name}": ${error.message}`);
      return;
    }

    for (const { space, visibility } of members) {
      this._flatten(visibility.filterTree(tree), space, acc);
    }
  }

  /**
   * List every document in a space, derived live from disk.
   * @param {Object} space A space record (must have id + name).
   * @returns {Promise<Array>}
   */
  async listBySpace(space) {
    if (!space || !this.filingServiceWrapper) return [];
    const documents = [];
    await this._collectGroup([space], documents);
    return documents;
  }

  /** List documents for a space by id. */
  async listBySpaceId(spaceId) {
    const spaces = await this.dataManager.read('spaces');
    const space = (spaces || []).find(s => s.id === Number(spaceId) || s.id === spaceId);
    return this.listBySpace(space);
  }

  /**
   * List every document across every space.
   *
   * Grouped by content root so a root shared by several spaces is walked once.
   * The returned order therefore follows the ROOTS, not the spaces array — no
   * caller depends on that ordering (they filter by spaceId or sort by date),
   * and documents are still contiguous per space within a group.
   *
   * @returns {Promise<Array>}
   */
  async listAll() {
    const spaces = (await this.dataManager.read('spaces')) || [];

    const groups = new Map();
    for (const space of spaces) {
      const root = this._contentRoot(space);
      const group = groups.get(root);
      if (group) group.push(space);
      else groups.set(root, [space]);
    }

    const all = [];
    for (const group of groups.values()) {
      // eslint-disable-next-line no-await-in-loop
      await this._collectGroup(group, all);
    }
    return all;
  }

  /** Count documents in a space (used for dashboard / space stats). */
  async countBySpaceId(spaceId) {
    return (await this.listBySpaceId(spaceId)).length;
  }

  /**
   * Resolve a single document descriptor by space id + path.
   * @returns {Promise<Object|null>}
   */
  async get(spaceId, docPath) {
    const docs = await this.listBySpaceId(spaceId);
    const norm = String(docPath).replace(/^\/+/, '');
    return docs.find(d => d.path === docPath || d.path === norm) || null;
  }
}

module.exports = DocumentService;
