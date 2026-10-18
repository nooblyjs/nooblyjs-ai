/**
 * @fileoverview Single source of truth for the global site-content files.
 *
 * The headline banner, help document and "What's New" announcement are all
 * global, admin-maintained, app-level content — not per-space, not per-folder
 * and nothing to do with the per-document `.system/` sidecar layout described
 * in CLAUDE.md. They now live together in a plain, visible folder:
 *
 *   <APP_BASE_DIR>/content/headline.txt
 *   <APP_BASE_DIR>/content/help.md
 *   <APP_BASE_DIR>/content/whatsnew.md
 *
 * Previously each sat in its own hidden folder under the app base dir
 * (`.system/.headline/`, `.system/.help/`, `.system/.whatsnew/`), which made
 * them awkward to find, back up or edit outside the app, and overloaded
 * `.system/` — a name that everywhere else means "generated sidecars for the
 * documents in this folder".
 *
 * LEGACY: the old locations are still READ as a fallback (never written), so an
 * un-migrated install keeps working and the first admin save relocates the file
 * naturally. Relocate them explicitly with
 * `scripts/migrate-system-content-to-content.js`.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fsp = require('node:fs').promises;

/** Folder name under APP_BASE_DIR holding all global site content. */
const CONTENT_DIR_NAME = 'content';

/**
 * Canonical file name per content kind, plus the pre-2026-07-22 hidden folder
 * it used to live in.
 */
const CONTENT_KINDS = {
  headline: { file: 'headline.txt', legacyDir: ['.system', '.headline'] },
  help: { file: 'help.md', legacyDir: ['.system', '.help'] },
  whatsnew: { file: 'whatsnew.md', legacyDir: ['.system', '.whatsnew'] }
};

/**
 * @param {string} appBaseDir
 * @returns {string} the content directory
 */
function contentDir(appBaseDir) {
  return path.join(appBaseDir, CONTENT_DIR_NAME);
}

/**
 * Canonical path for a content kind — the only path ever written to.
 * @param {string} appBaseDir
 * @param {'headline'|'help'|'whatsnew'} kind
 * @returns {string}
 */
function contentPath(appBaseDir, kind) {
  const spec = CONTENT_KINDS[kind];
  if (!spec) throw new Error(`Unknown content kind "${kind}"`);
  return path.join(contentDir(appBaseDir), spec.file);
}

/**
 * Legacy (pre-relocation) path for a content kind. Read-only fallback.
 * @param {string} appBaseDir
 * @param {'headline'|'help'|'whatsnew'} kind
 * @returns {string}
 */
function legacyContentPath(appBaseDir, kind) {
  const spec = CONTENT_KINDS[kind];
  if (!spec) throw new Error(`Unknown content kind "${kind}"`);
  return path.join(appBaseDir, ...spec.legacyDir, spec.file);
}

/**
 * Read a content file: canonical location first, then the legacy location.
 *
 * @param {string} appBaseDir
 * @param {'headline'|'help'|'whatsnew'} kind
 * @returns {Promise<{content: string|null, from: 'content'|'legacy'|null}>}
 *   `content` is null when neither location exists — the caller decides whether
 *   that means "empty" (headline, whatsnew) or "seed a default" (help).
 */
async function readContent(appBaseDir, kind) {
  try {
    return { content: await fsp.readFile(contentPath(appBaseDir, kind), 'utf8'), from: 'content' };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  try {
    return { content: await fsp.readFile(legacyContentPath(appBaseDir, kind), 'utf8'), from: 'legacy' };
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  return { content: null, from: null };
}

/**
 * Write a content file to the canonical location, creating the folder.
 * The legacy copy (if any) is deliberately left alone — the migration script
 * owns removing it.
 *
 * @param {string} appBaseDir
 * @param {'headline'|'help'|'whatsnew'} kind
 * @param {string} content
 * @returns {Promise<string>} the path written
 */
async function writeContent(appBaseDir, kind, content) {
  const target = contentPath(appBaseDir, kind);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, 'utf8');
  return target;
}

module.exports = {
  CONTENT_DIR_NAME,
  CONTENT_KINDS,
  contentDir,
  contentPath,
  legacyContentPath,
  readContent,
  writeContent
};
