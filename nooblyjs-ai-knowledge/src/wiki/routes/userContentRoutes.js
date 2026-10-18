/**
 * @fileoverview User-content ("Add Content") routes.
 *
 * User-content blocks are inline ```user-content``` blocks anchored to a Target
 * (text / section / table / row) and written into the source markdown — the
 * same "contribution, not edit" model as annotations (see annotationRoutes.js):
 * any authenticated user may add content, the write goes through this dedicated
 * API rather than the content editor (which is hidden for system-owned docs),
 * and only the author can later edit or delete their own contribution.
 *
 *   POST   /applications/wiki/api/user-content   — create   { spaceName, path, target, content }
 *   PATCH  /applications/wiki/api/user-content   — edit own { spaceName, path, id, content }
 *   DELETE /applications/wiki/api/user-content   — delete own { spaceName, path, id }
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-07-12
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const U = require('../components/userContentBlocks');
const { writeContentCache } = require('../utils/documentContentCache');

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

    /** Shared post-write side effects: refresh cache + emit a change event. */
    async function afterWrite(spaceName, documentPath, absolutePath, space, updated) {
        if (cache) {
            try { await writeContentCache(cache, `${spaceName}-${documentPath}`, updated, await fs.stat(absolutePath)); }
            catch (e) { log.warn('[UserContent] cache update failed:', e.message); }
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
            } catch (e) { log.warn('[UserContent] event emit failed:', e.message); }
        }
    }

    const errStatus = (err) => err.message === 'Space not found' ? 404
        : err.message?.startsWith('Access denied') ? 403 : 500;

    /**
     * POST — create a user-content contribution anchored to a Target.
     * Body: { spaceName, path, target: { kind, ... }, content }
     */
    app.post('/applications/wiki/api/user-content', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, target, content } = req.body || {};
            if (!spaceName || !documentPath) return res.status(400).json({ success: false, error: 'spaceName and path are required' });
            if (!target || !target.kind) return res.status(400).json({ success: false, error: 'target.kind is required' });
            if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ success: false, error: 'content is required' });
            if (!isMarkdown(documentPath)) return res.status(400).json({ success: false, error: 'Add Content is only supported on markdown files' });

            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);
            let original;
            try { original = await fs.readFile(absolutePath, 'utf8'); }
            catch (err) { if (err.code === 'ENOENT') return res.status(404).json({ success: false, error: 'Document not found' }); throw err; }

            const author = userOf(req);
            const ins = U.insertUserContent(original, { target, content: content.trim(), author });
            const { resolved, id } = ins;
            const updated = ins.content;

            await fs.writeFile(absolutePath, updated, 'utf8');
            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            log.info(`[UserContent] ${author} added content to ${spaceName}/${documentPath} (resolved=${resolved})`);
            res.status(201).json({ success: true, id, resolved, content: updated });
        } catch (err) {
            log.error('[UserContent] POST failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    /**
     * PATCH — edit your own contribution's prose.
     * Body: { spaceName, path, id, content }
     */
    app.patch('/applications/wiki/api/user-content', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, id, content } = req.body || {};
            if (!spaceName || !documentPath || !id) return res.status(400).json({ success: false, error: 'spaceName, path and id are required' });
            if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ success: false, error: 'content is required' });

            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);
            const original = await fs.readFile(absolutePath, 'utf8');

            const entry = U.findUserContentById(original, id);
            if (!entry) return res.status(404).json({ success: false, error: 'Contribution not found' });
            const requester = userOf(req);
            if (String(entry.author).toLowerCase() !== String(requester).toLowerCase()) {
                return res.status(403).json({ success: false, error: 'Only the author can edit this content' });
            }

            const updated = U.updateUserContentById(original, id, { content: content.trim() });
            await fs.writeFile(absolutePath, updated, 'utf8');
            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            res.json({ success: true, content: updated });
        } catch (err) {
            log.error('[UserContent] PATCH failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE — remove your own contribution.
     * Body: { spaceName, path, id }
     */
    app.delete('/applications/wiki/api/user-content', async (req, res) => {
        try {
            if (!req.isAuthenticated()) return res.status(401).json({ success: false, error: 'Authentication required' });
            const { spaceName, path: documentPath, id } = req.body || {};
            if (!spaceName || !documentPath || !id) return res.status(400).json({ success: false, error: 'spaceName, path and id are required' });

            const requester = userOf(req);
            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);

            let original = '', docMissing = false;
            try { original = await fs.readFile(absolutePath, 'utf8'); }
            catch (err) { if (err.code === 'ENOENT') docMissing = true; else throw err; }

            if (docMissing) return res.json({ success: true, removedFromDocument: false });

            const entry = U.findUserContentById(original, id);
            if (!entry) return res.json({ success: true, removedFromDocument: false });
            if (String(entry.author).toLowerCase() !== String(requester).toLowerCase()) {
                return res.status(403).json({ success: false, error: 'Only the author can delete this content' });
            }

            const updated = U.removeUserContentById(original, id);
            if (updated === null) return res.json({ success: true, removedFromDocument: false });

            await fs.writeFile(absolutePath, updated, 'utf8');
            await afterWrite(spaceName, documentPath, absolutePath, space, updated);
            log.info(`[UserContent] ${requester} deleted content ${id} on ${spaceName}/${documentPath}`);
            res.json({ success: true, removedFromDocument: true, content: updated });
        } catch (err) {
            log.error('[UserContent] DELETE failed:', err);
            res.status(errStatus(err)).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki user-content routes registered');
};
