/**
 * @fileoverview Derived markdown sidecar management — the single place that decides
 * whether a binary document's `.system/derived/<name>.<ext>.md` needs (re)writing,
 * and produces it.
 *
 * The PDF case is the one that matters most. `filePolicy` gives a PDF
 * `{ view: 'original', download: 'original', search: 'markdown' }`: the PDF itself
 * stays the document the wiki shows, links to and downloads, while the sidecar is
 * the ONLY thing that carries its text into the search index. With no sidecar a PDF
 * is findable by file NAME alone — which looks like a working search right up until
 * someone searches for a phrase that lives inside the document.
 *
 * Sidecars used to be written from exactly one place: the file watcher, on add and
 * change. The watcher runs with `ignoreInitial: true`, so a file that was already
 * on disk when the backend started never raises an event — a corpus copied in while
 * the server was down, restored from a backup, bulk-uploaded before this feature
 * existed, or pulled into a folder that symlinks a separate git repo has no sidecars
 * and nothing that would ever create them. Sharing this module between the watcher
 * (event-driven) and the search indexer (repair-on-index) means both routes converge
 * on the same file with the same naming.
 *
 * The sidecar is derived data: it is always safe to delete and regenerate, and it is
 * never the download source — the original is untouched throughout.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

const { needsMarkdownSidecar, toDerivedRelPath } = require('../../shared/utils/filePolicy');
const { convertToMarkdown, canConvert } = require('../../shared/processors/documentConverter');

/**
 * Slack allowed between a source's mtime and its sidecar's before the sidecar is
 * judged stale. The two are written moments apart and filesystem timestamp
 * granularity varies (FAT/SMB round to 2s), so a tight comparison would report
 * a freshly written sidecar as stale and re-convert it on every index pass.
 */
const STALE_TOLERANCE_MS = 2000;

/**
 * Outcome of inspecting or ensuring a sidecar.
 * @enum {string}
 */
const SidecarStatus = Object.freeze({
  /** The file's policy needs no sidecar (markdown, text, code, images…). */
  NOT_APPLICABLE: 'not-applicable',
  /** Policy wants a sidecar but no Node-side converter exists (e.g. .pptx). */
  UNSUPPORTED: 'unsupported',
  /** Sidecar absent — the document would index by file name only. */
  MISSING: 'missing',
  /** Sidecar exists but predates its source — the indexed text is out of date. */
  STALE: 'stale',
  /** Sidecar exists and is at least as new as its source. */
  CURRENT: 'current',
  /** Sidecar was written by this call. */
  WRITTEN: 'written',
  /** Conversion was attempted and failed (corrupt file, unreadable source…). */
  FAILED: 'failed'
});

/**
 * Resolve a space's content root the same way every other wiki component does.
 * @param {Object} space - Space record.
 * @return {string|null} Absolute path, or null when the space configures none.
 */
function spaceRootOf(space) {
  if (!space) return null;
  return space.path || space.configuration?.filing?.baseDir || null;
}

/**
 * @param {string} absPath
 * @return {Promise<import('node:fs').Stats|null>} null when the path does not exist.
 * @private
 */
async function statOrNull(absPath) {
  try {
    return await fs.stat(absPath);
  } catch {
    return null;
  }
}

/**
 * Absolute path of the derived sidecar belonging to a space-relative document.
 * @param {string} spaceRoot - Absolute space content root.
 * @param {string} relativePath - Space-relative path of the ORIGINAL document.
 * @return {string}
 */
function sidecarPathFor(spaceRoot, relativePath) {
  return path.join(spaceRoot, toDerivedRelPath(relativePath));
}

/**
 * Report whether a document's derived sidecar is missing, stale or current —
 * without converting anything. Cheap (one stat per side), so it is safe to call
 * for every file in an index pass.
 *
 * @param {string} spaceRoot - Absolute space content root.
 * @param {string} relativePath - Space-relative path of the original document.
 * @return {Promise<string>} A {@link SidecarStatus} value.
 */
async function sidecarStatus(spaceRoot, relativePath) {
  if (!needsMarkdownSidecar(relativePath)) return SidecarStatus.NOT_APPLICABLE;
  if (!canConvert(relativePath)) return SidecarStatus.UNSUPPORTED;

  const sourceAbs = path.join(spaceRoot, relativePath);
  const sidecarAbs = sidecarPathFor(spaceRoot, relativePath);

  const sidecarStat = await statOrNull(sidecarAbs);
  if (!sidecarStat) return SidecarStatus.MISSING;

  const sourceStat = await statOrNull(sourceAbs);
  // No source to compare against (deleted, or a path we can't stat): treat the
  // sidecar we do have as current rather than churning on it.
  if (!sourceStat) return SidecarStatus.CURRENT;

  return sourceStat.mtimeMs > sidecarStat.mtimeMs + STALE_TOLERANCE_MS
    ? SidecarStatus.STALE
    : SidecarStatus.CURRENT;
}

/**
 * Write the derived sidecar for a document when it is missing or stale.
 *
 * Best-effort by contract: a conversion failure (corrupt PDF, password-protected
 * office file) resolves to {@link SidecarStatus.FAILED} rather than throwing, so a
 * single bad document can never abort a watcher event or an index build. The
 * original is never touched.
 *
 * @param {string} spaceRoot - Absolute space content root.
 * @param {string} relativePath - Space-relative path of the original document.
 * @param {Object} [options]
 * @param {boolean} [options.force=false] - Rewrite even when the sidecar is current.
 * @param {Object} [options.log] - Logger; warnings only.
 * @return {Promise<{status: string, written: boolean, path: string, error?: string}>}
 */
async function ensureSidecar(spaceRoot, relativePath, options = {}) {
  const { force = false, log = null } = options;
  const sidecarAbs = sidecarPathFor(spaceRoot, relativePath);

  const status = await sidecarStatus(spaceRoot, relativePath);
  if (status === SidecarStatus.NOT_APPLICABLE || status === SidecarStatus.UNSUPPORTED) {
    return { status, written: false, path: sidecarAbs };
  }
  if (status === SidecarStatus.CURRENT && !force) {
    return { status, written: false, path: sidecarAbs };
  }

  try {
    const markdown = await convertToMarkdown(path.join(spaceRoot, relativePath));
    await fs.mkdir(path.dirname(sidecarAbs), { recursive: true });
    await fs.writeFile(sidecarAbs, markdown, 'utf8');
    return { status: SidecarStatus.WRITTEN, written: true, path: sidecarAbs };
  } catch (error) {
    log?.warn?.(`[DerivedSidecar] Could not derive markdown for ${relativePath}: ${error.message}`);
    return { status: SidecarStatus.FAILED, written: false, path: sidecarAbs, error: error.message };
  }
}

/**
 * Delete a document's sidecar. Called when the original goes away, so the derived
 * text stops answering searches for a document that no longer exists. A sidecar
 * that was never there is not an error.
 *
 * @param {string} spaceRoot - Absolute space content root.
 * @param {string} relativePath - Space-relative path of the original document.
 * @return {Promise<boolean>} True when a sidecar was removed.
 */
async function removeSidecar(spaceRoot, relativePath) {
  const sidecarAbs = sidecarPathFor(spaceRoot, relativePath);
  try {
    await fs.unlink(sidecarAbs);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  SidecarStatus,
  STALE_TOLERANCE_MS,
  spaceRootOf,
  sidecarPathFor,
  sidecarStatus,
  ensureSidecar,
  removeSidecar
};
