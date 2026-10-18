/**
 * @fileoverview NotificationManager
 * Manages subscriptions, notification history, and preferences for wiki document
 * change notifications. Everything is space-scoped: held in memory keyed by
 * (spaceName, user) and persisted per-user inside each space's content repo via
 * spaceUserStore:
 *   <space.path>/.useractivity/<prefix>/{subscriptions,notifications,notification-preferences}.json
 *
 * Topics are space-aware (`<spaceName>::<type>:<path>`) so a change to a path in
 * one space never notifies a subscriber of the same path in another space.
 *
 * @author noobly Team
 * @since 2026-04-08
 */

'use strict';

const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const userStore = require('./userStore');
const spaceUserStore = require('./spaceUserStore');

// A NUL separator, written as an ESCAPE. It used to be a literal NUL byte in
// this source file, which made git treat the whole module as binary (no
// reviewable diffs, only "Bin 17495 -> 18625 bytes") and made ripgrep skip it,
// so a log line in here could not be found by searching for it. Same runtime
// value; do not paste the raw character back.
const KEYSEP = '\0';

/**
 * The identity to key a user's in-memory records by.
 *
 * THE FOLDER NAME IS NOT AN IDENTITY. `userStore.userDir()` sanitises an email
 * down to its local-part, so `admin@localhost` lives in `admin/` — the mapping
 * is one-way and the folder name cannot be turned back into the identity the
 * rest of the system uses (`req.user.email`). The loader used to key by the
 * folder name anyway while `subscribe()` / `addToHistory()` key by the email,
 * which cost two things:
 *
 *   1. Loaded history was filed under `admin` and looked up under
 *      `admin@localhost` — so a user's own history read back empty.
 *   2. Both keys reached the writer and both resolve to ONE file, so they wrote
 *      it twice per sync in Set order and an empty record could land on top of
 *      a full one.
 *
 * So: take the identity out of the RECORDS, which carry the real one, and fall
 * back to the folder name only when nothing on disk names it.
 *
 * @param {Array<Object|null>} candidates records that may carry a `userId`
 * @param {string} fallback the folder name
 * @return {string}
 */
function resolveIdentity(candidates, fallback) {
  const ids = candidates
    .filter(Boolean)
    .map(c => (typeof c.userId === 'string' ? c.userId.trim() : ''))
    .filter(Boolean);
  // An email is the identity every runtime caller uses; prefer it over a
  // legacy record stamped with the folder name.
  return ids.find(id => id.includes('@')) || ids[0] || fallback;
}

/**
 * Collapse write keys that resolve to the SAME FILE, keeping the richest.
 *
 * TWO WAYS distinct keys land on one path, and both happen here in production:
 *
 *   - IDENTITY: `admin` (from a legacy file) and `admin@localhost` (from the
 *     runtime) both map to the `admin/` folder.
 *   - SPACE: a stale `spaceName` on a record resolves to no space, and
 *     `spaceUserStore` then falls back to the default space — whose content
 *     root is very often the same directory the live name resolves to. (Four
 *     of this deployment's spaces are views of one root, so this is normal
 *     rather than exotic.)
 *
 * Left alone, both keys get written in Set-iteration order and an EMPTY record
 * can land on top of a full one. Keying by the resolved directory removes the
 * order dependence entirely.
 *
 * @param {string} appBaseDir
 * @param {Array<{spaceName: string, userId: string, payload: *, weight: number}>} entries
 * @return {Promise<Array>} one entry per file, richest wins
 */
async function collapseByFile(appBaseDir, entries) {
  const dirCache = new Map();
  const resolveDir = async (spaceName) => {
    if (dirCache.has(spaceName)) return dirCache.get(spaceName);
    let dir;
    try {
      dir = await spaceUserStore.resolveSpaceDir(appBaseDir, spaceName);
    } catch {
      // No spaces configured / no content path — fall back to the raw name so
      // a resolution failure can't merge two genuinely different targets.
      dir = `?${spaceName}`;
    }
    dirCache.set(spaceName, dir);
    return dir;
  };

  const byFile = new Map();
  for (const entry of entries) {
    const file = `${await resolveDir(entry.spaceName)}${KEYSEP}${userStore.userDir(entry.userId)}`;
    const existing = byFile.get(file);
    if (!existing || entry.weight > existing.weight) byFile.set(file, entry);
  }
  return [...byFile.values()];
}

class NotificationManager {
  /**
   * @param {Object} filing - Filing service (reserved for future use)
   * @param {Object} log - Logger
   * @param {string} appBaseDir - Base data directory
   * @param {Object} notifying - Core notifying (pub/sub) service.
   * @param {Function} deliver - deliver(userId, payload) — pushes to one user.
   */
  constructor(filing, log, appBaseDir, notifying, deliver) {
    this.filing = filing;
    this.log = log;
    this.appBaseDir = appBaseDir;
    this.notifying = notifying;
    this.deliver = typeof deliver === 'function' ? deliver : () => {};

    // In-memory data store (all space-scoped).
    this.subscriptions = [];   // [{ id, userId, spaceName, type, path, createdAt }]
    this.history = {};         // { spaceName: { userId: [notifications] } }
    this.preferences = {};     // { spaceName: { userId: prefsObject } }

    // `${spaceName}\0${userId}` keys previously written, so emptied files get
    // rewritten rather than left stale.
    this._subKeys = new Set();
    this._histKeys = new Set();
    this._prefKeys = new Set();

    // Core-service callbacks keyed by subscription id.
    this.callbacks = new Map();

    this.syncInterval = null;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Initialize — load every space's per-user files and start the sync timer.
   *
   * FAILURES ARE ISOLATED TO ONE USER. This used to be a single try/catch around
   * the whole walk, so anything thrown while reading one person's file in one
   * space discarded EVERY space's subscriptions, skipped `_registerCoreCallback`
   * for all of them, and never reached `startSync()` — notifications were then
   * silently dead until the next restart, reported only as "starting fresh:
   * Unexpected end of JSON input". (The trigger was a zero-byte
   * notifications.json; `userStore.readJson` no longer throws on that, but the
   * containment matters regardless of which read fails.)
   */
  async initialize() {
    this.subscriptions = [];
    this.history = {};
    this.preferences = {};
    this._subKeys = new Set();
    this._histKeys = new Set();
    this._prefKeys = new Set();

    let skipped = 0;

    // SEVERAL SPACES COMMONLY SHARE ONE CONTENT ROOT — four of them do here —
    // so this walk opens the SAME subscriptions.json once per space. Pushing
    // what it reads every time multiplied every subscription by the number of
    // spaces, and the next 30-second sync wrote the multiplied array straight
    // back: the file grew FOUR-FOLD ON EVERY BOOT (observed at 1024 records for
    // one real subscription). Dedupe on the subscription's own id, falling back
    // to its content when a legacy record has none.
    const seenSubs = new Set();
    const subIdentity = (sub) => (
      sub && sub.id
        ? `id:${sub.id}`
        : `sig:${sub && sub.userId}|${sub && sub.spaceName}|${sub && sub.type}|${sub && sub.path}`
    );

    try {
      let spaces = [];
      try { spaces = await spaceUserStore.loadSpaces(this.appBaseDir); } catch { spaces = []; }

      for (const space of spaces) {
        const spaceName = space.name;
        const dir = spaceUserStore.spaceContentDir(space);
        if (!spaceName || !dir) continue;

        const activityRoot = path.join(dir, userStore.ROOT);
        let userDirs = [];
        try { userDirs = await fs.readdir(activityRoot, { withFileTypes: true }); } catch { userDirs = []; }

        for (const entry of userDirs) {
          if (!entry.isDirectory()) continue;
          const prefix = entry.name;

          try {
            // All three first: the identity is whichever of them names it, and
            // every bucket below has to agree on that one answer.
            const subs = await spaceUserStore.readJson(this.appBaseDir, spaceName, prefix, 'subscriptions.json', []);
            const hist = await spaceUserStore.readJson(this.appBaseDir, spaceName, prefix, 'notifications.json', null);
            const prefs = await spaceUserStore.readJson(this.appBaseDir, spaceName, prefix, 'notification-preferences.json', null);

            const identity = resolveIdentity(
              [...(Array.isArray(subs) ? subs : []), hist, prefs],
              prefix
            );
            const key = `${spaceName}${KEYSEP}${identity}`;

            if (Array.isArray(subs) && subs.length) {
              for (const s of subs) {
                if (!s || typeof s !== 'object') continue;
                const dedupeKey = subIdentity(s);
                if (seenSubs.has(dedupeKey)) continue;   // same file, another space
                seenSubs.add(dedupeKey);
                s.spaceName = s.spaceName || spaceName;
                this.subscriptions.push(s);
              }
              this._subKeys.add(key);
            }

            if (hist && Array.isArray(hist.notifications)) {
              (this.history[spaceName] = this.history[spaceName] || {})[identity] = hist.notifications;
            }
            // Tracked even when the file was missing, empty or unreadable:
            // _saveHistoryPerSpace only rewrites keys it knows about, so a
            // zero-byte notifications.json would never be replaced and would
            // warn on every boot forever. One empty write repairs it.
            this._histKeys.add(key);

            if (prefs && prefs.preferences && typeof prefs.preferences === 'object') {
              (this.preferences[spaceName] = this.preferences[spaceName] || {})[identity] = prefs.preferences;
              this._prefKeys.add(key);
            }
          } catch (err) {
            skipped++;
            // Name the user and space — the old message named neither, which is
            // what made a single bad file expensive to find.
            this.log.warn('NotificationManager: skipping user activity', {
              space: spaceName, user: prefix, error: err.message
            });
          }
        }
      }
    } catch (err) {
      this.log.error('NotificationManager: could not enumerate spaces', { error: err.message });
    }

    this.log.info('NotificationManager initialized', {
      subscriptions: this.subscriptions.length,
      spaces: Object.keys(this.history).length,
      skippedUsers: skipped
    });

    for (const sub of this.subscriptions) {
      try { this._registerCoreCallback(sub); }
      catch (e) { this.log.warn('Failed to register core callback for subscription', { sub, error: e.message }); }
    }

    // Outside the try: the periodic flush must start even after a bad load, or
    // nothing written during this process's lifetime ever reaches disk.
    this.startSync();
  }

  startSync() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(async () => {
      try { await this._syncToDisk(); }
      catch (err) { this.log.error('Failed to sync notifications to disk:', err.message); }
    }, 30000);
  }

  stopSync() {
    if (this.syncInterval) { clearInterval(this.syncInterval); this.syncInterval = null; }
  }

  // --------------------------------------------------------------------------
  // Subscriptions (space-scoped)
  // --------------------------------------------------------------------------

  /**
   * Subscribe a user to a document or folder within a space.
   * @param {string} userId
   * @param {string} spaceName
   * @param {string} type - 'document' | 'folder'
   * @param {string} filePath
   */
  async subscribe(userId, spaceName, type, filePath) {
    try {
      if (!userId || !spaceName || !type || !filePath) {
        throw new Error(`Missing required fields: userId=${userId}, spaceName=${spaceName}, type=${type}, filePath=${filePath}`);
      }
      if (!['document', 'folder'].includes(type)) throw new Error('Invalid type: ' + type);

      let normalizedPath = filePath;
      if (type === 'folder' && !normalizedPath.endsWith('/')) normalizedPath += '/';

      const exists = this.subscriptions.find(s =>
        s.userId === userId && s.spaceName === spaceName && s.type === type && s.path === normalizedPath);
      if (exists) return exists;

      let subscriptionId;
      try { subscriptionId = uuidv4(); }
      catch (e) { subscriptionId = Date.now().toString(36) + Math.random().toString(36).substr(2); }

      const subscription = { id: subscriptionId, userId, spaceName, type, path: normalizedPath, createdAt: new Date().toISOString() };
      this.subscriptions.push(subscription);
      await this._saveSubscriptions();
      await this._registerCoreCallback(subscription);
      return subscription;
    } catch (error) {
      this.log.error('Error in subscribe method', { error: error.message, userId, spaceName, type, filePath });
      throw error;
    }
  }

  async unsubscribe(userId, spaceName, type, filePath) {
    let normalizedPath = filePath;
    if (type === 'folder' && !normalizedPath.endsWith('/')) normalizedPath += '/';

    const index = this.subscriptions.findIndex(s =>
      s.userId === userId && s.spaceName === spaceName && s.type === type && s.path === normalizedPath);
    if (index === -1) return false;

    const [removed] = this.subscriptions.splice(index, 1);
    await this._saveSubscriptions();
    this._unregisterCoreCallback(removed);
    return true;
  }

  /** All of a user's subscriptions, optionally filtered to one space. */
  async getSubscriptions(userId, spaceName) {
    return this.subscriptions.filter(s =>
      s.userId === userId && (!spaceName || s.spaceName === spaceName));
  }

  async isSubscribed(userId, spaceName, type, filePath) {
    let normalizedPath = filePath;
    if (type === 'folder' && !normalizedPath.endsWith('/')) normalizedPath += '/';
    return this.subscriptions.some(s =>
      s.userId === userId && s.spaceName === spaceName && s.type === type && s.path === normalizedPath);
  }

  // --------------------------------------------------------------------------
  // Publish / topics (space-aware)
  // --------------------------------------------------------------------------

  /**
   * Publish a change to the core notifying service, scoped to its space.
   * @param {string} changedPath
   * @param {Object} notification - { ..., spaceName, spaceId }
   */
  async publishChange(changedPath, notification) {
    if (!this.notifying) return;
    const spaceName = notification && notification.spaceName;
    if (!spaceName) { this.log.warn('publishChange skipped — no spaceName', { changedPath }); return; }

    const normalizedPath = this._normalizePath(changedPath, false);
    const message = { ...notification, path: normalizedPath };
    Object.defineProperty(message, '_deliveredTo', { value: new Set(), enumerable: false });

    for (const topic of this._topicChainFor(spaceName, normalizedPath)) {
      try { await this.notifying.notify(topic, message); }
      catch (err) { this.log.error('Failed to publish change to topic', { topic, error: err.message }); }
    }
  }

  _topicChainFor(spaceName, changedPath) {
    const norm = this._normalizePath(changedPath, false);
    const topics = [`${spaceName}::document:${norm}`];
    const parts = norm.split('/').filter(p => p);
    for (let i = parts.length; i >= 1; i--) {
      topics.push(`${spaceName}::folder:${parts.slice(0, i).join('/')}/`);
    }
    return topics;
  }

  _topicFor(spaceName, type, filePath) {
    return `${spaceName}::${type}:${this._normalizePath(filePath, type === 'folder')}`;
  }

  _normalizePath(filePath, isFolder) {
    let p = String(filePath == null ? '' : filePath).replace(/\\/g, '/');
    p = p.replace(/^\/+/, '');
    if (isFolder && p && !p.endsWith('/')) p += '/';
    return p;
  }

  async _registerCoreCallback(subscription) {
    if (!this.notifying || this.callbacks.has(subscription.id)) return;

    const topic = this._topicFor(subscription.spaceName, subscription.type, subscription.path);
    const userId = subscription.userId;

    const callback = (message) => {
      if (!message || typeof message !== 'object' || typeof message.path !== 'string') return;
      if (message._deliveredTo) {
        if (message._deliveredTo.has(userId)) return;
        message._deliveredTo.add(userId);
      }
      (async () => {
        const { _deliveredTo, ...notification } = message || {};
        await this.addToHistory(userId, notification);
        const unreadCount = await this.getUnreadCount(userId, notification.spaceName);
        this.deliver(userId, { ...notification, userId, unreadCount });
      })().catch((err) => {
        this.log.error('Notification delivery failed', { userId, topic, error: err.message });
      });
    };

    this.callbacks.set(subscription.id, { topic, callback });
    try {
      await this.notifying.subscribe(topic, callback);
    } catch (err) {
      this.callbacks.delete(subscription.id);
      this.log.warn('Core subscribe failed for topic', { topic, userId, error: err.message });
    }
  }

  _unregisterCoreCallback(subscription) {
    if (!subscription) return;
    const entry = this.callbacks.get(subscription.id);
    if (!entry) return;
    try { this.notifying?.unsubscribe(entry.topic, entry.callback); }
    catch (err) { this.log.warn('Core unsubscribe failed', { topic: entry.topic, error: err.message }); }
    this.callbacks.delete(subscription.id);
  }

  // --------------------------------------------------------------------------
  // History (space-scoped: this.history[spaceName][userId])
  // --------------------------------------------------------------------------

  _histBucket(spaceName, create = false) {
    if (create && !this.history[spaceName]) this.history[spaceName] = {};
    return this.history[spaceName] || {};
  }

  /** Add a notification to a user's history in the notification's space. */
  async addToHistory(userId, notification) {
    const spaceName = notification.spaceName || '__nospace__';
    const bucket = this._histBucket(spaceName, true);
    if (!bucket[userId]) bucket[userId] = [];

    const prefs = await this.getPreferences(userId, spaceName);
    const maxHistory = prefs.maxHistory || 100;

    const notifWithId = { id: uuidv4(), ...notification, read: false, addedAt: new Date().toISOString() };
    bucket[userId].unshift(notifWithId);
    if (bucket[userId].length > maxHistory) bucket[userId] = bucket[userId].slice(0, maxHistory);

    await this._saveHistory();
    return notifWithId;
  }

  async getHistory(userId, spaceName, limit = 50) {
    const list = this._histBucket(spaceName)[userId];
    return list ? list.slice(0, limit) : [];
  }

  async getUnreadCount(userId, spaceName) {
    const list = this._histBucket(spaceName)[userId];
    return list ? list.filter(n => !n.read).length : 0;
  }

  async markRead(userId, spaceName, notificationId) {
    const list = this._histBucket(spaceName)[userId];
    if (!list) return false;
    const notif = list.find(n => n.id === notificationId);
    if (!notif) return false;
    notif.read = true;
    await this._saveHistory();
    return true;
  }

  async markAllRead(userId, spaceName) {
    const list = this._histBucket(spaceName)[userId];
    if (!list) return 0;
    let count = 0;
    list.forEach(n => { if (!n.read) { n.read = true; count++; } });
    if (count > 0) await this._saveHistory();
    return count;
  }

  async clearHistory(userId, spaceName) {
    const bucket = this._histBucket(spaceName);
    if (bucket[userId]) { delete bucket[userId]; await this._saveHistory(); }
  }

  // --------------------------------------------------------------------------
  // Preferences (space-scoped: this.preferences[spaceName][userId])
  // --------------------------------------------------------------------------

  async getPreferences(userId, spaceName) {
    return (this.preferences[spaceName] && this.preferences[spaceName][userId]) || { enabled: true, maxHistory: 100 };
  }

  async savePreferences(userId, spaceName, prefs) {
    const defaults = await this.getPreferences(userId, spaceName);
    if (!this.preferences[spaceName]) this.preferences[spaceName] = {};
    this.preferences[spaceName][userId] = { ...defaults, ...prefs };
    await this._savePreferences();
    return this.preferences[spaceName][userId];
  }

  // --------------------------------------------------------------------------
  // Persistence — per (space, user) under <space>/.useractivity/<prefix>/
  // --------------------------------------------------------------------------

  async _syncToDisk() {
    try {
      await this._saveSubscriptionsPerSpace();
      await this._saveHistoryPerSpace();
      await this._savePreferencesPerSpace();
    } catch (err) {
      this.log.error('Failed to sync notifications to disk:', err);
      throw err;
    }
  }

  /**
   * Every (space, user) that must be written this pass: what is in memory now,
   * plus what we wrote last time so a record that has just been emptied is
   * cleared on disk rather than left stale.
   */
  _writeSet(previousKeys, presentKeys) {
    return new Set([...previousKeys, ...presentKeys]);
  }

  async _saveSubscriptionsPerSpace() {
    const byKey = new Map(); // `${spaceName}\0${userId}` -> [subs]
    for (const sub of this.subscriptions) {
      const k = `${sub.spaceName}${KEYSEP}${sub.userId}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(sub);
    }

    const entries = [...this._writeSet(this._subKeys, byKey.keys())].map((k) => {
      const [spaceName, userId] = k.split(KEYSEP);
      const payload = byKey.get(k) || [];
      return { spaceName, userId, payload, weight: payload.length };
    });

    for (const { spaceName, userId, payload } of await collapseByFile(this.appBaseDir, entries)) {
      await spaceUserStore.writeJson(this.appBaseDir, spaceName, userId, 'subscriptions.json', payload);
    }
    this._subKeys = new Set(byKey.keys());
  }

  async _saveHistoryPerSpace() {
    const present = new Set();
    for (const spaceName of Object.keys(this.history)) {
      for (const userId of Object.keys(this.history[spaceName])) {
        present.add(`${spaceName}${KEYSEP}${userId}`);
      }
    }

    const entries = [...this._writeSet(this._histKeys, present)].map((k) => {
      const [spaceName, userId] = k.split(KEYSEP);
      const list = (this.history[spaceName] && this.history[spaceName][userId]) || [];
      return { spaceName, userId, payload: { userId, notifications: list }, weight: list.length };
    });

    for (const { spaceName, userId, payload } of await collapseByFile(this.appBaseDir, entries)) {
      await spaceUserStore.writeJson(this.appBaseDir, spaceName, userId, 'notifications.json', payload);
    }
    this._histKeys = present;
  }

  async _savePreferencesPerSpace() {
    const present = new Set();
    for (const spaceName of Object.keys(this.preferences)) {
      for (const userId of Object.keys(this.preferences[spaceName])) {
        present.add(`${spaceName}${KEYSEP}${userId}`);
      }
    }

    const entries = [...this._writeSet(this._prefKeys, present)].map((k) => {
      const [spaceName, userId] = k.split(KEYSEP);
      const p = (this.preferences[spaceName] && this.preferences[spaceName][userId]) || {};
      return { spaceName, userId, payload: { userId, preferences: p }, weight: Object.keys(p).length };
    });

    for (const { spaceName, userId, payload } of await collapseByFile(this.appBaseDir, entries)) {
      await spaceUserStore.writeJson(this.appBaseDir, spaceName, userId, 'notification-preferences.json', payload);
    }
    this._prefKeys = present;
  }

  async _saveSubscriptions() {
    try { await this._syncToDisk(); }
    catch (err) { this.log.error('Failed to save subscriptions:', err); throw err; }
  }

  async _saveHistory() {
    try { await this._syncToDisk(); }
    catch (err) { this.log.error('Failed to save notification history:', err); throw err; }
  }

  async _savePreferences() {
    try { await this._syncToDisk(); }
    catch (err) { this.log.error('Failed to save preferences:', err); throw err; }
  }
}

module.exports = NotificationManager;
