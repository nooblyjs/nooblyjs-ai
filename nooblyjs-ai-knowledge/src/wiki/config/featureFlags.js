/**
 * @fileoverview Wiki feature flags — the UI toggles the frontends read at load.
 *
 * These used to be `.env` variables (`WIKI_AI_CHAT_ENABLED`,
 * `WIKI_EDITING_ENABLED`), which meant a redeploy to change one. They now live in
 * the CORE settings service — the encrypted grouped key/value store behind the
 * datasources **Settings** screen — so an admin flips them at runtime and the
 * next page load picks the change up.
 *
 * The store caches its decrypted document in memory after the first read and
 * `set()` mutates that cache, so reading a flag per request costs nothing and is
 * always current. `process.env` is NOT consulted: one source of truth.
 *
 * `ensureDefaults()` runs at startup so the keys EXIST in the store, with their
 * type and description attached. That matters: a key the admin screen has never
 * seen cannot be toggled there, so a flag that is only written on first change
 * would be invisible until someone changed it — the exact chicken-and-egg the
 * `.env` move was meant to remove.
 *
 * Not every entry here is a boolean: `clientCacheVersion` is a STRING stamp the
 * browsers compare against their own, and bumping it is how an admin makes 1500
 * clients drop their cached navigation trees without anyone opening devtools.
 * See `src/web/wiki/public/js/modules/clientCache.js` for the client
 * half of that contract.
 *
 * @author noobly Team
 * @version 1.1.0
 */

'use strict';

/** Settings group these flags live under, as shown in the Settings screen. */
const GROUP = 'wiki';

/** Settings key holding the client cache epoch (see `bumpClientCacheVersion`). */
const CLIENT_CACHE_VERSION_KEY = 'clientCacheVersion';

/**
 * The flags, keyed by the name returned to the client.
 * `key` is the settings key inside GROUP; `default` applies when the store has
 * no value (fresh install, or the key was deleted in the UI); `type` picks the
 * coercion applied to whatever the admin screen stored (it round-trips real
 * types, but a value typed into a text box arrives as a string).
 * @type {Array<{name:string, key:string, type:string, default:*, description:string}>}
 */
const FLAGS = [
  {
    name: 'aiChatEnabled',
    key: 'aiChatEnabled',
    type: 'boolean',
    default: true,
    description: 'Show the right-hand AI Assistant chat panel and the robot toggle '
      + 'in the header. Applies to both the web wiki and the Teams wiki.'
  },
  {
    name: 'editingEnabled',
    key: 'editingEnabled',
    type: 'boolean',
    default: true,
    description: 'Allow document editing (Blocks, Markdown and Visualise views). '
      + 'When off, documents stay readable but the Edit controls are disabled.'
  },
  {
    name: 'clientCacheVersion',
    key: CLIENT_CACHE_VERSION_KEY,
    type: 'string',
    default: '1',
    description: 'Client cache epoch. Each browser records the value it last saw; '
      + 'when this changes, it drops its cached navigation trees on the next page '
      + 'load and tells the user. Bump it after a change that makes cached trees '
      + 'wrong. Costs every user one full tree fetch, so do not bump routinely — '
      + 'the tree cache already revalidates itself with ETags.'
  }
];

/**
 * Coerce a stored value to a boolean.
 *
 * The store round-trips real booleans, but a value typed into the admin screen
 * arrives as a string — so "false" must not be truthy. Anything unrecognised
 * falls back to the flag's default rather than silently reading as `false`.
 *
 * @param {*} value - The raw stored value.
 * @param {boolean} fallback - Value to use when nothing usable is stored.
 * @returns {boolean}
 */
function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on', 'enabled'].includes(normalised)) return true;
    if (['false', '0', 'no', 'off', 'disabled'].includes(normalised)) return false;
  }
  return fallback;
}

/**
 * Coerce a stored value to a non-empty string.
 *
 * Blank and whitespace-only are treated as "nothing stored" and fall back to the
 * default — an empty cache epoch would compare unequal to every browser's
 * recorded stamp on the FIRST load and equal on the next, i.e. one silent purge
 * for everybody.
 *
 * @param {*} value - The raw stored value.
 * @param {string} fallback - Value to use when nothing usable is stored.
 * @returns {string}
 */
function toText(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

/** Coerce a stored value according to the flag's declared type. */
function coerce(flag, stored) {
  return flag.type === 'string' ? toText(stored, flag.default) : toBoolean(stored, flag.default);
}

/**
 * Read every flag as the client config object.
 *
 * Never throws: an unreadable settings store degrades to the defaults rather
 * than failing the page load, since this backs a public endpoint the wiki calls
 * before it can render anything.
 *
 * @param {Object} settings - Core settings service instance (may be undefined).
 * @param {Object} [log] - Logger.
 * @returns {Promise<Object>} e.g.
 *   `{ aiChatEnabled: true, editingEnabled: true, clientCacheVersion: '1' }`
 */
async function readFlags(settings, log) {
  const config = {};
  for (const flag of FLAGS) {
    let stored;
    if (settings && typeof settings.get === 'function') {
      try {
        stored = await settings.get(flag.key, GROUP);
      } catch (error) {
        log?.warn(`Wiki feature flags: could not read ${GROUP}.${flag.key} — using default (${error.message})`);
      }
    }
    config[flag.name] = coerce(flag, stored);
  }
  return config;
}

/**
 * Read just the client cache epoch. Same degrade-to-default contract as
 * `readFlags`, so a broken store never purges anyone's caches.
 *
 * @param {Object} settings - Core settings service instance (may be undefined).
 * @param {Object} [log] - Logger.
 * @returns {Promise<string>}
 */
async function readClientCacheVersion(settings, log) {
  const flag = FLAGS.find((f) => f.key === CLIENT_CACHE_VERSION_KEY);
  let stored;
  if (settings && typeof settings.get === 'function') {
    try {
      stored = await settings.get(flag.key, GROUP);
    } catch (error) {
      log?.warn(`Wiki feature flags: could not read ${GROUP}.${flag.key} — using default (${error.message})`);
    }
  }
  return toText(stored, flag.default);
}

/**
 * Bump the client cache epoch to a fresh value, which makes every browser drop
 * its cached navigation trees on its next page load.
 *
 * The new value is a timestamp rather than an incremented counter: it needs to
 * be different from the last one, not ordered, and reading-then-incrementing
 * would race two admins clicking at once into writing the same value — which
 * looks like a successful bump but purges nobody.
 *
 * @param {Object} settings - Core settings service instance.
 * @param {Object} [log] - Logger.
 * @returns {Promise<string>} The value now stored.
 * @throws {Error} When there is no settings service to write to.
 */
async function bumpClientCacheVersion(settings, log) {
  if (!settings || typeof settings.set !== 'function') {
    throw new Error('Settings service unavailable — cannot bump the client cache version');
  }
  const flag = FLAGS.find((f) => f.key === CLIENT_CACHE_VERSION_KEY);
  const next = String(Date.now());
  await settings.set(flag.key, next, GROUP, { type: 'string', description: flag.description });
  log?.info(`[Wiki] Client cache version bumped to ${next} — browsers will drop cached trees on next load`);
  return next;
}

/**
 * Write any flag the store does not yet hold, so all of them are visible and
 * editable in the Settings screen from the first boot. Existing values — an
 * admin's choice — are never overwritten.
 *
 * Best-effort: a failure here leaves the flags on their defaults and must not
 * stop the wiki from starting.
 *
 * @param {Object} settings - Core settings service instance (may be undefined).
 * @param {Object} [log] - Logger.
 * @returns {Promise<Array<string>>} Keys that were created.
 */
async function ensureDefaults(settings, log) {
  if (!settings || typeof settings.set !== 'function') {
    log?.warn('Wiki feature flags: no settings service — flags fall back to their defaults');
    return [];
  }

  const created = [];
  for (const flag of FLAGS) {
    try {
      if (await settings.has(flag.key, GROUP)) continue;
      await settings.set(flag.key, flag.default, GROUP, {
        type: flag.type,
        description: flag.description
      });
      created.push(flag.key);
    } catch (error) {
      log?.warn(`Wiki feature flags: could not seed ${GROUP}.${flag.key} (${error.message})`);
    }
  }

  if (created.length) {
    log?.info(`✓ Wiki feature flags seeded in settings group "${GROUP}": ${created.join(', ')}`);
  }
  return created;
}

module.exports = {
  GROUP,
  FLAGS,
  CLIENT_CACHE_VERSION_KEY,
  readFlags,
  readClientCacheVersion,
  bumpClientCacheVersion,
  ensureDefaults,
  toBoolean,
  toText
};
