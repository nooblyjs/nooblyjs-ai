/**
 * Client Cache
 *
 * The single source of truth for the wiki's localStorage keyspace, and the
 * client half of the server-driven cache epoch.
 *
 * WHY THIS EXISTS
 * ---------------
 * The nav trees are cached per space in localStorage (`wiki-tree-*`, written by
 * `navigation-core.createTreeCache`). That cache revalidates itself against the
 * server with `If-None-Match` on every load, so ordinary content changes heal on
 * their own. What it CANNOT heal is a change where the server's ETag stays the
 * same but the client's expectations move — a frontend release that changes the
 * shape the tree is stored in, say. Until now the only fix was asking the user
 * to open devtools and run `window.wikiClearAllCache()`, which does not scale to
 * 1500 people and is destructive besides (it also drops cookies, logging them
 * out, and the onboarding flag, re-prompting the welcome wizard).
 *
 * So the server publishes a `clientCacheVersion` stamp on `GET /api/config`. Each
 * browser records the value it last acted on; when the two differ, it purges and
 * records the new one. An admin bumps the stamp from the Profile screen and every
 * browser cleans itself up on its next load.
 *
 * WHAT IT WILL AND WILL NOT DELETE
 * --------------------------------
 * Keys are declared in explicit TIERS, and a purge only ever removes keys it was
 * told about. This is deliberately an allow-list of what to CLEAR rather than a
 * "wipe everything except…": a key added next month and forgotten here survives,
 * which is the safe direction to fail. Get it backwards and the cost is somebody
 * being shown the welcome wizard again, or losing their chat history, because of
 * a cache fix.
 *
 *   cache — derived, re-fetchable, and the whole point: the space trees.
 *   prefs — user intent (view modes, nav toggles, panel state). Only cleared on
 *           an explicit `cache+prefs` purge, never by an epoch bump.
 *   sticky — never removed by anything here, at any scope. Dismissal records and
 *           the epoch stamp itself. `assertSticky()` re-checks this at delete
 *           time so a typo'd prefix in the tiers above still cannot eat them.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-19
 */

/**
 * Where this browser records the epoch it last acted on.
 *
 * Named `kr_wiki_*` rather than `wiki:*` on purpose — `?clearCache=all` sweeps
 * the `wiki` keyspace, and the stamp is not a cache. Were it swept, a support
 * person clearing a user's cache by hand would leave the browser thinking it had
 * never seen an epoch, and the next load would purge again and announce it.
 */
const STAMP_KEY = 'kr_wiki_cache_version';

/** A key matcher: `{ prefix }` for a family, `{ exact }` for one key. */
const TIERS = {
  // Cached space trees + their LRU index (navigation-core.js `keyPrefix`
  // 'wiki-tree-' and `indexKey` 'wiki-tree-index', which the prefix covers).
  cache: [
    { prefix: 'wiki-tree-', note: 'cached space trees' }
  ],
  // User choices. Re-fetchable in the sense that nothing breaks without them,
  // but they are the user's settings, not our cache — an epoch bump leaves them
  // alone and only an explicit `cache+prefs` purge clears them.
  prefs: [
    { prefix: 'wiki:view:', note: 'folder view modes' },
    { prefix: 'wiki:nav:', note: 'nav toggles' },
    { exact: 'wiki:notesPanelOpen', note: 'notes panel state' },
    { exact: 'sidebarState_shortcuts', note: 'sidebar sections' },
    { exact: 'sidebarState_spaces', note: 'sidebar sections' },
    { exact: 'sidebarCollapsed', note: 'sidebar state' },
    { exact: 'sidebarWidth', note: 'sidebar width' },
    { exact: 'aiChatPanelWidth', note: 'AI panel width' },
    { exact: 'aiChatPanelCollapsed', note: 'AI panel state' },
    { exact: 'aiPanelHidden', note: 'AI panel visibility' }
  ]
};

/**
 * Never removed, whatever the scope. Clearing any of these turns a cache fix
 * into a visible regression for the user:
 *   kr_onboarding_seen::   — re-runs the welcome wizard
 *   kr_whatsnew_dismissed::— re-shows an announcement they already read
 *   kr_wiki_layout         — resets their persona layout
 *   kr_wiki_chat_*         — drops their AI chat history
 *   kr_wiki_search_history — drops their recent searches
 */
const STICKY = [
  { prefix: 'kr_onboarding_seen::' },
  { prefix: 'kr_whatsnew_dismissed::' },
  { prefix: 'kr_wiki_' }   // layout, chat sessions, search history, and STAMP_KEY
];

const matches = (key, rule) =>
  rule.exact ? key === rule.exact : key.startsWith(rule.prefix);

/** True when a key must survive every purge. */
function assertSticky(key) {
  return STICKY.some((rule) => matches(key, rule));
}

/** Storage accessor that tolerates private mode / disabled storage. */
function store() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;   // Safari private mode throws on access, not just on write
  }
}

export const clientCache = {
  STAMP_KEY,
  TIERS,

  /**
   * Remove the cached data for a scope.
   *
   * @param {'cache'|'cache+prefs'} [scope='cache']
   * @returns {{ removed: string[], scope: string }}
   */
  purge(scope = 'cache') {
    const storage = store();
    if (!storage) return { removed: [], scope };

    const rules = scope === 'cache+prefs'
      ? [...TIERS.cache, ...TIERS.prefs]
      : TIERS.cache;

    // Collect first, then delete — removing while iterating shifts indices and
    // silently skips every other match.
    const doomed = [];
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (!key || assertSticky(key)) continue;
        if (rules.some((rule) => matches(key, rule))) doomed.push(key);
      }
    } catch {
      return { removed: [], scope };
    }

    const removed = [];
    for (const key of doomed) {
      try { storage.removeItem(key); removed.push(key); } catch { /* best-effort */ }
    }
    return { removed, scope };
  },

  /** The epoch this browser last acted on, or '' if it has never seen one. */
  readStamp() {
    const storage = store();
    if (!storage) return '';
    try { return storage.getItem(STAMP_KEY) || ''; } catch { return ''; }
  },

  writeStamp(version) {
    const storage = store();
    if (!storage) return;
    try { storage.setItem(STAMP_KEY, String(version || '')); } catch { /* best-effort */ }
  },

  /**
   * Compare the server's epoch against this browser's and purge on a mismatch.
   *
   * Called once at boot, BEFORE anything reads a cached tree — a purge that runs
   * after the tree is rendered fixes nothing until the next reload.
   *
   * @param {Object} config - The `/api/config` body.
   * @param {'cache'|'cache+prefs'} [scope='cache'] - What a mismatch clears.
   *   Defaults to trees only: a stale tree is what an epoch bump is for, and
   *   resetting somebody's view modes because we shipped a nav fix is rude.
   * @returns {{ purged:boolean, reason:string, from:string, to:string,
   *             removed:string[], firstSeen:boolean }}
   */
  syncWithServer(config, scope = 'cache') {
    const to = String((config && config.clientCacheVersion) || '').trim();
    const from = this.readStamp();

    // No epoch published (older backend, unreadable settings store) — do
    // nothing. Purging on an absent value would fire on every load.
    if (!to) return { purged: false, reason: 'no-server-version', from, to, removed: [], firstSeen: false };
    if (to === from) return { purged: false, reason: 'match', from, to, removed: [], firstSeen: false };

    // A browser that has never recorded a stamp gets the stamp written but no
    // purge and — importantly — no message: there is nothing stale to clear on a
    // first visit, and "we refreshed your cached navigation" is nonsense to
    // someone who has never loaded the app before.
    const firstSeen = !from;
    const { removed } = firstSeen ? { removed: [] } : this.purge(scope);
    this.writeStamp(to);

    return {
      purged: !firstSeen && removed.length > 0,
      reason: firstSeen ? 'first-seen' : 'version-changed',
      from,
      to,
      removed,
      firstSeen
    };
  }
};

export default clientCache;
