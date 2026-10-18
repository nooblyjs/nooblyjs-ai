/**
 * @fileoverview Resolve a space-relative path to a file on disk — the ONE place
 * that turns "space name + path" into an absolute path a handler may touch.
 *
 * Two guards, and both have to run every time:
 *
 *   1. TRAVERSAL — the resolved path must stay inside the space's content root.
 *   2. VISIBILITY — the space must actually EXPOSE that path. Several spaces sit
 *      on one content root and each shows a curated slice of it
 *      (allowedPaths / excludedPaths, see spaceVisibility.js), so "inside the
 *      root" and "this space may see it" stopped being the same question.
 *
 * WHY THIS MODULE EXISTS. Guard 1 was everywhere; guard 2 was opt-in, and three
 * separate hand-rolled copies of this resolution (documentRoutes,
 * annotationRoutes, commentsRoutes) never opted in. The annotation and comment
 * endpoints would therefore read a document from a subtree the caller's space
 * hides, return its FULL CONTENT in the response, and write a modified copy
 * back. Document creation had the same hole in the other direction — a curated
 * space could create files anywhere in the shared root.
 *
 * So visibility here is DEFAULT ON. A caller that genuinely needs to reach a
 * hidden path passes `enforceVisibility: false` and says why at the call site.
 * That inversion is the actual fix: the failure mode of the old design was that
 * forgetting a flag silently removed an access boundary, and a new endpoint
 * written next year would forget it the same way.
 *
 * A hidden path throws PATH_HIDDEN, which callers map to **404, never 403**:
 * telling the caller they are not allowed confirms the document exists, which is
 * exactly what a curated space is hiding.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-06
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const { compileVisibility } = require('./spaceVisibility');

/** Error code thrown when a path exists but the space does not expose it. */
const PATH_HIDDEN = 'PATH_HIDDEN';

/** Read spaces.json directly — the same source every route already trusts. */
async function readSpaces(appBaseDir) {
  const spacesPath = path.join(
    appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
  const raw = await fs.readFile(spacesPath, 'utf8');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Content directory for a space record, with the legacy per-name fallback
 * (`<repo>/documents/<SpaceName>`) for spaces that predate `configuration.filing`.
 *
 * Note the legacy branch folds the space name INTO the content dir rather than
 * leaving it as a leading path segment. That is deliberate: it makes the
 * space-relative path this module derives genuinely space-relative in both
 * branches, so a visibility rule written as `Standards` matches the same thing
 * either way. The old inline copies resolved against the bare documents dir and so
 * produced `SpaceName/Standards/...`, which no rule would ever have matched.
 *
 * @param {Object} space
 * @param {string} [spaceName] - used only by the legacy fallback
 * @returns {string}
 */
function contentDirOf(space, spaceName) {
  if (space && (space.path || space.configuration?.filing?.baseDir)) {
    return space.path || space.configuration.filing.baseDir;
  }
  return path.resolve(__dirname, '../../../documents', spaceName || (space && space.name) || '');
}

/**
 * Build a PATH_HIDDEN error.
 * @param {string} relativePath
 * @returns {Error}
 */
function hiddenError(relativePath) {
  const error = new Error('Not found');
  error.code = PATH_HIDDEN;
  error.relativePath = relativePath;
  return error;
}

/**
 * Decide whether `space` exposes `relativePath`.
 *
 * `kind` matters because the rules genuinely differ: a FILE is judged on the
 * folder that owns it (so root-level files and `.system` plumbing pass), while a
 * FOLDER is judged on itself — except when it only needs to be *listable*, where
 * a pass-through ancestor of an allowed subtree must survive or the nav could
 * show a folder it then refuses to open.
 *
 * @param {Object} space
 * @param {string} relativePath - space-relative, either separator
 * @param {'file'|'folder'|'container'} [kind='file']
 * @returns {boolean}
 */
function isPathVisible(space, relativePath, kind = 'file') {
  const visibility = compileVisibility(space);
  if (!visibility.restricted) return true;
  if (kind === 'folder') return visibility.isFolderVisible(relativePath);
  if (kind === 'container') return visibility.isFolderAccessible(relativePath);
  return visibility.isFileVisible(relativePath);
}

/**
 * Resolve a space-relative path, applying both guards.
 *
 * @param {Object} params
 * @param {string} params.spaceName
 * @param {string} params.documentPath - space-relative, or a legacy absolute path
 * @param {string} params.appBaseDir
 * @param {Array}  [params.spaces] - pre-loaded spaces.json, to skip the read
 * @param {boolean} [params.enforceVisibility=true] - pass false ONLY with a
 *   reason at the call site; see the file header
 * @param {'file'|'folder'|'container'} [params.kind='file']
 * @returns {Promise<{space: Object, documentsDir: string, absolutePath: string, relativePath: string}>}
 * @throws {Error} 'Space not found' | 'Access denied: path outside space directory'
 *   | PATH_HIDDEN
 */
async function resolveSpacePath({
  spaceName,
  documentPath,
  appBaseDir,
  spaces = null,
  enforceVisibility = true,
  kind = 'file'
}) {
  const list = spaces || await readSpaces(appBaseDir);
  const space = list.find(s => s.name === spaceName);
  if (!space) throw new Error('Space not found');

  const documentsDir = contentDirOf(space, spaceName);
  const absolutePath = path.isAbsolute(documentPath)
    ? documentPath
    : path.resolve(documentsDir, documentPath || '');

  const normalizedAbsolutePath = path.normalize(absolutePath);
  const normalizedDocumentsDir = path.normalize(documentsDir);

  const relativePath = path.relative(normalizedDocumentsDir, normalizedAbsolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Access denied: path outside space directory');
  }

  if (enforceVisibility && !isPathVisible(space, relativePath, kind)) {
    throw hiddenError(relativePath);
  }

  return {
    space,
    documentsDir: normalizedDocumentsDir,
    absolutePath: normalizedAbsolutePath,
    relativePath
  };
}

/**
 * Map a resolution failure onto an Express response. Returns true when handled,
 * so the caller can `if (handleSpacePathError(res, err)) return;`.
 *
 * A hidden path answers 404 with no detail — see the file header.
 *
 * @param {Object} res
 * @param {Error} error
 * @returns {boolean}
 */
function handleSpacePathError(res, error) {
  if (!error) return false;
  if (error.code === PATH_HIDDEN) {
    res.status(404).json({ success: false, error: 'Not found' });
    return true;
  }
  if (error.message === 'Space not found') {
    res.status(404).json({ success: false, error: 'Space not found' });
    return true;
  }
  if (/outside space directory/.test(error.message || '')) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return true;
  }
  return false;
}

module.exports = {
  PATH_HIDDEN,
  readSpaces,
  contentDirOf,
  isPathVisible,
  resolveSpacePath,
  handleSpacePathError,
  hiddenError
};
