'use strict';

/**
 * @fileoverview Per-folder child ordering — the single source of truth.
 *
 * A folder's ordering lives in its OWN hidden `.system/` namespace, alongside
 * that folder's derived/originals/context artifacts — see
 * shared/utils/filePolicy.js for the layout. Legacy `.settings/` is still READ
 * as a fallback so folders written by an older build keep their custom order;
 * it is never written.
 *
 *   <folder>/.system/file-order.json  →  { "order": ["Overview.md", "Design"] }
 *
 * Entries are CHILD NAMES, never paths. Anything not named falls to the default
 * sort (folders first, then files, each alphabetical) *after* the named items.
 *
 * ─── Cascade ────────────────────────────────────────────────────────────────
 * An order applies to the whole subtree beneath it. A child folder uses its
 * NEAREST ANCESTOR's order unless it carries an order file of its own, which
 * overrides it outright (no merging — see resolveEffectiveOrder). This is what
 * makes a convention like "Overview.md first, then Architecture, then Design"
 * hold across a whole space from a single file at the root, while any one
 * folder can still opt out by having its own.
 *
 * Because entries are names, an inherited order matches whatever the child
 * folder happens to contain and quietly ignores the rest — a cascaded order
 * that names nothing in this folder costs nothing and changes nothing.
 *
 * There is no explicit "stop inheriting" marker: dragging any item in a folder
 * writes that folder's full order, which IS the opt-out. An empty/absent order
 * file therefore means "inherit", not "sort by default".
 *
 * Reading is deliberately tolerant (a malformed file degrades to "no order"
 * rather than breaking the folder tree); WRITING is strict — see
 * sanitizeOrderNames, which the write endpoint uses to reject anything that
 * isn't a plain child name.
 */

const path = require('node:path');
const fs = require('node:fs').promises;
const { SYSTEM_DIR } = require('../../shared/utils/filePolicy');

/** Where an order file is written. */
const SETTINGS_DIR = SYSTEM_DIR;
/** Pre-migration location, still read as a fallback. @private */
const LEGACY_SETTINGS_DIR = '.settings';
/** Probed in this order; the first hit wins. */
const SETTINGS_DIRS = Object.freeze([SETTINGS_DIR, LEGACY_SETTINGS_DIR]);
const ORDER_FILE = 'file-order.json';

/** Guard rails for a written order (a folder listing, not a database). */
const MAX_ORDER_ENTRIES = 10000;
const MAX_NAME_LENGTH = 255;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Absolute path of the order file this module WRITES for a folder. */
function orderPathFor(folderAbsPath) {
  return path.join(folderAbsPath, SETTINGS_DIR, ORDER_FILE);
}

/** Every absolute path an order file may be read from, current location first. */
function orderCandidatePathsFor(folderAbsPath) {
  return SETTINGS_DIRS.map(dir => path.join(folderAbsPath, dir, ORDER_FILE));
}

/**
 * The same candidates as space-RELATIVE, POSIX paths — the shape the filing
 * service takes. `dirRelPath` '' means the space root.
 */
function orderRelPathsFor(dirRelPath) {
  const base = dirRelPath ? `${dirRelPath}/` : '';
  return SETTINGS_DIRS.map(dir => `${base}${dir}/${ORDER_FILE}`);
}

// ---------------------------------------------------------------------------
// Parsing / validation
// ---------------------------------------------------------------------------

/**
 * Parse an order file's contents. Accepts `{ "order": [...] }` (what we write)
 * or a bare array (older files). Returns null for anything unusable — a
 * malformed file must degrade to "no order", never throw into a tree build.
 * @return {string[]|null}
 */
function parseOrder(raw) {
  if (raw == null) return null;
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.order) ? parsed.order : null);
  if (!list) return null;
  const names = list.filter(name => typeof name === 'string' && name.length > 0);
  return names.length > 0 ? names : null;
}

/**
 * Validate a client-supplied order before it is written.
 *
 * Entries are child NAMES. Rejecting separators and dot-segments keeps a
 * would-be path out of the file — which matters more now that an order cascades
 * into every folder beneath it.
 *
 * @param {*} input
 * @return {{ok: boolean, names?: string[], message?: string}}
 */
function sanitizeOrderNames(input) {
  if (!Array.isArray(input)) {
    return { ok: false, message: 'order must be an array of names' };
  }
  if (input.length > MAX_ORDER_ENTRIES) {
    return { ok: false, message: `order must hold at most ${MAX_ORDER_ENTRIES} names` };
  }
  const seen = new Set();
  const names = [];
  for (const entry of input) {
    if (typeof entry !== 'string' || entry.length === 0) {
      return { ok: false, message: 'order entries must be non-empty strings' };
    }
    if (entry.length > MAX_NAME_LENGTH) {
      return { ok: false, message: `order entries must be at most ${MAX_NAME_LENGTH} characters` };
    }
    if (entry.includes('/') || entry.includes('\\') || entry === '.' || entry === '..') {
      return { ok: false, message: 'order entries must be child names, not paths' };
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) continue; // a duplicate can only ever be ignored — drop it
    seen.add(key);
    names.push(entry);
  }
  return { ok: true, names };
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

/** Folders first, then files, each alphabetical. The order of last resort. */
function defaultSort(items) {
  return [...items].sort(compareDefault);
}

function compareDefault(a, b) {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  return (a.name || '').localeCompare(b.name || '');
}

/**
 * Order a directory listing by name.
 *
 * Named items come first, in the order named; everything else follows in the
 * default sort. Matching is case-insensitive — the content lives on Windows,
 * and a cascaded order would otherwise miss `overview.md` where it said
 * `Overview.md`. Items sharing a name key keep a stable relative order.
 *
 * @param {Array<{name: string, type: string}>} items
 * @param {string[]|null} orderNames
 * @return {Array} a new array; `items` is left untouched
 */
function applyFileOrder(items, orderNames) {
  if (!Array.isArray(items)) return [];
  if (!orderNames || orderNames.length === 0) return defaultSort(items);

  const rank = new Map();
  orderNames.forEach((name, index) => {
    const key = String(name).toLowerCase();
    if (!rank.has(key)) rank.set(key, index);
  });

  const named = [];
  const rest = [];
  for (const item of items) {
    const key = String(item && item.name || '').toLowerCase();
    if (rank.has(key)) named.push(item);
    else rest.push(item);
  }

  named.sort((a, b) => {
    const delta = rank.get(String(a.name).toLowerCase()) - rank.get(String(b.name).toLowerCase());
    return delta !== 0 ? delta : compareDefault(a, b);
  });

  return [...named, ...defaultSort(rest)];
}

/**
 * The cascade rule, in one place: a folder's own order wins outright, otherwise
 * the nearest ancestor's applies. An absent OR empty own order inherits — see
 * the file header for why there is no separate "don't inherit" marker.
 *
 * @param {string[]|null} ownOrder      this folder's order file, if any
 * @param {string[]|null} inheritedOrder the effective order of its parent
 * @return {string[]|null}
 */
function resolveEffectiveOrder(ownOrder, inheritedOrder) {
  if (Array.isArray(ownOrder) && ownOrder.length > 0) return ownOrder;
  if (Array.isArray(inheritedOrder) && inheritedOrder.length > 0) return inheritedOrder;
  return null;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Read a folder's own order through an arbitrary reader — used by the tree
 * build, which goes through the space's filing service rather than `fs`.
 * Every failure (missing file, unreadable, malformed) means "no order".
 *
 * @param {function(string): Promise<string>} readFile relative path → contents
 * @param {string} dirRelPath space-relative folder path ('' = space root)
 * @return {Promise<string[]|null>}
 */
async function readOrderWith(readFile, dirRelPath) {
  for (const relPath of orderRelPathsFor(dirRelPath)) {
    let raw;
    try {
      raw = await readFile(relPath);
    } catch {
      continue; // not here (or unreadable) — try the legacy location
    }
    const names = parseOrder(raw);
    if (names) return names;
  }
  return null;
}

/**
 * Read a folder's own order from disk, with the file it came from so a caller
 * can write it back in place (never migrating a legacy file just by touching
 * it). @private
 * @return {Promise<{names: string[], filePath: string}|null>}
 */
async function readOrderEntry(folderAbsPath) {
  for (const filePath of orderCandidatePathsFor(folderAbsPath)) {
    let raw;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') continue;
      throw err;
    }
    const names = parseOrder(raw);
    if (names) return { names, filePath };
  }
  return null;
}

/**
 * A folder's own order from disk, or null. Does NOT consider ancestors — the
 * cascade is resolved by the tree walk, which has the parent chain in hand.
 * @return {Promise<string[]|null>}
 */
async function readFileOrder(folderAbsPath) {
  const entry = await readOrderEntry(folderAbsPath);
  return entry ? entry.names : null;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Write a folder's order, creating `.system/` on demand. */
async function writeFileOrder(folderAbsPath, names) {
  const settingsDir = path.join(folderAbsPath, SETTINGS_DIR);
  await fs.mkdir(settingsDir, { recursive: true });
  await fs.writeFile(
    path.join(settingsDir, ORDER_FILE),
    JSON.stringify({ order: names }, null, 2),
    'utf8'
  );
}

/**
 * Rewrite an order file that already exists, in place.
 *
 * Never CREATES one: a folder that inherits its order must keep inheriting
 * after a rename or delete, and materialising an override here would silently
 * detach it from its parent. @private
 */
async function updateExistingOrder(folderAbsPath, mutate) {
  const entry = await readOrderEntry(folderAbsPath);
  if (!entry) return false;
  const next = mutate(entry.names);
  if (!next) return false;
  await fs.writeFile(entry.filePath, JSON.stringify({ order: next }, null, 2), 'utf8');
  return true;
}

/**
 * Follow a rename in the parent's order so the item keeps its position instead
 * of dropping to the bottom. No-op when the folder has no order file of its own
 * or does not name the item.
 * @return {Promise<boolean>} whether the file was rewritten
 */
async function renameInFileOrder(folderAbsPath, oldName, newName) {
  if (!oldName || !newName || oldName === newName) return false;
  return updateExistingOrder(folderAbsPath, names => {
    const index = names.findIndex(name => name.toLowerCase() === String(oldName).toLowerCase());
    if (index === -1) return null;
    const next = [...names];
    next[index] = newName;
    // The new name may already be listed further down (a rename onto a name a
    // stale entry still holds) — keep the first occurrence only.
    return next.filter((name, i) =>
      i === next.findIndex(other => other.toLowerCase() === name.toLowerCase()));
  });
}

/**
 * Drop a deleted/moved-away item from the parent's order, so dead names don't
 * accumulate. No-op when the folder has no order file or does not name it.
 * @return {Promise<boolean>} whether the file was rewritten
 */
async function removeFromFileOrder(folderAbsPath, name) {
  if (!name) return false;
  return updateExistingOrder(folderAbsPath, names => {
    const next = names.filter(entry => entry.toLowerCase() !== String(name).toLowerCase());
    return next.length === names.length ? null : next;
  });
}

module.exports = {
  SETTINGS_DIR,
  LEGACY_SETTINGS_DIR,
  SETTINGS_DIRS,
  ORDER_FILE,
  MAX_ORDER_ENTRIES,
  orderPathFor,
  orderCandidatePathsFor,
  orderRelPathsFor,
  parseOrder,
  sanitizeOrderNames,
  defaultSort,
  applyFileOrder,
  resolveEffectiveOrder,
  readOrderWith,
  readFileOrder,
  writeFileOrder,
  renameInFileOrder,
  removeFromFileOrder,
};
