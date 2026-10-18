/**
 * @fileoverview Disk-backed file source for the context build — the only source
 * the step uses.
 *
 * ContextProcessor needs just two reads from its source: the folder tree and a
 * document's text. This source satisfies both straight off disk, rooted at a
 * folder path — so a build can run with no backend, no `spaces.json` and no
 * space id/name. It replaced the retired `WikiApiClient`, which served the same
 * two calls over the backend's wiki HTTP API and warmed the live caches as a
 * side effect; that self-call cannot work in production (HTTPS + Entra on :443).
 * The trade-off is that disk reads do NOT warm the wiki caches — the next real
 * user request repopulates them.
 *
 * The source interface (the only members ContextProcessor + the step call):
 * authenticate(), getFolderTree(), readDocument(spaceName, relPath).
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

class DiskFileSource {

  /**
   * @param {Object} options
   * @param {string} options.root - Absolute folder to walk/read (the content root).
   * @param {Object} [options.logger=console]
   */
  constructor(options = {}) {
    this.root = options.root;
    this.logger = options.logger || console;
    if (!this.root) throw new Error('DiskFileSource: "root" is required');
  }

  /** No-op: disk reads need no auth (kept for parity with the source interface). */
  async authenticate() { /* nothing to do */ }

  /**
   * Build the recursive {folder|document} tree from disk, rooted at `this.root`.
   * Paths are relative to the root (forward-slashed) — exactly what
   * ContextProcessor feeds back into readDocument(). Dot-entries (.context, .git,
   * …) are skipped, mirroring ContextProcessor's own folder filtering.
   *
   * @param {*} [_spaceId] - Ignored (parity with the source interface).
   * @returns {Promise<Array<Object>>}
   */
  async getFolderTree(_spaceId) {
    return this._buildTree(this.root, '', new Set());
  }

  /**
   * @private Recursively read a directory into tree nodes.
   * Uses statSync (which FOLLOWS symlinks) rather than the Dirent flags, because
   * content folders are often symlinks to the real store — Dirent.isDirectory()
   * reports false for a symlinked dir, which would silently drop them. `seen`
   * tracks resolved real paths to guard against symlink cycles.
   */
  _buildTree(absDir, relDir, seen) {
    let real;
    try { real = fs.realpathSync(absDir); } catch (_) { return []; } // broken link
    if (seen.has(real)) return []; // symlink cycle
    seen.add(real);

    const nodes = [];
    for (const name of fs.readdirSync(absDir)) {
      if (name.startsWith('.')) continue; // skip .context, .git, …
      const full = path.join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      let stat;
      try { stat = fs.statSync(full); } catch (_) { continue; } // skip broken links
      if (stat.isDirectory()) {
        nodes.push({ type: 'folder', name, path: rel, children: this._buildTree(full, rel, seen) });
      } else if (stat.isFile()) {
        // `modified` (mtime in ms) lets ContextProcessor reuse an up-to-date
        // sidecar instead of re-summarising. The wiki-API source omits it.
        nodes.push({ type: 'document', name, path: rel, modified: stat.mtimeMs });
      }
    }
    return nodes;
  }

  /**
   * Read a document's text from disk. Returns null when the file is missing or
   * unreadable ("not found -> null" is the contract ContextProcessor expects).
   *
   * @param {*} _spaceName - Ignored (parity with the source interface).
   * @param {string} relPath - Path relative to the content root.
   * @returns {Promise<string|null>}
   */
  async readDocument(_spaceName, relPath) {
    try {
      return fs.readFileSync(path.join(this.root, relPath), 'utf8');
    } catch (err) {
      this.logger.warn && this.logger.warn(`DiskFileSource: cannot read ${relPath}: ${err.message}`);
      return null;
    }
  }
}

module.exports = DiskFileSource;
