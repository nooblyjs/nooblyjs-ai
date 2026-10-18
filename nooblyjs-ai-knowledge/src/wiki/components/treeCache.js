/**
 * @fileoverview In-memory cache for per-space folder trees.
 * Stores the most recent tree per spaceId with a monotonic ETag. Subscribes to
 * the wiki EventBus and invalidates affected spaces when files/folders change.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-14
 */

'use strict';

class TreeCache {
    constructor({ logger } = {}) {
        this.logger = logger || console;
        this.entries = new Map(); // spaceId -> { tree, etag, builtAt }
        this.versions = new Map(); // spaceId -> monotonic counter
    }

    nextEtag(spaceId) {
        const v = (this.versions.get(spaceId) || 0) + 1;
        this.versions.set(spaceId, v);
        return `W/"tree-${spaceId}-${v}"`;
    }

    get(spaceId) {
        return this.entries.get(spaceId) || null;
    }

    /**
     * @param {number} spaceId
     * @param {Array} tree
     * @param {Object} [meta] extra fields describing HOW the tree was built —
     *   `depth` in particular, since a tree walked two levels deep is not an
     *   acceptable answer to a request for a deeper one. Readers compare it
     *   themselves; the cache only carries it.
     */
    set(spaceId, tree, meta = {}) {
        const etag = this.nextEtag(spaceId);
        const entry = { ...meta, tree, etag, builtAt: Date.now() };
        this.entries.set(spaceId, entry);
        return entry;
    }

    invalidate(spaceId) {
        if (this.entries.delete(spaceId)) {
            this.logger.info(`[TreeCache] Invalidated space ${spaceId}`);
        }
        // Bump version even when there was no entry, so a stale client ETag
        // won't accidentally validate against a tree we rebuild later.
        this.nextEtag(spaceId);
    }

    invalidateAll() {
        this.entries.clear();
        this.logger.info('[TreeCache] Invalidated all spaces');
    }

    /**
     * Subscribe to an EventEmitter-style bus that emits 'change' events of the
     * shape produced by wiki/components/eventBus.js.
     */
    attach(eventBus) {
        if (!eventBus || typeof eventBus.on !== 'function') {
            this.logger.warn('[TreeCache] No event bus provided; cache will not auto-invalidate');
            return;
        }
        eventBus.on('change', (event) => {
            const spaceId = event && event.space && event.space.id;
            if (spaceId == null) return;
            this.invalidate(spaceId);
        });
        this.logger.info('[TreeCache] Subscribed to event bus changes');
    }
}

module.exports = TreeCache;
