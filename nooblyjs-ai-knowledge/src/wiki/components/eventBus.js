/**
 * @fileoverview Centralized Event Bus for Wiki file/folder changes
 * Tracks and broadcasts all file/folder operations (create, update, delete)
 * from both the file watcher and API endpoints to connected Socket.IO clients
 *
 *@author Digital Techonolgies Team
 * @version 1.0.0
 * @since 2025-10-31
 */

'use strict';

const EventEmitter = require('events');
const fs = require('node:fs');
const fsp = require('node:fs').promises;
const path = require('node:path');

/**
 * WikiEventBus - Centralized event management for file/folder changes
 * Normalizes events from multiple sources and broadcasts to Socket.IO clients
 *
 * Persistence: when constructed with `opts.persistenceDir`, every event is
 * appended (fire-and-forget) as one JSON line to a per-day file in that
 * directory, named `event-history-YYYY-MM-DD.jsonl` (UTC, by the event's own
 * timestamp). Rotating daily keeps any single file bounded. On startup the
 * tail across the most recent day-files (up to `maxHistorySize` events) is
 * loaded back so the /applications/wiki/api/changes feed survives a backend
 * restart. Daemons that have been offline longer than the in-memory ring's
 * coverage will receive `truncated: true` from the API and can fall back to a
 * full sync.
 */
class WikiEventBus extends EventEmitter {
  constructor(logger, io, opts = {}) {
    super();
    this.logger = logger;
    this.io = io;
    this.eventHistory = [];
    this.maxHistorySize = opts.maxHistorySize || 1000;
    this.persistenceDir = opts.persistenceDir || null;

    if (this.persistenceDir) {
      try {
        fs.mkdirSync(this.persistenceDir, { recursive: true });
      } catch (err) {
        this.logger.warn(`[WikiEventBus] Could not create persistence dir: ${err.message}`);
      }
      this._loadPersistedHistory();
    }
  }

  /**
   * Path to the per-day JSONL file for a given date (UTC day).
   * @param {Date} [date] - defaults to now
   * @private
   */
  _dailyFilePath(date = new Date()) {
    const day = date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
    return path.join(this.persistenceDir, `event-history-${day}.jsonl`);
  }

  /**
   * Load tail of the persisted JSONL file into the in-memory ring buffer.
   * Synchronous on startup so the bus is ready by the time the route comes up.
   * @private
   */
  _loadPersistedHistory() {
    try {
      const dayFile = /^event-history-\d{4}-\d{2}-\d{2}\.jsonl$/;
      const files = fs.readdirSync(this.persistenceDir)
        .filter(f => dayFile.test(f))
        .sort(); // YYYY-MM-DD sorts chronologically; oldest -> newest

      // Walk newest file backwards, prepending each file's lines, until we have
      // at least maxHistorySize lines (keeps the array chronological), then trim.
      let lines = [];
      for (let i = files.length - 1; i >= 0 && lines.length < this.maxHistorySize; i--) {
        const content = fs.readFileSync(path.join(this.persistenceDir, files[i]), 'utf8');
        const fileLines = content.split('\n').filter(l => l.trim());
        lines = fileLines.concat(lines);
      }
      const tail = lines.slice(-this.maxHistorySize);

      const events = [];
      for (const line of tail) {
        try {
          events.push(JSON.parse(line));
        } catch {
          // Skip malformed line — likely a partial write at a file tail.
        }
      }
      this.eventHistory = events;
      this.logger.info(`[WikiEventBus] Loaded ${events.length} persisted events from ${files.length} day-file(s) in ${this.persistenceDir}`);
    } catch (err) {
      this.logger.warn(`[WikiEventBus] Failed to load persisted history: ${err.message}`);
    }
  }

  /**
   * Append a single event to its day's JSONL file. The file is chosen by the
   * event's own timestamp so an event near midnight lands in the right day.
   * Fire-and-forget so the emit path stays synchronous; failures are logged
   * but don't bubble.
   * @private
   */
  _persistEvent(event) {
    if (!this.persistenceDir) return;
    let date;
    const ts = event && event.event && event.event.timestamp;
    const parsed = ts ? Date.parse(ts) : NaN;
    date = Number.isNaN(parsed) ? new Date() : new Date(parsed);
    fsp.appendFile(this._dailyFilePath(date), JSON.stringify(event) + '\n', 'utf8')
      .catch(err => this.logger.warn(`[WikiEventBus] persistence append failed: ${err.message}`));
  }

  /**
   * Emit a file change event
   * Normalizes event format and broadcasts to all connected clients
   *
   * @param {string} operation - 'create', 'update', or 'delete'
   * @param {string} itemType - 'file' or 'folder'
   * @param {Object} metadata - File/folder metadata
   * @param {number} metadata.spaceId - Space ID
   * @param {string} metadata.spaceName - Space name
   * @param {string} metadata.name - File/folder name
   * @param {string} metadata.path - Relative path from space root
   * @param {string} [metadata.parentPath] - Parent directory path
   * @param {string} [metadata.timestamp] - ISO timestamp
   * @param {number} [metadata.size] - File size in bytes
   * @param {string} [metadata.modified] - Last modified timestamp
   * @param {string} [metadata.created] - Creation timestamp
   * @param {string} [metadata.source] - Event source ('file-watcher' or 'api')
   * @return {void}
   */
  emitChange(operation, itemType, metadata = {}) {
    // Validate inputs
    const validOperations = ['create', 'update', 'delete', 'rename', 'move'];
    const validItemTypes = ['file', 'folder'];

    if (!validOperations.includes(operation)) {
      this.logger.warn(`Invalid operation: ${operation}`);
      return;
    }

    if (!validItemTypes.includes(itemType)) {
      this.logger.warn(`Invalid item type: ${itemType}`);
      return;
    }

    // Normalize event data
    const event = this.normalizeEvent(operation, itemType, metadata);

    // Add to history
    this.addToHistory(event);

    // Log event
    this.logEvent(event);

    // Emit internally (for potential local listeners)
    super.emit('change', event);

    // Broadcast to all connected Socket.IO clients
    if (this.io) {
      this.io.emit('wiki:file-change', event);
    }
  }

  /**
   * Normalize a relative path to POSIX separators ('/').
   *
   * The file watcher derives paths via Node's path.relative(), which returns
   * OS-native separators — backslashes on Windows (e.g. "Technology\\Sell\\x.md").
   * The web/Teams navigation trees (and the folder-tree API) key entirely off
   * '/', so a backslash path makes the client's lastIndexOf('/') / split('/')
   * logic find no parent and dump every watcher-sourced node at the tree ROOT —
   * the "items spilling into the root" bug. A filename can never contain '\' on
   * a real filesystem, so every backslash in these relative paths is a directory
   * separator and is safe to convert. Idempotent for already-POSIX paths (e.g.
   * API-sourced events), so it is safe to run on every event from every source.
   * @private
   */
  toPosixPath(p) {
    return typeof p === 'string' ? p.replace(/\\/g, '/') : p;
  }

  /**
   * Normalize event data into a consistent format
   * @private
   */
  normalizeEvent(operation, itemType, metadata) {
    const timestamp = new Date().toISOString();

    // Normalize all path fields to '/' so every consumer (web nav tree, Teams,
    // the daemon /changes feed, persisted history) sees web-style paths
    // regardless of which OS produced the event.
    const itemPath = this.toPosixPath(metadata.path);

    return {
      // Event metadata
      event: {
        id: this.generateEventId(),
        timestamp: timestamp,
        type: `${itemType}:${operation}`,
        operation: operation, // 'create', 'update', 'delete'
        itemType: itemType,    // 'file', 'folder'
        source: metadata.source || 'unknown' // 'file-watcher' or 'api'
      },

      // Space information
      space: {
        id: metadata.spaceId,
        name: metadata.spaceName
      },

      // Item information
      item: {
        name: metadata.name,
        path: itemPath,
        parentPath: this.toPosixPath(metadata.parentPath || ''),
        type: itemType,
        ...(metadata.size !== undefined && { size: metadata.size }),
        ...(metadata.created && { created: metadata.created }),
        ...(metadata.modified && { modified: metadata.modified }),
        ...(metadata.timestamp && { timestamp: metadata.timestamp }),
        // Rename/move fields
        ...(metadata.oldPath && { oldPath: this.toPosixPath(metadata.oldPath) }),
        ...(metadata.newPath && { newPath: this.toPosixPath(metadata.newPath) }),
        ...(metadata.oldParentPath && { oldParentPath: this.toPosixPath(metadata.oldParentPath) })
      },

      // Additional context
      context: {
        fullPath: `${metadata.spaceName}/${itemPath}`,
        changed: timestamp,
        ...(metadata.userId && { userId: metadata.userId }),
        ...(metadata.userName && { userName: metadata.userName })
      }
    };
  }

  /**
   * Add event to history (with size limit)
   * @private
   */
  addToHistory(event) {
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
    this._persistEvent(event);
  }

  /**
   * Get events newer than a given ISO timestamp, optionally filtered by
   * spaceId. Used by the /applications/wiki/api/changes feed that the
   * daemon polls. `truncated` signals the caller's cursor is older than
   * the oldest event in memory — fall back to a full sync in that case.
   *
   * @param {Object} opts
   * @param {string} [opts.since] - ISO timestamp; events strictly after this
   * @param {(string|number)} [opts.spaceId] - filter to a single space
   * @param {number} [opts.limit] - cap returned event count
   * @return {{events: Array, cursor: string|null, truncated: boolean}}
   */
  getChangesSince(opts = {}) {
    const { since, spaceId, limit = 500 } = opts;
    const sinceMs = since ? Date.parse(since) : 0;
    const oldest = this.eventHistory[0];
    const oldestMs = oldest ? Date.parse(oldest.event.timestamp) : 0;
    const truncated = !!since && oldestMs > 0 && sinceMs < oldestMs;

    let matches = this.eventHistory;
    if (sinceMs) {
      matches = matches.filter(e => Date.parse(e.event.timestamp) > sinceMs);
    }
    if (spaceId !== undefined && spaceId !== null && spaceId !== '') {
      const wanted = String(spaceId);
      matches = matches.filter(e => String(e.space.id) === wanted);
    }
    if (matches.length > limit) {
      matches = matches.slice(-limit);
    }

    const last = matches[matches.length - 1] || this.eventHistory[this.eventHistory.length - 1];
    const cursor = last ? last.event.timestamp : null;
    return { events: matches, cursor, truncated };
  }

  /**
   * Log event with detailed information
   * @private
   */
  logEvent(event) {
    const { operation, itemType, source } = event.event;
    const spaceName = event.space.name;
    const { path } = event.item;
    const spacePath = event.context.fullPath;

    // Log to the logger service for persistence
    const logMessage =
      `[WIKI-EVENT] ${operation.toUpperCase()} ${itemType.toUpperCase()} ` +
      `(${source}) | Space: "${spaceName}" | Path: "${path}" | ` +
      `Full: "${spacePath}"`;

    switch (operation) {
      case 'create':
      case 'update':
      case 'rename':
      case 'move':
        this.logger.info(logMessage);
        break;
      case 'delete':
        this.logger.warn(logMessage);
        break;
      default:
        this.logger.debug(logMessage);
    }
  }

  /**
   * Generate unique event ID
   * @private
   */
  generateEventId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get recent events from history
   * @param {number} limit - Number of recent events to return
   * @return {Array} Array of recent events
   */
  getRecentEvents(limit = 50) {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Get event history statistics
   * @return {Object} Statistics about event history
   */
  getStatistics() {
    const stats = {
      totalEvents: this.eventHistory.length,
      byOperation: { create: 0, update: 0, delete: 0, rename: 0, move: 0 },
      byItemType: { file: 0, folder: 0 },
      bySource: { 'file-watcher': 0, api: 0, unknown: 0 },
      bySpace: {}
    };

    for (const event of this.eventHistory) {
      stats.byOperation[event.event.operation] = (stats.byOperation[event.event.operation] || 0) + 1;
      stats.byItemType[event.event.itemType] = (stats.byItemType[event.event.itemType] || 0) + 1;
      stats.bySource[event.event.source] = (stats.bySource[event.event.source] || 0) + 1;

      const spaceName = event.space.name;
      stats.bySpace[spaceName] = (stats.bySpace[spaceName] || 0) + 1;
    }

    return stats;
  }

  /**
   * Clear event history
   * @return {void}
   */
  clearHistory() {
    this.eventHistory = [];
    this.logger.info('Event history cleared');
  }

  /**
   * Filter events from history
   * @param {Function} predicate - Filter function
   * @return {Array} Filtered events
   */
  filterEvents(predicate) {
    return this.eventHistory.filter(predicate);
  }

  /**
   * Subscribe to events locally
   * Allows backend components to listen for file/folder changes
   * @param {string} eventType - Event type to listen for ('change', or specific 'file:create', 'folder:delete', etc.)
   * @param {Function} callback - Callback function called with event object
   * @return {Function} Unsubscribe function
   */
  subscribe(eventType = 'change', callback) {
    // Subscribe to internal event emitter
    this.on(eventType, callback);

    // Return unsubscribe function
    return () => {
      this.off(eventType, callback);
    };
  }

  /**
   * Get a human-readable summary of event activity
   * @return {Object} Summary of recent activity
   */
  getActivitySummary() {
    const stats = this.getStatistics();
    const recent = this.getRecentEvents(5);

    return {
      stats: stats,
      recentEvents: recent.map(event => ({
        id: event.event.id,
        type: event.event.type,
        timestamp: event.event.timestamp,
        spaceName: event.space.name,
        itemName: event.item.name,
        itemPath: event.item.path,
        source: event.event.source
      }))
    };
  }

  /**
   * Display event summary to console
   * Useful for debugging and monitoring
   * @return {void}
   */
  printSummary() {
    const summary = this.getActivitySummary();

    console.group('%c[WIKI-EVENT-BUS] Activity Summary', 'color: white; background-color: #3F51B5; padding: 4px 8px; border-radius: 3px; font-weight: bold;');

    console.log('%c📊 Statistics:', 'color: #1976D2; font-weight: bold;', summary.stats);

    if (summary.recentEvents.length > 0) {
      console.log('%c🕐 Recent Events:', 'color: #F57C00; font-weight: bold;');
      console.table(summary.recentEvents);
    }

    console.groupEnd();

    return summary;
  }
}

module.exports = WikiEventBus;
