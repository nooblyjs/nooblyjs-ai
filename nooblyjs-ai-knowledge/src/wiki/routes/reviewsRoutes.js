/**
 * @fileoverview Document review routes.
 *
 * Reviews are recorded inline in a document's markdown, in a single
 * ```reviews``` block (see components/reviewBlocks.js) — the same
 * "contribution, not edit" model as comments/annotations: the write goes
 * through this dedicated API rather than the content editor, and each review is
 * indexed for both participants so it surfaces on their profile / dashboard.
 *
 *   POST   /applications/wiki/api/reviews        — request   { spaceName, path, reviewer }
 *   PATCH  /applications/wiki/api/reviews        — complete  { spaceName, path, id, stars, comment }
 *   DELETE /applications/wiki/api/reviews        — cancel    { spaceName, path, id }
 *   GET    /applications/wiki/api/user/reviews   — caller's reviews (assigned / requested)
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-06-09
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const userContentIndex = require('../components/userContentIndex');
const { writeContentCache } = require('../utils/documentContentCache');
const R = require('../components/reviewBlocks');

/**
 * Resolve a document path within its space, with the same traversal guard
 * documentRoutes/annotationRoutes use. Kept self-contained.
 */
async function resolveDocPath(spaceName, documentPath, appBaseDir) {
    const spacesPath = path.join(appBaseDir || path.join(process.cwd(), '.application'), 'spaces', 'spaces.json');
    const spacesData = await fs.readFile(spacesPath, 'utf8');
    const spaces = JSON.parse(spacesData);
    const space = spaces.find(s => s.name === spaceName);
    if (!space) throw new Error('Space not found');

    let documentsDir, absolutePath;
    if (space.path || space.configuration?.filing?.baseDir) {
        documentsDir = space.path || space.configuration.filing.baseDir;
        absolutePath = path.isAbsolute(documentPath) ? documentPath : path.resolve(documentsDir, documentPath);
    } else {
        documentsDir = path.resolve(__dirname, '../../../documents');
        absolutePath = path.resolve(documentsDir, spaceName, documentPath);
    }

    const normalizedAbs = path.normalize(absolutePath);
    const normalizedDir = path.normalize(documentsDir);
    const relative = path.relative(normalizedDir, normalizedAbs);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Access denied: path outside space directory');
    }
    return { documentsDir: normalizedDir, absolutePath: normalizedAbs, space };
}

module.exports = (options, eventEmitter, services) => {
    const app = options.app;
    const log = services.log || services.logger || console;
    const cache = services.cache;
    const appBaseDir = services.appBaseDir;

    const userOf = (req) => req.user?.email || req.user?.name || 'unknown';
    const isMarkdown = (p) => ['.md', '.markdown'].includes(path.extname(p).toLowerCase());
    const titleOf = (p) => path.basename(p).replace(/\.(md|markdown)$/i, '');
    const eq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

    /** Shared post-write side effects: refresh cache + emit a change event. */
    async function afterWrite(spaceName, documentPath, absolutePath, space, updated) {
        if (cache) {
            try { await writeContentCache(cache, `${spaceName}-${documentPath}`, updated, await fs.stat(absolutePath)); }
            catch (e) { log.warn('[Reviews] cache update failed:', e.message); }
        }
        if (global.eventBus) {
            try {
                const stats = await fs.stat(absolutePath);
                global.eventBus.emitChange('update', 'file', {
                    spaceId: space?.id || null,
                    spaceName,
                    name: path.basename(documentPath),
                    path: documentPath,
                    modified: stats.mtime.toISOString(),
                    size: stats.size,
                    source: 'api'
                });
            } catch (e) { log.warn('[Reviews] event emit failed:', e.message); }
        }
    }

    /** Index this review for both participants (their own side tagged by `role`). */
    async function indexBoth(entry, spaceName, documentPath) {
        const base = {
            id: entry.id, spaceName, path: documentPath, title: titleOf(documentPath),
            requested: entry.requested, reviewer: entry.reviewer, status: entry.review,
            stars: entry.stars || '', startdate: entry.startdate || '', enddate: entry.enddate || ''
        };
        try { await userContentIndex.recordReview(appBaseDir, spaceName, entry.reviewer, { ...base, role: 'reviewer' }); }
        catch (e) { log.warn('[Reviews] reviewer index update failed:', e.message); }
        try { await userContentIndex.recordReview(appBaseDir, spaceName, entry.requested, { ...base, role: 'requestor' }); }
        catch (e) { log.warn('[Reviews] requestor index update failed:', e.message); }
    }

    const errStatus = (err) => err.message === 'Space not found' ? 404
        : err.message?.startsWith('Access denied') ? 403 : 500;

    /**
     * POST — request a review from `reviewer`.
     * Body: { spaceName, path, reviewer }
     */
    app.post('/applications/wiki/api/reviews', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, reviewer } = req.body || {};
            if (!spaceName || !documentPath) return res.status(400).json({ success: false, error: 'spaceName and path are required' });
            if (typeof reviewer !== 'string' || !reviewer.trim()) return res.status(400).json({ success: false, error: 'reviewer is required' });
            if (!isMarkdown(documentPath)) return res.status(400).json({ success: false, error: 'Reviews are only supported on markdown files' });

            const requested = userOf(req);
            const reviewerEmail = reviewer.trim();

            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);
            let original;
            try { original = await fs.readFile(absolutePath, 'utf8'); }
            catch (err) { if (err.code === 'ENOENT') return res.status(404).json({ success: false, error: 'Document not found' }); throw err; }

            // Don't open a second in-progress review for the same reviewer.
            if (R.activeReviewFor(original, reviewerEmail)) {
                return res.status(409).json({ success: false, error: `${reviewerEmail} already has a review in progress for this page` });
            }

            const entry = {
                review: 'inprogress', requested, reviewer: reviewerEmail,
                annotations: '', stars: '', comment: '', startdate: R.today(), enddate: ''
            };
            const { content: updated, id } = R.addReview(original, entry);
            await fs.writeFile(absolutePath, updated, 'utf8');

            await indexBoth({ ...entry, id }, spaceName, documentPath);
            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            log.info(`[Reviews] ${requested} requested review from ${reviewerEmail} on ${spaceName}/${documentPath}`);
            res.status(201).json({ success: true, id, content: updated });
        } catch (err) {
            log.error('[Reviews] POST failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    /**
     * PATCH — complete a review (reviewer only) with a star rating + comment.
     * Body: { spaceName, path, id, stars, comment }
     */
    app.patch('/applications/wiki/api/reviews', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, id, stars, comment } = req.body || {};
            if (!spaceName || !documentPath || !id) return res.status(400).json({ success: false, error: 'spaceName, path and id are required' });
            const starN = parseInt(stars, 10);
            if (!Number.isInteger(starN) || starN < 1 || starN > 5) return res.status(400).json({ success: false, error: 'stars must be an integer 1–5' });

            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);
            const original = await fs.readFile(absolutePath, 'utf8');

            const entry = R.findReviewById(original, id);
            if (!entry) return res.status(404).json({ success: false, error: 'Review not found' });
            const requester = userOf(req);
            if (!eq(entry.reviewer, requester)) {
                return res.status(403).json({ success: false, error: 'Only the assigned reviewer can complete this review' });
            }

            const enddate = R.today();
            const fields = { review: 'complete', stars: String(starN), comment: String(comment || '').trim(), enddate };
            const updated = R.updateReviewById(original, id, fields);
            await fs.writeFile(absolutePath, updated, 'utf8');

            const idxFields = { status: 'complete', stars: String(starN), enddate };
            try { await userContentIndex.updateReview(appBaseDir, spaceName, entry.reviewer, id, idxFields); } catch (e) { log.warn('[Reviews] index update failed:', e.message); }
            try { await userContentIndex.updateReview(appBaseDir, spaceName, entry.requested, id, idxFields); } catch (e) { log.warn('[Reviews] index update failed:', e.message); }

            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            log.info(`[Reviews] ${requester} completed review ${id} (${starN}★) on ${spaceName}/${documentPath}`);
            res.json({ success: true, content: updated });
        } catch (err) {
            log.error('[Reviews] PATCH failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE — cancel a review request (requestor or reviewer).
     * Body: { spaceName, path, id }
     */
    app.delete('/applications/wiki/api/reviews', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, id } = req.body || {};
            if (!spaceName || !documentPath || !id) return res.status(400).json({ success: false, error: 'spaceName, path and id are required' });

            const requester = userOf(req);
            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);

            let original = '', docMissing = false;
            try { original = await fs.readFile(absolutePath, 'utf8'); }
            catch (err) { if (err.code === 'ENOENT') docMissing = true; else throw err; }

            const entry = docMissing ? null : R.findReviewById(original, id);
            if (entry && !eq(entry.reviewer, requester) && !eq(entry.requested, requester)) {
                return res.status(403).json({ success: false, error: 'Only the requestor or reviewer can cancel this review' });
            }

            // Always drop from both indexes so profiles stay consistent.
            if (entry) {
                try { await userContentIndex.removeReview(appBaseDir, spaceName, entry.reviewer, { id }); } catch (e) { log.warn('[Reviews] index remove failed:', e.message); }
                try { await userContentIndex.removeReview(appBaseDir, spaceName, entry.requested, { id }); } catch (e) { log.warn('[Reviews] index remove failed:', e.message); }
            } else {
                try { await userContentIndex.removeReview(appBaseDir, spaceName, requester, { id }); } catch (e) { log.warn('[Reviews] index remove failed:', e.message); }
            }

            if (docMissing || !entry) return res.json({ success: true, removedFromDocument: false });

            const updated = R.removeReviewById(original, id);
            if (updated === null) return res.json({ success: true, removedFromDocument: false });

            await fs.writeFile(absolutePath, updated, 'utf8');
            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            log.info(`[Reviews] ${requester} cancelled review ${id} on ${spaceName}/${documentPath}`);
            res.json({ success: true, removedFromDocument: true, content: updated });
        } catch (err) {
            log.error('[Reviews] DELETE failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    /** GET — the caller's reviews, split into assigned-to-me and requested-by-me. */
    app.get('/applications/wiki/api/user/reviews', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const spaceName = req.query.space || req.query.spaceName;
            const data = await userContentIndex.read(appBaseDir, spaceName, userOf(req));
            const reviews = data.reviews || [];
            res.json({
                success: true,
                reviews: {
                    assignedToMe: reviews.filter(r => r.role === 'reviewer'),
                    requestedByMe: reviews.filter(r => r.role === 'requestor')
                }
            });
        } catch (err) {
            log.error('[Reviews] GET /user/reviews failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki review routes registered');
};
