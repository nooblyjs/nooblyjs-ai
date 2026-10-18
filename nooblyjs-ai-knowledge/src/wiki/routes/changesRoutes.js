/**
 * @fileoverview Wiki Changes Feed Route
 *
 * Exposes the persisted file/folder change history so external sync clients
 * (notably the wiki daemon at applications/daemon/wiki) can poll for what
 * changed since their last cursor instead of crawling every file in the
 * space on every tick.
 *
 * GET /applications/wiki/api/changes
 *   ?since=<ISO timestamp>   only events strictly after this time
 *   ?spaceId=<id>            limit to one space
 *   ?limit=<n>               cap returned event count (default 500, max 1000)
 *
 * Response: { success, events: [...], cursor, truncated, hasMore }
 *   - cursor:    pass back as ?since on the next call
 *   - truncated: true means the caller's cursor is older than the oldest
 *                event still in memory; do a full sync and reset cursor
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-14
 */

'use strict';

module.exports = (options, eventEmitter, services) => {
    const app = options.app;
    const log = services.log || services.logger || console;

    app.get('/applications/wiki/api/changes', (req, res) => {
        if (!req.isAuthenticated || !req.isAuthenticated()) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const eventBus = global.eventBus;
        if (!eventBus || typeof eventBus.getChangesSince !== 'function') {
            return res.status(503).json({ success: false, error: 'Event bus not available' });
        }

        const { since, spaceId } = req.query;
        let limit = parseInt(req.query.limit, 10);
        if (!Number.isFinite(limit) || limit <= 0) limit = 500;
        if (limit > 1000) limit = 1000;

        try {
            const result = eventBus.getChangesSince({ since, spaceId, limit });
            res.json({
                success: true,
                events: result.events,
                cursor: result.cursor,
                truncated: result.truncated,
                serverTime: new Date().toISOString()
            });
        } catch (err) {
            log.error('[Changes] feed error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki changes feed route registered');
};
