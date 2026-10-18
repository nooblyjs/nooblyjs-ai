/**
 * @fileoverview Folder-local artifact cleanup for a document that has been deleted.
 *
 * Every per-document artifact lives in `<the document's own folder>/.system/`
 * (see `shared/utils/filePolicy.js`, the single source of truth for the layout):
 *
 *   - `.system/derived/<name>.<ext>.md`  the markdown extracted from a binary — the
 *                                        ONLY thing that carries a PDF's text into search;
 *   - `.system/originals/<name>.<ext>`   the untouched office source behind a converted,
 *                                        visible `<name>.md` page;
 *   - `.system/context/<name>[.md]`      the AI context sidecar read by chat grounding
 *                                        and the Context Manager;
 *   - `.system/home-seed.json`           for a `.home.md` only: the marker saying the
 *                                        context build seeded that page.
 *
 * Deleting the document removes none of them, and nothing else ever revisits them:
 * `.system` is in the file watcher's IGNORED_SEGMENT, and the context build only ever
 * writes. Left behind they are not merely clutter:
 *
 *   - a stale derived sidecar keeps answering content searches for a document that no
 *     longer exists — the indexer keys the entry under the ORIGINAL's path, so the hit
 *     opens a 404;
 *   - a stale context sidecar keeps feeding chat grounding a summary of deleted content,
 *     and the next folder roll-up folds that summary straight back in.
 *
 * This module is the single place that maps a deleted document to every artifact it
 * owned and removes them. Best-effort by contract: a missing artifact is the normal
 * case (most documents own none), never an error.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

const {
  DERIVED_DIR,
  ORIGINALS_DIR,
  CONTEXT_DIR,
  toDerivedRelPath,
  toOriginalsRelPath,
  toContextRelPath,
  toHomeSeedRelPath,
  isSeededHomeRelPath,
  originalCandidatesForMarkdown
} = require('../../shared/utils/filePolicy');

/**
 * Split a space-relative path into its owning folder and file name, POSIX-normalised.
 * @param {string} relativePath
 * @return {{dir: string, name: string}} dir is '' for a space-root document.
 * @private
 */
function splitRel(relativePath) {
  const norm = String(relativePath).replace(/\\/g, '/').replace(/^\/+/, '');
  const slash = norm.lastIndexOf('/');
  return slash === -1
    ? { dir: '', name: norm }
    : { dir: norm.slice(0, slash), name: norm.slice(slash + 1) };
}

/**
 * Every artifact path a document could own, space-relative.
 *
 * The originals entries are two distinct cases and both are probed:
 *   - `toOriginalsRelPath` — a stored source that kept the deleted document's own name;
 *   - `originalCandidatesForMarkdown` — the office source behind a converted `.md` page,
 *     whose extension is not recoverable from the page path, so every office extension
 *     is a candidate (at most one exists).
 *
 * @param {string} relativePath - Space-relative path of the deleted document.
 * @return {string[]} De-duplicated, space-relative artifact paths.
 */
function artifactRelPathsFor(relativePath) {
  const rels = new Set([
    toDerivedRelPath(relativePath),
    toContextRelPath(relativePath),
    toOriginalsRelPath(relativePath)
  ]);
  for (const candidate of originalCandidatesForMarkdown(relativePath)) {
    rels.add(candidate);
  }
  // A seeded `.home.md` also owns the provenance marker that says the context build
  // wrote it. A left-behind marker is harmless — its hash matches no file, so the
  // build reads "not ours" and stays conservative — but it is exactly the kind of
  // stale bookkeeping this module exists to clear.
  if (isSeededHomeRelPath(relativePath)) {
    rels.add(toHomeSeedRelPath(splitRel(relativePath).dir));
  }
  return [...rels];
}

/**
 * @param {string} absPath
 * @return {Promise<boolean>} True when a file was removed; false when it was absent.
 * @private
 */
async function unlinkIfPresent(absPath) {
  try {
    await fs.unlink(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a folder's artifact directories once they hold nothing. `rmdir` fails with
 * ENOTEMPTY on a directory that still has entries, which is exactly the guard we want
 * — so this can be called unconditionally.
 *
 * The enclosing `.system` is deliberately left in place: at the space root it also
 * holds the space-scoped `templates/` and `useractivity/`, and an empty directory
 * costs nothing.
 *
 * @param {string} spaceRoot - Absolute space content root.
 * @param {string} dir - Space-relative owning folder ('' for the space root).
 * @return {Promise<void>}
 * @private
 */
async function pruneEmptyArtifactDirs(spaceRoot, dir) {
  for (const artifactDir of [DERIVED_DIR, ORIGINALS_DIR, CONTEXT_DIR]) {
    const abs = dir
      ? path.join(spaceRoot, dir, artifactDir)
      : path.join(spaceRoot, artifactDir);
    try {
      await fs.rmdir(abs);
    } catch {
      // Not empty, or never existed — both are the normal case.
    }
  }
}

/**
 * Remove every folder-local artifact belonging to a deleted document.
 *
 * @param {string} spaceRoot - Absolute space content root.
 * @param {string} relativePath - Space-relative path of the document that was deleted.
 * @param {Object} [options]
 * @param {Object} [options.log] - Logger; debug/warn only.
 * @return {Promise<{removed: string[]}>} Space-relative paths actually removed.
 */
async function removeDocumentArtifacts(spaceRoot, relativePath, options = {}) {
  const { log = null } = options;
  const removed = [];

  if (!spaceRoot || !relativePath) return { removed };

  for (const rel of artifactRelPathsFor(relativePath)) {
    try {
      if (await unlinkIfPresent(path.join(spaceRoot, rel))) {
        removed.push(rel);
      }
    } catch (error) {
      log?.debug?.(`[DocumentArtifacts] Could not remove ${rel}: ${error.message}`);
    }
  }

  if (removed.length) {
    await pruneEmptyArtifactDirs(spaceRoot, splitRel(relativePath).dir);
  }

  return { removed };
}

module.exports = {
  artifactRelPathsFor,
  removeDocumentArtifacts
};
