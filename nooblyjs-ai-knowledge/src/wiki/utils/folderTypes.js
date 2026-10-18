'use strict';

/**
 * @fileoverview Per-folder "file type" (status colour) metadata.
 *
 * Mirrors fileOrder.js: a folder's settings live in its own hidden `.system`
 * directory, alongside that folder's derived/originals/context artifacts (see
 * shared/utils/filePolicy.js, the single source of truth for the layout).
 * `file-types.json` records a *status* for each child item (folder), keyed by
 * child name, so a child's colour is stored in its PARENT's settings — exactly
 * like file-order.json records the parent's child ordering.
 *
 *   <parent>/.system/file-types.json  →  { "types": { "ChildFolder": "success" } }
 *
 * The status drives an accent colour in the left/centre navigation. Only the
 * four whitelisted statuses are accepted; anything else (or a missing entry)
 * means "default" (no accent). Legacy `.settings/` is still read as a fallback so
 * folders written by an older build keep their colours.
 */

const path = require('node:path');
const fs = require('node:fs').promises;
const { SYSTEM_DIR } = require('../../shared/utils/filePolicy');

const SETTINGS_DIR = SYSTEM_DIR;
const LEGACY_SETTINGS_DIR = '.settings';
const TYPES_FILE = 'file-types.json';

/**
 * The supported folder statuses (status → navigation accent colour).
 * 'continuous-exploration' is special: it marks a folder holding a continuous exploration project
 * (.continuous-exploration.json) — the navigation gives it a continuous exploration icon and clicking
 * it opens the continuous exploration workspace instead of the folder view.
 */
const FOLDER_STATUSES = ['success', 'danger', 'warning', 'light', 'continuous-exploration'];
const FOLDER_STATUS_SET = new Set(FOLDER_STATUSES);

/** True when `status` is one of the whitelisted statuses. */
function isValidStatus(status) {
  return typeof status === 'string' && FOLDER_STATUS_SET.has(status);
}

/**
 * Coerce an arbitrary input to a stored status, or null to clear it.
 * Treats '', 'default', 'none' (and any non-whitelisted value) as "clear".
 */
function sanitizeStatus(status) {
  return isValidStatus(status) ? status : null;
}

function typesPathFor(folderAbsPath) {
  return path.join(folderAbsPath, SETTINGS_DIR, TYPES_FILE);
}

/** Pre-migration location of a folder's types file. @private */
function legacyTypesPathFor(folderAbsPath) {
  return path.join(folderAbsPath, LEGACY_SETTINGS_DIR, TYPES_FILE);
}

/**
 * Read the child-name → status map for a folder. Returns {} when there is no
 * settings file. Non-whitelisted statuses are dropped so callers can trust the
 * values.
 * @param {string} folderAbsPath Absolute path of the folder whose children's
 *   statuses are recorded (i.e. the parent folder).
 * @returns {Promise<Object<string,string>>}
 */
async function readFolderTypes(folderAbsPath) {
  let raw;
  for (const candidate of [typesPathFor(folderAbsPath), legacyTypesPathFor(folderAbsPath)]) {
    try {
      raw = await fs.readFile(candidate, 'utf8');
      break;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // Not here — fall through to the legacy location.
    }
  }
  if (raw === undefined) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const types = parsed && typeof parsed.types === 'object' && parsed.types ? parsed.types : {};
  const clean = {};
  for (const [name, status] of Object.entries(types)) {
    if (isValidStatus(status)) clean[name] = status;
  }
  return clean;
}

/**
 * Set (or clear) the status of one child within a folder. A null/invalid status
 * removes the entry. Creates the `.settings` directory on demand and prunes the
 * file's entry rather than leaving a stale value.
 * @param {string} folderAbsPath Absolute path of the parent folder.
 * @param {string} childName     The child folder's name.
 * @param {string|null} status   A whitelisted status, or anything else to clear.
 * @returns {Promise<Object<string,string>>} The updated type map.
 */
async function writeFolderType(folderAbsPath, childName, status) {
  const current = await readFolderTypes(folderAbsPath);
  const next = sanitizeStatus(status);
  if (next) {
    current[childName] = next;
  } else {
    delete current[childName];
  }

  const settingsDir = path.join(folderAbsPath, SETTINGS_DIR);
  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(
    path.join(settingsDir, TYPES_FILE),
    JSON.stringify({ types: current }, null, 2),
    'utf8'
  );
  return current;
}

module.exports = {
  SETTINGS_DIR,
  TYPES_FILE,
  FOLDER_STATUSES,
  isValidStatus,
  sanitizeStatus,
  typesPathFor,
  readFolderTypes,
  writeFolderType,
};
