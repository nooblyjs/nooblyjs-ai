'use strict';

/**
 * The client cache epoch — how a change on the server makes 1500 browsers drop
 * their cached navigation trees without anybody opening devtools.
 *
 * The backend publishes a `clientCacheVersion` stamp on `GET /api/config`; each
 * browser records the value it last acted on and purges when the two differ. An
 * admin bumps the stamp from Profile → System → Client caches.
 *
 * The properties under test are the ones whose failure is silent or destructive:
 *
 *   1. A purge is an ALLOW-LIST of what to clear, never "wipe everything except".
 *      The dangerous neighbours in this keyspace are `kr_onboarding_seen::` and
 *      `kr_whatsnew_dismissed::` — clear either and the user is re-shown the
 *      welcome wizard or an announcement they already read, turning a cache fix
 *      into a visible regression. So a key nobody declared must SURVIVE.
 *   2. A browser that has never seen an epoch is stamped but not purged and not
 *      told anything — there is nothing stale on a first visit.
 *   3. An absent or blank server version does nothing. Blank would compare
 *      unequal to every recorded stamp on the first load and equal after, i.e.
 *      exactly one silent purge for everybody, which is indistinguishable from
 *      the bug this feature exists to fix.
 *   4. Bumping produces a value DIFFERENT from the one stored. The value is not
 *      ordered and nothing reads it as a number — it only has to change, and a
 *      bump that reproduces the previous value purges nobody while reporting
 *      success.
 *
 * clientCache.js is a browser ES module, so it is evaluated here in a `vm` with
 * the `export` keywords stripped — the same approach navChainCollapse.test.js
 * and spaceHomeResolution.test.js use.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const featureFlags = require('../../../src/wiki/config/featureFlags');

const CLIENT_CACHE = path.resolve(
  __dirname,
  '../../../src/web/wiki/public/js/modules/clientCache.js'
);

/* ==========================================================================
 * Harness
 * ========================================================================== */

/** Minimal localStorage: enough surface for iterate-and-remove. */
function fakeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    _keys() { return Array.from(map.keys()).sort(); }
  };
}

function loadClientCache(storage) {
  const source = fs.readFileSync(CLIENT_CACHE, 'utf8')
    .replace(/^export default .*$/gm, '')
    .replace(/^export\s+/gm, '');
  const ctx = { console, localStorage: storage };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'clientCache.js' });
  return vm.runInContext('clientCache', ctx);
}

/** Fake core settings service (grouped key/value). */
function fakeSettings(seed = {}) {
  const store = new Map(Object.entries(seed));
  const id = (key, group) => `${group}::${key}`;
  return {
    meta: new Map(),
    async get(key, group) { return store.get(id(key, group)); },
    async has(key, group) { return store.has(id(key, group)); },
    async set(key, value, group, meta) {
      store.set(id(key, group), value);
      this.meta.set(id(key, group), meta);
    },
    _raw: store
  };
}

/** A browser mid-life: cached trees, preferences, and the untouchable records. */
const POPULATED = {
  'wiki-tree-space-1': '{"tree":[]}',
  'wiki-tree-space-2': '{"tree":[]}',
  'wiki-tree-index': '["space-1","space-2"]',
  'wiki:view:folder': 'grid',
  'wiki:nav:collapseChains': 'true',
  'wiki:notesPanelOpen': 'true',
  'sidebarWidth': '280',
  'aiChatPanelCollapsed': 'false',
  'kr_onboarding_seen::sam@example.com': 'true',
  'kr_whatsnew_dismissed::sam@example.com': 'abc123def456',
  'kr_wiki_layout': 'detailed',
  'kr_wiki_chat_sessions': '[{"id":"1"}]',
  'kr_wiki_search_history': '["oracle"]'
};

/* ==========================================================================
 * Purge scopes
 * ========================================================================== */

describe('clientCache.purge', () => {
  test('default scope clears cached trees and nothing else', () => {
    const storage = fakeStorage(POPULATED);
    const cache = loadClientCache(storage);

    const { removed } = cache.purge();

    expect(removed.sort()).toEqual([
      'wiki-tree-index', 'wiki-tree-space-1', 'wiki-tree-space-2'
    ]);
    // Every preference the user chose is still there.
    expect(storage.getItem('wiki:view:folder')).toBe('grid');
    expect(storage.getItem('sidebarWidth')).toBe('280');
    expect(storage.getItem('aiChatPanelCollapsed')).toBe('false');
  });

  test('cache+prefs also clears preferences, still never the sticky records', () => {
    const storage = fakeStorage(POPULATED);
    const cache = loadClientCache(storage);

    cache.purge('cache+prefs');

    expect(storage.getItem('wiki:view:folder')).toBeNull();
    expect(storage.getItem('wiki:nav:collapseChains')).toBeNull();
    expect(storage.getItem('sidebarWidth')).toBeNull();
    expect(storage.getItem('kr_onboarding_seen::sam@example.com')).toBe('true');
    expect(storage.getItem('kr_wiki_layout')).toBe('detailed');
  });

  // The whole reason this is an allow-list. `wikiClearAllCache()` in the console
  // wipes the keyspace wholesale, which is why it re-prompts the welcome wizard
  // and signs people out — a purge shipped to 1500 users must not.
  test.each([
    ['welcome wizard', 'kr_onboarding_seen::sam@example.com'],
    ["What's New dismissal", 'kr_whatsnew_dismissed::sam@example.com'],
    ['persona layout', 'kr_wiki_layout'],
    ['AI chat history', 'kr_wiki_chat_sessions'],
    ['search history', 'kr_wiki_search_history']
  ])('never removes the %s record, at any scope', (_label, key) => {
    for (const scope of ['cache', 'cache+prefs']) {
      const storage = fakeStorage(POPULATED);
      const cache = loadClientCache(storage);
      cache.purge(scope);
      expect(storage.getItem(key)).not.toBeNull();
    }
  });

  test('an undeclared key survives — forgetting to add one must fail safe', () => {
    const storage = fakeStorage({ ...POPULATED, 'some_future_feature_state': 'keep me' });
    const cache = loadClientCache(storage);

    cache.purge('cache+prefs');

    expect(storage.getItem('some_future_feature_state')).toBe('keep me');
  });

  test('removes every match, not every other one (collect-then-delete)', () => {
    const seed = {};
    for (let i = 0; i < 12; i++) seed[`wiki-tree-space-${i}`] = '{}';
    const storage = fakeStorage(seed);
    const cache = loadClientCache(storage);

    const { removed } = cache.purge();

    expect(removed).toHaveLength(12);
    expect(storage.length).toBe(0);
  });

  test('degrades quietly when storage is unavailable (private mode)', () => {
    const cache = loadClientCache(undefined);
    expect(() => cache.purge()).not.toThrow();
    expect(cache.purge().removed).toEqual([]);
    expect(cache.readStamp()).toBe('');
  });
});

/* ==========================================================================
 * Syncing against the server's epoch
 * ========================================================================== */

describe('clientCache.syncWithServer', () => {
  test('purges and records the new epoch when the version changes', () => {
    const storage = fakeStorage({ ...POPULATED, kr_wiki_cache_version: '1' });
    const cache = loadClientCache(storage);

    const result = cache.syncWithServer({ clientCacheVersion: '1760000000000' });

    expect(result.purged).toBe(true);
    expect(result.reason).toBe('version-changed');
    expect(result.removed).toHaveLength(3);
    expect(storage.getItem('kr_wiki_cache_version')).toBe('1760000000000');
    expect(storage.getItem('wiki-tree-space-1')).toBeNull();
  });

  test('an epoch bump leaves preferences alone', () => {
    const storage = fakeStorage({ ...POPULATED, kr_wiki_cache_version: '1' });
    const cache = loadClientCache(storage);

    cache.syncWithServer({ clientCacheVersion: '2' });

    expect(storage.getItem('wiki:view:folder')).toBe('grid');
    expect(storage.getItem('wiki:nav:collapseChains')).toBe('true');
  });

  test('does nothing when the versions match', () => {
    const storage = fakeStorage({ ...POPULATED, kr_wiki_cache_version: '7' });
    const cache = loadClientCache(storage);

    const result = cache.syncWithServer({ clientCacheVersion: '7' });

    expect(result.purged).toBe(false);
    expect(result.reason).toBe('match');
    expect(storage.getItem('wiki-tree-space-1')).not.toBeNull();
  });

  // A first visit has nothing stale to clear, and "your cached navigation has
  // been refreshed" is nonsense to someone who has never loaded the app.
  test('a browser that has never seen an epoch is stamped, not purged', () => {
    const storage = fakeStorage(POPULATED);
    const cache = loadClientCache(storage);

    const result = cache.syncWithServer({ clientCacheVersion: '99' });

    expect(result.firstSeen).toBe(true);
    expect(result.purged).toBe(false);
    expect(result.removed).toEqual([]);
    expect(storage.getItem('wiki-tree-space-1')).not.toBeNull();
    expect(storage.getItem('kr_wiki_cache_version')).toBe('99');
  });

  // An older backend, or a settings store that failed to read, must not look
  // like "the epoch changed".
  test.each([
    ['a missing version', {}],
    ['a blank version', { clientCacheVersion: '   ' }],
    ['a null version', { clientCacheVersion: null }],
    ['no config at all', null]
  ])('%s is a no-op', (_label, config) => {
    const storage = fakeStorage({ ...POPULATED, kr_wiki_cache_version: '3' });
    const cache = loadClientCache(storage);

    const result = cache.syncWithServer(config);

    expect(result.purged).toBe(false);
    expect(result.reason).toBe('no-server-version');
    expect(storage.getItem('kr_wiki_cache_version')).toBe('3');
    expect(storage.getItem('wiki-tree-space-1')).not.toBeNull();
  });

  test('a second load after a purge is quiet', () => {
    const storage = fakeStorage({ ...POPULATED, kr_wiki_cache_version: '1' });
    const cache = loadClientCache(storage);

    cache.syncWithServer({ clientCacheVersion: '2' });
    const second = cache.syncWithServer({ clientCacheVersion: '2' });

    expect(second.purged).toBe(false);
    expect(second.reason).toBe('match');
  });

  test('nothing cached to clear reports no purge, so the user is not told', () => {
    const storage = fakeStorage({ kr_wiki_cache_version: '1' });
    const cache = loadClientCache(storage);

    const result = cache.syncWithServer({ clientCacheVersion: '2' });

    expect(result.reason).toBe('version-changed');
    expect(result.purged).toBe(false);
    expect(storage.getItem('kr_wiki_cache_version')).toBe('2');
  });
});

/* ==========================================================================
 * The server half
 * ========================================================================== */

describe('featureFlags — client cache version', () => {
  const GROUP = featureFlags.GROUP;
  const KEY = featureFlags.CLIENT_CACHE_VERSION_KEY;

  test('is published on the client config alongside the boolean flags', async () => {
    const settings = fakeSettings({ [`${GROUP}::${KEY}`]: '1760000000000' });

    const config = await featureFlags.readFlags(settings);

    expect(config.clientCacheVersion).toBe('1760000000000');
    expect(config.aiChatEnabled).toBe(true);      // untouched default
    expect(config.editingEnabled).toBe(true);
  });

  test('falls back to the default rather than a blank epoch', async () => {
    // Blank is the dangerous value: it would differ from every recorded stamp on
    // the first load and match on the next — one silent purge for everybody.
    for (const stored of [undefined, '', '   ']) {
      const settings = fakeSettings(
        stored === undefined ? {} : { [`${GROUP}::${KEY}`]: stored }
      );
      expect(await featureFlags.readClientCacheVersion(settings)).toBe('1');
    }
  });

  test('coerces a number typed into the admin screen', async () => {
    const settings = fakeSettings({ [`${GROUP}::${KEY}`]: 42 });
    expect(await featureFlags.readClientCacheVersion(settings)).toBe('42');
  });

  test('an unreadable store degrades to the default instead of throwing', async () => {
    const broken = { get: async () => { throw new Error('store is corrupt'); } };
    const warn = jest.fn();

    await expect(featureFlags.readClientCacheVersion(broken, { warn })).resolves.toBe('1');
    await expect(featureFlags.readFlags(broken, { warn })).resolves.toMatchObject({
      aiChatEnabled: true,
      clientCacheVersion: '1'
    });
    expect(warn).toHaveBeenCalled();
  });

  test('is seeded with its string type so the Settings screen can show it', async () => {
    const settings = fakeSettings();

    const created = await featureFlags.ensureDefaults(settings);

    expect(created).toContain(KEY);
    expect(await settings.get(KEY, GROUP)).toBe('1');
    expect(settings.meta.get(`${GROUP}::${KEY}`)).toMatchObject({ type: 'string' });
    // The booleans keep their own type — one shared literal would mislabel them.
    expect(settings.meta.get(`${GROUP}::aiChatEnabled`)).toMatchObject({ type: 'boolean' });
  });

  test('seeding never overwrites an admin\'s value', async () => {
    const settings = fakeSettings({ [`${GROUP}::${KEY}`]: '1760000000000' });

    const created = await featureFlags.ensureDefaults(settings);

    expect(created).not.toContain(KEY);
    expect(await settings.get(KEY, GROUP)).toBe('1760000000000');
  });

  test('a bump always lands on a different value', async () => {
    const settings = fakeSettings({ [`${GROUP}::${KEY}`]: '1' });

    const next = await featureFlags.bumpClientCacheVersion(settings);

    expect(next).not.toBe('1');
    expect(await settings.get(KEY, GROUP)).toBe(next);
    expect(settings.meta.get(`${GROUP}::${KEY}`)).toMatchObject({ type: 'string' });
  });

  test('a bump reaches the client as the new epoch', async () => {
    const settings = fakeSettings();
    const next = await featureFlags.bumpClientCacheVersion(settings);

    const config = await featureFlags.readFlags(settings);
    const storage = fakeStorage({ ...POPULATED, kr_wiki_cache_version: '1' });
    const cache = loadClientCache(storage);

    expect(cache.syncWithServer(config).purged).toBe(true);
    expect(storage.getItem('kr_wiki_cache_version')).toBe(next);
  });

  test('bumping without a settings service fails loudly, not silently', async () => {
    await expect(featureFlags.bumpClientCacheVersion(null))
      .rejects.toThrow(/Settings service unavailable/);
  });
});
