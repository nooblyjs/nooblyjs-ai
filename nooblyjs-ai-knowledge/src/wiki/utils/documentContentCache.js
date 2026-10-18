'use strict';

/**
 * @fileoverview Freshness-validated cache for document text.
 *
 * The wiki caches document text under `${spaceName}-${documentPath}`. Two
 * properties of that scheme make a plain "get, else read" unsafe:
 *
 *  1. **The key is a PATH, but the cache entry describes a FILE.** A space whose
 *     folders are symlinks to git repositories can reach one physical file by
 *     several paths — e.g. `home.md` (a symlink at the space root) and
 *     `Content/home.md` are the same bytes. That file therefore occupies TWO
 *     cache entries, and a write only ever invalidates the one path the file
 *     watcher reported. The other served stale content indefinitely.
 *
 *  2. **The TTL argument is a lie.** `digital-technologies-core`'s cache exposes
 *     `put(key, value)` — no expiry parameter — so the `1800` every call site
 *     passes is silently discarded. Nothing expires on its own; a poisoned entry
 *     survives until the exact key is deleted or the process restarts.
 *
 * On top of that, event-driven invalidation is best-effort by nature: writes that
 * happen while the backend is down, or that the watcher coalesces or misses, leave
 * the cache describing a file that no longer exists in that form.
 *
 * So freshness is validated on READ instead of trusted from invalidation. Each
 * entry is an envelope carrying the `mtimeMs` and `size` of the file it was read
 * from; a hit only counts when both still match the file on disk. Because
 * `fs.stat` follows symlinks, every path to the same physical file validates
 * against that file's own stat — the multi-path problem disappears rather than
 * being patched. Callers already stat the file to build their response metadata,
 * so this costs nothing extra.
 *
 * Entries written by an older build are raw strings rather than envelopes; they
 * fail validation and are transparently re-read and re-cached, so existing
 * poisoned keys self-heal on first request.
 */

/** Envelope version — bump to invalidate every entry after a shape change. */
const ENVELOPE_VERSION = 1;

/**
 * True when a cached envelope still describes the file that was just stat'ed.
 * @param {*} entry - Whatever came back from the cache.
 * @param {import('node:fs').Stats} stats - Fresh stat of the file.
 * @returns {boolean}
 * @private
 */
function isFresh(entry, stats) {
  return !!entry
    && typeof entry === 'object'
    && entry.v === ENVELOPE_VERSION
    && typeof entry.content === 'string'
    && entry.mtimeMs === stats.mtimeMs
    && entry.size === stats.size;
}

/**
 * Read a document's cached text, but only if it still matches the file on disk.
 *
 * @param {Object} cache - Core cache service.
 * @param {string} cacheKey - `${spaceName}-${documentPath}`.
 * @param {import('node:fs').Stats} stats - Fresh stat of the document.
 * @returns {Promise<string|null>} The cached text, or null when absent/stale.
 */
async function readContentCache(cache, cacheKey, stats) {
  if (!cache || !stats) return null;
  try {
    const entry = await cache.get(cacheKey);
    return isFresh(entry, stats) ? entry.content : null;
  } catch {
    return null; // A cache failure must never break the read path.
  }
}

/**
 * Cache a document's text together with the identity of the file it came from.
 * Best-effort: a cache failure is swallowed, since the caller already has the
 * content it needs to serve.
 *
 * @param {Object} cache - Core cache service.
 * @param {string} cacheKey - `${spaceName}-${documentPath}`.
 * @param {string} content - The text to cache (non-strings are ignored).
 * @param {import('node:fs').Stats} stats - Stat of the file the text was read from.
 * @returns {Promise<void>}
 */
async function writeContentCache(cache, cacheKey, content, stats) {
  if (!cache || !stats || typeof content !== 'string') return;
  try {
    await cache.put(cacheKey, {
      v: ENVELOPE_VERSION,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      content
    });
  } catch {
    /* non-fatal */
  }
}

module.exports = {
  ENVELOPE_VERSION,
  readContentCache,
  writeContentCache
};
