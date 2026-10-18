/**
 * @fileoverview Filesystem utilities for the Product Design workflow.
 * Markdown writes go through common/content/wikiBlocks.js so they preserve
 * user-authored wiki blocks (annotations, comments, likes).
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const wikiBlocks = require('../../common/content/wikiBlocks.js');

/**
 * Normalise a filesystem PATH (not a single name segment) so values that arrive
 * with Windows-style separators or stray CR/LF — e.g. a `product_design_*folder`
 * value pasted from Windows or saved with CRLF line endings — don't create
 * literal-backslash / trailing-carriage-return folders on POSIX systems.
 *
 * NOTE: this is deliberately separate from {@link sanitizeFilename}, which
 * sanitises a single name segment (and would destroy real `/` separators).
 *
 * @param {string} p
 * @returns {string}
 */
function normalizePath(p) {
    return String(p == null ? '' : p)
        .replace(/[\r\n]+/g, '')   // strip stray CR/LF (e.g. CRLF .env values)
        .replace(/\\/g, '/')        // Windows-style separators -> POSIX
        .replace(/\/{2,}/g, '/')    // collapse duplicate slashes
        .trim();
}

/**
 * Write a JSON file, creating parent directories as needed.
 * @param {string} filename
 * @param {object} jsonData
 */
function writeJSONFile(filename, jsonData) {
    filename = normalizePath(filename);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, JSON.stringify(jsonData, null, 2));
}

/**
 * Read and parse a JSON file. Returns {} when the file is missing or invalid.
 * @param {string} filename
 * @returns {object}
 */
function readJSONFile(filename) {
    filename = normalizePath(filename);
    let json = {};
    try {
        json = JSON.parse(fs.readFileSync(filename, 'utf8'));
    } catch (error) {
        console.log('Error reading/parsing JSON ' + filename);
    }
    return json;
}

/**
 * Write a file. For markdown, carry over the user's existing wiki blocks
 * (annotations, comments, likes, links, document metadata) instead of
 * clobbering them — a no-op for brand-new files.
 * @param {string} filename
 * @param {string} content
 */
function writeFile(filename, content) {
    filename = normalizePath(filename);
    const ext = path.extname(filename).toLowerCase();
    if (ext === '.md' || ext === '.markdown') {
        wikiBlocks.writeMarkdownPreserving(filename, content);
        return;
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
}

/**
 * Delete a file when it exists. Used to remove content a build has superseded
 * (e.g. the consolidated `Features.md` replaced by a `Features/` folder), so the
 * wiki does not show both the old page and its replacement.
 * @param {string} filename
 * @returns {boolean} Whether a file was removed.
 */
function deleteFile(filename) {
    filename = normalizePath(filename);
    if (!fs.existsSync(filename)) {
        return false;
    }
    fs.unlinkSync(filename);
    return true;
}

/**
 * Create a folder (recursive).
 * @param {string} foldername
 */
function createFolder(foldername) {
    fs.mkdirSync(normalizePath(foldername), { recursive: true });
}

/**
 * Test if a file exists.
 * @param {string} filename
 * @returns {boolean}
 */
function fileExists(filename) {
    return fs.existsSync(normalizePath(filename));
}

/**
 * Sanitise a string for use as a file/folder name.
 *
 * Windows silently drops trailing dots and spaces from folder names, so an entity
 * whose name ends with a "." (e.g. an epic "Rex Trails.") would otherwise create a
 * folder whose real on-disk name no longer matches the name the wiki navigates to
 * (both are built from this function). Trailing dots/spaces are therefore stripped
 * so the name is valid and stable across platforms.
 *
 * @param {string} filename
 * @returns {string}
 */
function sanitizeFilename(filename) {
    return String(filename == null ? '' : filename)
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/(\r\n|\n|\r)/gm, '')
        .replace(/ {2,}/g, ' ')
        .trim()
        .replace(/[.\s]+$/, '');
}

// The folder status colours understood by the wiki navigation (status -> accent).
// Mirrors backend/src/wiki/utils/folderTypes.js. Anything else means "no accent".
const FOLDER_STATUSES = new Set(['success', 'danger', 'warning', 'light']);

/**
 * Set (or clear) a child folder's navigation status colour. A folder's colour is
 * recorded in its PARENT's `.settings/file-types.json`, keyed by the child folder
 * name — mirroring backend/src/wiki/utils/folderTypes.js, the format the wiki app
 * reads. A null / non-whitelisted status removes the entry (rather than leaving a
 * stale colour), so a re-run reflects the entity's current state. Other children's
 * entries in the same file are preserved.
 *
 * @param {string} parentFolder - Absolute/relative path of the folder that
 *   CONTAINS the child (where the .settings live).
 * @param {string} childName - The child folder's on-disk name.
 * @param {string|null} status - 'success' | 'danger' | 'warning' | 'light', or
 *   anything else to clear.
 */
function setFolderStatus(parentFolder, childName, status) {
    const settingsFile = `${normalizePath(parentFolder)}/.settings/file-types.json`;
    const existing = fileExists(settingsFile) ? readJSONFile(settingsFile) : {};
    const types = existing && typeof existing.types === 'object' && existing.types ? existing.types : {};

    if (FOLDER_STATUSES.has(status)) {
        types[childName] = status;
    } else {
        delete types[childName];
    }

    writeJSONFile(settingsFile, { types });
}

/**
 * Write a folder's child display order to its `.settings/file-order.json`, the
 * format the wiki navigation reads (see backend/src/wiki/utils/fileOrder.js):
 * `{ "order": ["Child A", "Child B", ...] }`. Listed names appear first in this
 * order; any child not listed sorts after them (default-sorted). Names must match
 * the on-disk child folder/file names.
 *
 * @param {string} folder - The folder whose children are being ordered (where the
 *   .settings live).
 * @param {string[]} names - Ordered child names.
 */
function setFileOrder(folder, names) {
    const orderFile = `${normalizePath(folder)}/.settings/file-order.json`;
    writeJSONFile(orderFile, { order: Array.isArray(names) ? names : [] });
}

module.exports = {
    normalizePath,
    writeJSONFile,
    readJSONFile,
    writeFile,
    deleteFile,
    createFolder,
    fileExists,
    sanitizeFilename,
    setFolderStatus,
    setFileOrder,
};
