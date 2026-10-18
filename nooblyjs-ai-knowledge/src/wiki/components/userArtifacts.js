/**
 * @fileoverview Per-user artefact scoping — pins, recent, starred.
 *
 * THESE ARTEFACTS BELONG TO A PATH, NOT TO A SPACE.
 *
 * They are stored per CONTENT ROOT already: `spaceUserStore` resolves a space
 * to `space.path || configuration.filing.baseDir`, so every space sitting on one
 * root shares one `pins.json` / `activity.json`. Several spaces sharing a root
 * is the normal arrangement now — Engineering, Financial Services, People and
 * Retail are four VIEWS of `knowledge-content/engineering`, differing only by
 * `excludedPaths`.
 *
 * Records used to carry a `spaceName` string and the UI filtered on it. That was
 * wrong in four ways:
 *
 *   1. RENAMING A SPACE ORPHANED EVERYTHING. The stamp was the space's display
 *      name, so a rename made every record invisible with no error — observed
 *      live: four pins and eight recent entries stamped "Engineering
 *      Collaboration Space", a name that no longer existed.
 *   2. ONE FILE BECAME N RECORDS. Pin a document from two views and the dedupe
 *      key (which included the stamp) treated them as different things.
 *   3. THE STAMP WAS OFTEN ARBITRARY. Search results carry whichever space
 *      indexed a path last — index entries are keyed by space-relative path
 *      with no space prefix — so anything derived from search was a coin toss.
 *   4. IT ENFORCED NOTHING. Matching a label is not an access check; a space's
 *      `excludedPaths` were never consulted.
 *
 * So the stamp is dropped on read and never written again. Scoping is now the
 * real visibility matcher (`shared/spaces/spaceVisibility`), which is the same
 * code the folder tree, search and the filing routes use. A pin then follows the
 * user into every view that can see the document, a rename breaks nothing, and
 * an excluded path is genuinely excluded.
 *
 * Legacy records are normalised on READ, so this self-heals with no migration
 * step; the cleaned shape reaches disk the next time the file is written.
 *
 * @author noobly Team
 * @since 2026-08-03
 */

'use strict';

const { compileVisibility } = require('../../shared/spaces/spaceVisibility');

/** Recent entries kept per user, per content root. */
const RECENT_LIMIT = 50;

/**
 * Identity of a record. `type` distinguishes a pinned folder from a pinned
 * document at the same path; recent/starred entries are always documents and
 * simply have no type.
 *
 * @param {Object} record
 * @return {string}
 */
function recordKey(record) {
  const type = record && record.type ? String(record.type) : 'document';
  const path = record && record.path ? String(record.path).replace(/\\/g, '/') : '';
  return `${type}::${path}`;
}

/** Milliseconds for whichever timestamp a record carries; 0 when unusable. */
function recordTime(record) {
  const raw = record && (record.pinnedAt || record.starredAt || record.visitedAt);
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Drop the legacy `spaceName` stamp and collapse the duplicates it created.
 *
 * Order is preserved (these lists are newest-first by construction), but when
 * two records collapse to one key the NEWER timestamp wins — otherwise
 * re-pinning something from a second view would silently revert its date.
 *
 * @param {Array} records
 * @return {Array} new array, inputs untouched
 */
function normalise(records) {
  if (!Array.isArray(records)) return [];

  const byKey = new Map();
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    if (!record.path) continue;

    // eslint-disable-next-line no-unused-vars
    const { spaceName, ...rest } = record;
    const clean = { ...rest, path: String(record.path).replace(/\\/g, '/') };

    const key = recordKey(clean);
    const existing = byKey.get(key);
    if (!existing || recordTime(clean) > recordTime(existing)) {
      byKey.set(key, clean);
    }
  }
  return [...byKey.values()];
}

/**
 * Keep only the records `space` exposes.
 *
 * Folders are judged with `isFolderAccessible` rather than `isFolderVisible`: a
 * pass-through ancestor is not visible in its own right but IS navigable, and a
 * user who pinned it can still drill through it.
 *
 * An unrestricted space short-circuits, so this costs nothing for most spaces.
 *
 * @param {Object} space space record from spaces.json
 * @param {Array} records already normalised
 * @return {Array}
 */
function filterVisible(space, records) {
  if (!Array.isArray(records)) return [];
  const visibility = compileVisibility(space);
  if (!visibility.restricted) return records;

  return records.filter(record => (
    record.type === 'folder'
      ? visibility.isFolderAccessible(record.path)
      : visibility.isFileVisible(record.path)
  ));
}

/**
 * Read → normalise → scope, the order every consumer needs.
 *
 * @param {Object} space space record ({} or null = unrestricted)
 * @param {Array} records raw, as stored
 * @return {Array}
 */
function forSpace(space, records) {
  return filterVisible(space, normalise(records));
}

module.exports = {
  RECENT_LIMIT,
  recordKey,
  normalise,
  filterVisible,
  forSpace
};
