/**
 * @fileoverview Document annotation routes.
 *
 * Annotations are inline `` ```annotation``` `` blocks anchored to a Target
 * (text / section / table / row) and written into the source markdown — the
 * same "contribution, not edit" model as comments (see commentsRoutes.js):
 * any authenticated user may annotate, the write goes through this dedicated
 * API rather than the content editor, and each annotation is indexed per-user
 * so it surfaces on the author's profile.
 *
 *   POST   /applications/wiki/api/annotations   — create   { spaceName, path, target, annotation }
 *   PATCH  /applications/wiki/api/annotations   — edit own  { spaceName, path, id, annotation }
 *   DELETE /applications/wiki/api/annotations   — delete own{ spaceName, path, id }
 *   GET    /applications/wiki/api/user/annotations — the caller's annotations
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-30
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const userContentIndex = require('../components/userContentIndex');
const A = require('../components/annotationBlocks');
const R = require('../components/reviewBlocks');
const { writeContentCache } = require('../utils/documentContentCache');
const { resolveSpacePath, PATH_HIDDEN } = require('../../shared/spaces/spacePaths');

/**
 * Resolve a document path within its space.
 *
 * Delegates to the shared resolver, which applies BOTH the traversal guard and
 * the space's allowedPaths/excludedPaths filter. This used to be a private copy
 * that did the traversal guard only — so on a shared content root an annotation
 * could be written into a document the caller's space curates away, and the
 * handler's response (which echoes the whole updated document) handed back its
 * full contents. See shared/spaces/spacePaths.js.
 */
async function resolveDocPath(spaceName, documentPath, appBaseDir) {
    return resolveSpacePath({ spaceName, documentPath, appBaseDir });
}

module.exports = (options, eventEmitter, services) => {
    const app = options.app;
    const log = services.log || services.logger || console;
    const cache = services.cache;
    const appBaseDir = services.appBaseDir;

    const userOf = (req) => req.user?.email || req.user?.name || 'unknown';
    const isMarkdown = (p) => ['.md', '.markdown'].includes(path.extname(p).toLowerCase());

    /** Shared post-write side effects: refresh cache + emit a change event. */
    async function afterWrite(spaceName, documentPath, absolutePath, space, updated) {
        if (cache) {
            try {
                await writeContentCache(cache, `${spaceName}-${documentPath}`, updated,
                    await fs.stat(absolutePath));
            } catch (e) { log.warn('[Annotations] cache update failed:', e.message); }
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
            } catch (e) { log.warn('[Annotations] event emit failed:', e.message); }
        }
    }

    // A path the space hides answers 404, never 403 — a 403 would confirm the
    // document exists, which is exactly what a curated space is hiding.
    const errStatus = (err) => err?.code === PATH_HIDDEN ? 404
        : err.message === 'Space not found' ? 404
        : err.message?.startsWith('Access denied') ? 403 : 500;

    /**
     * POST — create an annotation anchored to a Target.
     * Body: { spaceName, path, target: { kind, ... }, annotation }
     */
    app.post('/applications/wiki/api/annotations', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, target, annotation, type } = req.body || {};
            if (!spaceName || !documentPath) return res.status(400).json({ success: false, error: 'spaceName and path are required' });
            if (!target || !target.kind) return res.status(400).json({ success: false, error: 'target.kind is required' });
            if (typeof annotation !== 'string' || !annotation.trim()) return res.status(400).json({ success: false, error: 'annotation is required' });
            if (!isMarkdown(documentPath)) return res.status(400).json({ success: false, error: 'Annotations are only supported on markdown files' });
            const kind = type === 'review' ? 'review' : 'note';

            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);
            let original;
            try { original = await fs.readFile(absolutePath, 'utf8'); }
            catch (err) { if (err.code === 'ENOENT') return res.status(404).json({ success: false, error: 'Document not found' }); throw err; }

            const annotator = userOf(req);
            const date = A.nowStamp();
            const ins = A.insertAnnotation(original, {
                target, type: kind, annotation: annotation.trim(), annotator, date
            });
            const { resolved, id } = ins;
            // A review annotation also bumps the annotations count on the
            // annotator's in-progress review for this page (best-effort).
            let updated = ins.content;
            if (kind === 'review') updated = R.incrementAnnotationCount(updated, annotator);

            await fs.writeFile(absolutePath, updated, 'utf8');

            try {
                await userContentIndex.recordAnnotation(appBaseDir, spaceName, annotator, {
                    id, spaceName, path: documentPath,
                    title: path.basename(documentPath).replace(/\.(md|markdown)$/i, ''),
                    text: annotation.trim(), target: A.buildTarget(target), date
                });
            } catch (e) { log.warn('[Annotations] index update failed:', e.message); }

            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            log.info(`[Annotations] ${annotator} annotated ${spaceName}/${documentPath} (resolved=${resolved})`);
            res.status(201).json({ success: true, id, resolved, content: updated });
        } catch (err) {
            log.error('[Annotations] POST failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    /**
     * PATCH — edit your own annotation's text.
     * Body: { spaceName, path, id, annotation }
     */
    app.patch('/applications/wiki/api/annotations', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, id, annotation } = req.body || {};
            if (!spaceName || !documentPath || !id) return res.status(400).json({ success: false, error: 'spaceName, path and id are required' });
            if (typeof annotation !== 'string' || !annotation.trim()) return res.status(400).json({ success: false, error: 'annotation is required' });

            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);
            const original = await fs.readFile(absolutePath, 'utf8');

            const entry = A.findAnnotationById(original, id);
            if (!entry) return res.status(404).json({ success: false, error: 'Annotation not found' });
            const requester = userOf(req);
            if (String(entry.annotator).toLowerCase() !== String(requester).toLowerCase()) {
                return res.status(403).json({ success: false, error: 'Only the author can edit this annotation' });
            }

            const updated = A.updateAnnotationById(original, id, { annotation: annotation.trim() });
            await fs.writeFile(absolutePath, updated, 'utf8');

            try {
                await userContentIndex.recordAnnotation(appBaseDir, spaceName, requester, {
                    id, spaceName, path: documentPath,
                    title: path.basename(documentPath).replace(/\.(md|markdown)$/i, ''),
                    text: annotation.trim(), target: entry.targetRaw, date: entry.date
                });
            } catch (e) { log.warn('[Annotations] index update failed:', e.message); }

            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            res.json({ success: true, content: updated });
        } catch (err) {
            log.error('[Annotations] PATCH failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE — remove your own annotation.
     * Body: { spaceName, path, id }
     */
    app.delete('/applications/wiki/api/annotations', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, id } = req.body || {};
            if (!spaceName || !documentPath || !id) return res.status(400).json({ success: false, error: 'spaceName, path and id are required' });

            const requester = userOf(req);
            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);

            let original = '', docMissing = false;
            try { original = await fs.readFile(absolutePath, 'utf8'); }
            catch (err) { if (err.code === 'ENOENT') docMissing = true; else throw err; }

            // Always drop from the index so the profile stays consistent.
            await userContentIndex.removeAnnotation(appBaseDir, spaceName, requester, { id, spaceName, path: documentPath });

            if (docMissing) return res.json({ success: true, removedFromDocument: false });

            const entry = A.findAnnotationById(original, id);
            if (!entry) return res.json({ success: true, removedFromDocument: false });
            if (String(entry.annotator).toLowerCase() !== String(requester).toLowerCase()) {
                // TODO(phase 2): allow the document owner to moderate others' annotations.
                return res.status(403).json({ success: false, error: 'Only the author can delete this annotation' });
            }

            const updated = A.removeAnnotationById(original, id);
            if (updated === null) return res.json({ success: true, removedFromDocument: false });

            await fs.writeFile(absolutePath, updated, 'utf8');
            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            log.info(`[Annotations] ${requester} deleted annotation ${id} on ${spaceName}/${documentPath}`);
            res.json({ success: true, removedFromDocument: true, content: updated });
        } catch (err) {
            log.error('[Annotations] DELETE failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    /** GET — the caller's annotations, for the profile screen. */
    app.get('/applications/wiki/api/user/annotations', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const spaceName = req.query.space || req.query.spaceName;
            const data = await userContentIndex.read(appBaseDir, spaceName, userOf(req));
            res.json({ success: true, annotations: data.annotations });
        } catch (err) {
            log.error('[Annotations] GET /user/annotations failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki annotation routes registered');
};
