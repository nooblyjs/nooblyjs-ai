/**
 * @fileoverview Recent-changes scan — what changed lately in a folder and
 * everything beneath it.
 *
 * Backs the ```` ```recent-changes ```` landing block (parser:
 * MarkdownParser.renderRecentChanges; hydrator: recentChangesController) and
 * `GET /applications/wiki/api/spaces/:spaceId/recent-changes`.
 *
 * THE SOURCE OF TRUTH IS THE FILE SYSTEM, deliberately. The search index also
 * carries a `modifiedTime` per document and scanning it in memory would be
 * free, but that stamp is only as fresh as the last time the file was INDEXED —
 * a boot loads the index from disk without walking, so anything written while
 * the backend was down keeps its old stamp and would silently never appear in a
 * panel whose entire job is to say "this changed". A directory walk is always
 * right. The cost of being always right is paid down by the caller's cache (see
 * filingRoutes' recentEntriesForSpace) and by the two bounds below.
 *
 * BOUNDS. The content roots are directories of symlinked git repositories, so
 * an unbounded recursive walk is the request that never returns (the same
 * reason the folder tree is lazy — see CLAUDE.md). Two guards, and both report
 * themselves rather than failing silently:
 *   - `depthRemaining` stops the recursion at a fixed number of levels;
 *   - `maxDirs` stops it after a fixed number of directory listings.
 * Either one tripping sets `truncated`, which the route passes to the client so
 * a short answer is distinguishable from a quiet one.
 *
 * DOT-PREFIXED NAMES ARE SKIPPED WHOLESALE — `.system` (derived sidecars,
 * context, originals, templates), `.aicontext`, `.home.md`. These are written
 * BY the app, often as a side effect of something else being saved, so a
 * "recent changes" panel that listed them would mostly be reporting on itself.
 * That also matches what the file tree, the search indexer and the file watcher
 * each skip, so a document can never appear here that is invisible everywhere
 * else.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-26
 */

'use strict';

/** Items returned when the block does not ask for a specific number. */
const DEFAULT_LIMIT = 8;

/** Hard ceiling on `limit`, mirroring MarkdownParser.RECENT_DEFAULTS.maxLimit. */
const MAX_LIMIT = 60;

/** Days looked back when the block does not ask for a specific period. */
const DEFAULT_DAYS = 30;

/**
 * How many of the most recent entries a completed scan keeps.
 *
 * The scan is cached per (content root, space, folder, depth) and then sliced
 * by `days`/`limit`, so one walk has to serve every block pointed at that
 * folder — including a curated space that filters most of the results away.
 * Keeping a few hundred rather than the requested handful makes those share one
 * walk; keeping the whole tree would pin a large space's entire file list in
 * memory for the life of the cache entry.
 */
const KEEP = 300;

/** Directory listings one scan may perform before it gives up and says so. */
const MAX_DIRS = Math.max(1, Number(process.env.WIKI_RECENT_SCAN_MAX_DIRS) || 4000);

/**
 * Milliseconds in a day, for the `days` window.
 * @type {number}
 */
const DAY_MS = 86400000;

/**
 * Coerce a filing-service timestamp to epoch milliseconds.
 * @param {*} value - Date, ISO string, or undefined
 * @return {number} epoch ms, or 0 when there is no usable timestamp
 */
function toTime(value) {
  if (!value) return 0;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Read the requested window/size/kind off a query object, clamped.
 *
 * Every field is optional and every bad value falls back rather than erroring —
 * these come from text an author typed into a markdown fence, and a typo should
 * show the default panel, not a 400.
 *
 * @param {Object} [query] - Express `req.query` (or the block's own settings)
 * @return {{days:number, limit:number, types:'all'|'documents'|'folders'}}
 */
function normaliseRecentQuery(query = {}) {
  const days = (() => {
    const raw = query.days;
    if (raw === undefined || raw === null || raw === '') return DEFAULT_DAYS;
    // `0` / `all` mean "no time limit", which is a real choice, not a fallback.
    if (raw === '0' || raw === 0 || String(raw).toLowerCase() === 'all') return 0;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAYS;
  })();

  const limit = (() => {
    const n = Number.parseInt(query.limit, 10);
    if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
  })();

  const rawTypes = String(query.types || 'all').toLowerCase();
  const types = rawTypes === 'documents' || rawTypes === 'folders' ? rawTypes : 'all';

  return { days, limit, types };
}

/**
 * Walk one directory, recording every visible entry that carries a timestamp,
 * and recurse into its subfolders.
 *
 * VISIBILITY IS APPLIED DURING THE WALK, not to the finished list, for the same
 * reason `buildFileTree`'s `shouldDescend` exists: a curated space should not
 * pay to walk a subtree it will only discard. The three predicates are not
 * interchangeable —
 *   - a FILE is judged by `isFileVisible` (which passes root-level files);
 *   - a folder is DESCENDED INTO when `isFolderAccessible`, so a pass-through
 *     ancestor of an allowed root is walked through;
 *   - but a folder is only LISTED as an item when `isFolderVisible`, because a
 *     pass-through container is something you drill through, not something that
 *     meaningfully "changed".
 *
 * @param {Object} filingService - space-scoped filing service
 * @param {string} dirPath - space-relative folder ('' = the space root)
 * @param {Object} visibility - compiled `spaceVisibility` matcher
 * @param {number} depthRemaining - levels still allowed below `dirPath`
 * @param {Array<Object>} out - collected entries, appended to in place
 * @param {{dirs:number, truncated:boolean, maxDirs:number}} budget - shared
 * @return {Promise<number>} how many visible entries `dirPath` itself holds,
 *   which the caller records as the folder's item count
 */
async function scanRecentEntries(filingService, dirPath, visibility, depthRemaining, out, budget) {
  if (budget.dirs >= budget.maxDirs) {
    budget.truncated = true;
    return 0;
  }
  budget.dirs += 1;

  let entries;
  try {
    entries = await filingService.list(dirPath || '.');
  } catch (_) {
    // An unreadable folder DEEP in the walk (a broken symlink, a permission
    // wall) is not a failure of the panel — the rest of the subtree is still
    // worth showing. An unreadable folder at the TOP is different: the block
    // names a folder that cannot be listed, and reporting that as "nothing
    // changed" leaves a mistyped path looking like a quiet week. `dirs` was
    // incremented above, so 1 identifies the first listing.
    if (budget.dirs === 1) budget.rootUnreadable = true;
    return 0;
  }
  if (!Array.isArray(entries)) return 0;

  const restricted = !!(visibility && visibility.restricted);
  let visibleChildren = 0;

  for (const raw of entries) {
    const isObject = raw !== null && typeof raw === 'object';
    const name = isObject ? raw.name : raw;
    if (!name || typeof name !== 'string') continue;
    if (name.startsWith('.')) continue;

    const entryPath = dirPath ? `${dirPath}/${name}` : name;

    // Prefer what the provider declared; probe only when it declared nothing,
    // exactly as buildTreeFromFiling does.
    let isDirectory = isObject && (raw.isDirectory !== undefined || raw.type !== undefined)
      ? (raw.isDirectory === true || raw.type === 'folder')
      : null;
    if (isDirectory === null) {
      try {
        await filingService.list(entryPath);
        isDirectory = true;
      } catch (_) {
        isDirectory = false;
      }
    }

    const modifiedAt = toTime(isObject ? raw.modified : null);

    if (!isDirectory) {
      if (restricted && !visibility.isFileVisible(entryPath)) continue;
      visibleChildren += 1;
      // No usable timestamp means no way to place it in time. Counting it
      // towards the folder's item count is still right; listing it as a recent
      // change is not.
      if (modifiedAt) {
        out.push({
          type: 'document',
          name,
          path: entryPath,
          modifiedAt,
          size: isObject ? raw.size : undefined
        });
      }
      continue;
    }

    if (restricted && !visibility.isFolderAccessible(entryPath)) continue;
    visibleChildren += 1;

    let childCount;
    if (depthRemaining > 1) {
      childCount = await scanRecentEntries(
        filingService, entryPath, visibility, depthRemaining - 1, out, budget
      );
    } else {
      // The walk stops here, so anything below this folder is unreported.
      budget.truncated = true;
    }

    if (restricted && !visibility.isFolderVisible(entryPath)) continue;
    if (modifiedAt) {
      out.push({ type: 'folder', name, path: entryPath, modifiedAt, childCount });
    }
  }

  return visibleChildren;
}

/**
 * Scan a folder subtree and return its entries, most recently changed first.
 *
 * Time-independent on purpose: no `days` or `limit` is applied here, so one
 * cached scan can serve blocks asking for 7 days and 90 days alike. Narrow it
 * with {@link selectRecent}.
 *
 * @param {Object} filingService - space-scoped filing service
 * @param {Object} [options]
 * @param {string} [options.subPath=''] - folder to scan ('' = the space root)
 * @param {number} [options.depth=24] - levels to walk below `subPath`
 * @param {Object} [options.visibility] - compiled `spaceVisibility` matcher
 * @param {number} [options.maxDirs] - directory-listing budget
 * @param {number} [options.keep=300] - entries retained after sorting
 * @return {Promise<{items:Array<Object>, truncated:boolean, scannedDirs:number}>}
 */
async function collectRecentEntries(filingService, options = {}) {
  const subPath = options.subPath || '';
  const depth = Math.max(1, Number(options.depth) || 24);
  const visibility = options.visibility || { restricted: false };
  const budget = {
    dirs: 0,
    truncated: false,
    rootUnreadable: false,
    maxDirs: Math.max(1, Number(options.maxDirs) || MAX_DIRS)
  };
  const keep = Math.max(1, Number(options.keep) || KEEP);

  const items = [];
  await scanRecentEntries(filingService, subPath, visibility, depth, items, budget);

  items.sort((a, b) => b.modifiedAt - a.modifiedAt);

  return {
    items: items.slice(0, keep),
    truncated: budget.truncated,
    scannedDirs: budget.dirs,
    // The named folder could not be listed at all — a moved or mistyped path,
    // not an empty one. The route turns this into the same 404 a curated-away
    // folder gets, which is deliberate: the two must be indistinguishable, or
    // the difference maps the hidden tree.
    missing: budget.rootUnreadable
  };
}

/**
 * Narrow a completed scan to what one block asked for.
 *
 * @param {Array<Object>} items - output of {@link collectRecentEntries}
 * @param {Object} [options]
 * @param {number} [options.days=30] - look-back window; 0 means no window
 * @param {number} [options.limit=8] - most items to return
 * @param {'all'|'documents'|'folders'} [options.types='all']
 * @param {number} [options.now] - clock override, for tests
 * @return {Array<Object>} client-shaped items, newest first
 */
function selectRecent(items, options = {}) {
  const { days, limit, types } = normaliseRecentQuery(options);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const cutoff = days > 0 ? now - days * DAY_MS : 0;

  const out = [];
  for (const item of items || []) {
    if (!item || !item.modifiedAt) continue;
    if (item.modifiedAt < cutoff) continue;
    if (types === 'documents' && item.type !== 'document') continue;
    if (types === 'folders' && item.type !== 'folder') continue;

    const shaped = {
      type: item.type,
      name: item.name,
      path: item.path,
      modified: new Date(item.modifiedAt).toISOString()
    };
    if (item.size !== undefined) shaped.size = item.size;
    if (item.childCount !== undefined) shaped.childCount = item.childCount;
    out.push(shaped);

    if (out.length >= limit) break;
  }
  return out;
}

/* ==========================================================================
   Pinned scope — the ```pinned-recent-changes``` block
   ========================================================================== */

/**
 * How many separate scans one pinned request may start.
 *
 * A folder-scoped block pays for ONE subtree walk; a pinned one pays for as
 * many as the reader has pins, and pins are cheap to add. The cap turns "a user
 * with forty pins makes the panel unusable for everyone on the box" into "the
 * forty-first pin is not scanned, and the panel says so".
 */
const MAX_PINNED_SCANS = Math.max(1, Number(process.env.WIKI_PINNED_SCAN_MAX_FOLDERS) || 12);

/** Normalise a stored pin path to the space-relative form the walk uses. */
function pinPath(record) {
  return String((record && record.path) || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** Is `child` the same as, or inside, `parent`? */
function isAtOrUnder(child, parent) {
  if (parent === '') return true;
  return child === parent || child.startsWith(parent + '/');
}

/**
 * Work out the smallest set of scans that covers a reader's pins.
 *
 * Three reductions, and each of them is the difference between a panel that
 * answers and one that walks the same files repeatedly:
 *
 *   1. A pinned folder INSIDE another pinned folder adds nothing — the outer
 *      walk already reaches it — so only the outermost survive.
 *   2. A pinned DOCUMENT under a pinned folder is likewise already covered.
 *   3. The documents that are left are grouped by their parent folder, so N
 *      pins sharing a folder cost one listing, not N. They are scanned one
 *      level deep and then filtered back to the pinned paths, rather than
 *      stat'ed individually — that reuses the same walk, the same visibility
 *      rules and the same cache as everything else here.
 *
 * Order is preserved as "outermost first, then shallowest" so that when the cap
 * bites it drops the most specific pins, which are the ones most likely to be
 * covered by something else the reader also pinned.
 *
 * @param {Array<Object>} pins - normalised, space-scoped pin records
 * @param {Object} [options]
 * @param {number} [options.maxScans] - scan budget (folders + document groups)
 * @return {{folders:string[], documentGroups:Array<{dir:string, paths:string[]}>,
 *           skipped:number, pinnedFolders:number, pinnedDocuments:number}}
 */
function planPinnedScan(pins, options = {}) {
  const maxScans = Math.max(1, Number(options.maxScans) || MAX_PINNED_SCANS);
  const list = Array.isArray(pins) ? pins : [];

  const folderPins = [];
  const documentPins = [];
  for (const pin of list) {
    const p = pinPath(pin);
    if (!p) continue;
    if (pin && pin.type === 'folder') folderPins.push(p);
    else documentPins.push(p);
  }

  // Shallowest first, so an outer folder is always considered before anything
  // it contains — which is what makes the "already covered" test one pass.
  const byDepth = (a, b) => (a.split('/').length - b.split('/').length) || a.localeCompare(b);

  const folders = [];
  for (const folder of [...new Set(folderPins)].sort(byDepth)) {
    if (!folders.some(root => isAtOrUnder(folder, root))) folders.push(folder);
  }

  const uncovered = [...new Set(documentPins)]
    .filter(doc => !folders.some(root => isAtOrUnder(doc, root)));

  const groups = new Map();
  for (const doc of uncovered) {
    const dir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '';
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(doc);
  }
  const documentGroups = [...groups.entries()]
    .map(([dir, paths]) => ({ dir, paths }))
    .sort((a, b) => byDepth(a.dir, b.dir));

  // Folders lead: a pinned folder is a standing interest, a pinned document is
  // one page, so when the budget runs out the folders are what should survive.
  const folderBudget = Math.min(folders.length, maxScans);
  const groupBudget = Math.min(documentGroups.length, Math.max(0, maxScans - folderBudget));
  const skipped = (folders.length - folderBudget) + (documentGroups.length - groupBudget);

  return {
    folders: folders.slice(0, folderBudget),
    documentGroups: documentGroups.slice(0, groupBudget),
    skipped,
    pinnedFolders: folders.length,
    pinnedDocuments: uncovered.length
  };
}

/**
 * Merge several scans into one list, newest first.
 *
 * Deduplicates by path: pinned subtrees can overlap in ways `planPinnedScan`
 * cannot always reduce away (a document group whose folder is pinned in a
 * DIFFERENT space view, say), and the same file appearing twice in a "what
 * changed" grid reads as a bug.
 *
 * @param {Array<Array<Object>>} scans - each an item list from a scan
 * @param {number} [keep=300]
 * @return {Array<Object>}
 */
function mergeRecentEntries(scans, keep = KEEP) {
  const byPath = new Map();
  for (const items of scans || []) {
    for (const item of items || []) {
      if (!item || !item.path) continue;
      const existing = byPath.get(item.path);
      if (!existing || item.modifiedAt > existing.modifiedAt) byPath.set(item.path, item);
    }
  }
  return [...byPath.values()]
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, Math.max(1, keep));
}

module.exports = {
  collectRecentEntries,
  scanRecentEntries,
  selectRecent,
  normaliseRecentQuery,
  planPinnedScan,
  mergeRecentEntries,
  toTime,
  MAX_PINNED_SCANS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_DAYS,
  KEEP,
  MAX_DIRS,
  DAY_MS
};
