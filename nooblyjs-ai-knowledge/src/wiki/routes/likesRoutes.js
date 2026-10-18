/**
 * @fileoverview Document likes routes
 *
 * Likes are stored inline in the source markdown inside a fenced
 * ```liked``` block. Each entry is one line:
 *
 *   2026-05-14T09:00:00.000Z  user-email@example.com
 *
 * POSTing toggles the current user's like — adds their email if absent,
 * removes it if present. Likes are versioned alongside the document,
 * same model as comments and SharedLinkVisits.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-14
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const userContentIndex = require('../components/userContentIndex');
const { writeContentCache } = require('../utils/documentContentCache');

const FENCE_RE = /(```liked\s*\n)([\s\S]*?)(\n```)/i;

function parseLikers(blockBody) {
    const out = [];
    if (!blockBody) return out;
    for (const raw of blockBody.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) continue;
        // Each line is "<ISO timestamp>  <email>", but tolerate email-only legacy entries.
        const m = line.match(/^(\S+)\s+(\S+)\s*$/);
        if (m) out.push({ timestamp: m[1], email: m[2].toLowerCase() });
        else out.push({ timestamp: '', email: line.toLowerCase() });
    }
    return out;
}

function serializeLikers(likers) {
    return likers.map(l => `${l.timestamp || new Date().toISOString()}  ${l.email}`).join('\n');
}

/**
 * Toggle currentUserEmail in the source's ```liked``` block. Creates the
 * block if absent. Returns { content, count, liked }.
 */
function toggleLike(originalContent, currentUserEmail) {
    const email = String(currentUserEmail || '').trim().toLowerCase();
    if (!email) throw new Error('Unable to determine current user');

    const m = originalContent.match(FENCE_RE);
    let likers = m ? parseLikers(m[2]) : [];
    const idx = likers.findIndex(l => l.email === email);
    let liked;
    if (idx >= 0) {
        likers.splice(idx, 1);
        liked = false;
    } else {
        likers.push({ timestamp: new Date().toISOString(), email });
        liked = true;
    }

    const newBody = serializeLikers(likers);
    let updated;
    if (m) {
        const [, fenceOpen, , fenceClose] = m;
        // If the block is now empty, keep an empty fenced block in place rather
        // than removing it — that way readers still see "0 likes" and can click
        // to like without the parser having to re-create the block on the fly.
        updated = originalContent.replace(FENCE_RE, fenceOpen + (newBody || '') + fenceClose);
    } else {
        const trailing = originalContent.endsWith('\n') ? '' : '\n';
        updated = originalContent + trailing + '\n```liked\n' + newBody + '\n```\n';
    }

    return { content: updated, count: likers.length, liked };
}

/**
 * Remove currentUserEmail from the source's ```liked``` block, idempotently.
 * Returns { content, count, changed }.
 */
function removeLiker(originalContent, currentUserEmail) {
    const email = String(currentUserEmail || '').trim().toLowerCase();
    const m = originalContent.match(FENCE_RE);
    if (!m) return { content: originalContent, count: 0, changed: false };

    const likers = parseLikers(m[2]);
    const remaining = likers.filter(l => l.email !== email);
    if (remaining.length === likers.length) {
        return { content: originalContent, count: likers.length, changed: false };
    }

    const [, fenceOpen, , fenceClose] = m;
    const updated = originalContent.replace(FENCE_RE, fenceOpen + serializeLikers(remaining) + fenceClose);
    return { content: updated, count: remaining.length, changed: true };
}

/**
 * Replicates the path-resolution + security check used by documentRoutes.
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
        absolutePath = path.isAbsolute(documentPath)
            ? documentPath
            : path.resolve(documentsDir, documentPath);
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

    /**
     * POST /applications/wiki/api/likes
     * Body: { spaceName, path }
     * Authenticated. Toggles req.user's like on the document.
     * Returns { success, count, liked, content }.
     */
    app.post('/applications/wiki/api/likes', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { spaceName, path: documentPath } = req.body || {};
            if (!spaceName || !documentPath) {
                return res.status(400).json({ success: false, error: 'spaceName and path are required' });
            }
            const ext = path.extname(documentPath).toLowerCase();
            if (ext !== '.md' && ext !== '.markdown') {
                return res.status(400).json({ success: false, error: 'Likes are only supported on markdown files' });
            }

            const userEmail = req.user?.email || req.user?.name;
            if (!userEmail) {
                return res.status(400).json({ success: false, error: 'Authenticated user has no email' });
            }

            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);

            let original = '';
            try {
                original = await fs.readFile(absolutePath, 'utf8');
            } catch (err) {
                if (err.code === 'ENOENT') {
                    return res.status(404).json({ success: false, error: 'Document not found' });
                }
                throw err;
            }

            const { content: updated, count, liked } = toggleLike(original, userEmail);

            await fs.writeFile(absolutePath, updated, 'utf8');

            // Keep the user's content index in sync so the like shows (or stops
            // showing) on their profile screen.
            try {
                if (liked) {
                    await userContentIndex.recordLike(appBaseDir, spaceName, userEmail, {
                        spaceName,
                        path: documentPath,
                        title: path.basename(documentPath).replace(/\.(md|markdown)$/i, '')
                    });
                } else {
                    await userContentIndex.removeLike(appBaseDir, spaceName, userEmail, {
                        spaceName, path: documentPath
                    });
                }
            } catch (e) {
                log.warn('[Likes] index update failed:', e.message);
            }

            if (cache) {
                try {
                    const cacheKey = `${spaceName}-${documentPath}`;
                    await writeContentCache(cache, cacheKey, updated, await fs.stat(absolutePath));
                } catch (e) {
                    log.warn('[Likes] cache update failed:', e.message);
                }
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
                } catch (e) {
                    log.warn('[Likes] event emit failed:', e.message);
                }
            }

            log.info(`[Likes] ${userEmail} ${liked ? 'liked' : 'unliked'} ${spaceName}/${documentPath} (count=${count})`);
            res.json({ success: true, count, liked, content: updated });
        } catch (err) {
            log.error('[Likes] POST failed:', err);
            const status = err.message === 'Space not found' ? 404
                : err.message?.startsWith('Access denied') ? 403
                : 500;
            res.status(status).json({ success: false, error: err.message });
        }
    });

    /**
     * GET /applications/wiki/api/user/likes
     * Authenticated. Returns the current user's likes from the content index.
     */
    app.get('/applications/wiki/api/user/likes', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const userEmail = req.user?.email || req.user?.name;
            const spaceName = req.query.space || req.query.spaceName;
            const data = await userContentIndex.read(appBaseDir, spaceName, userEmail);
            res.json({ success: true, likes: data.likes });
        } catch (err) {
            log.error('[Likes] GET /user/likes failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE /applications/wiki/api/likes
     * Body: { spaceName, path }
     * Authenticated. Removes the current user's like (idempotent — unlike a
     * never-liked document is a no-op) and updates their content index.
     */
    app.delete('/applications/wiki/api/likes', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { spaceName, path: documentPath } = req.body || {};
            if (!spaceName || !documentPath) {
                return res.status(400).json({ success: false, error: 'spaceName and path are required' });
            }

            const userEmail = req.user?.email || req.user?.name;
            if (!userEmail) {
                return res.status(400).json({ success: false, error: 'Authenticated user has no email' });
            }

            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);

            let original = '';
            let docMissing = false;
            try {
                original = await fs.readFile(absolutePath, 'utf8');
            } catch (err) {
                if (err.code === 'ENOENT') docMissing = true;
                else throw err;
            }

            // Drop from the index regardless, so the profile stays consistent.
            await userContentIndex.removeLike(appBaseDir, spaceName, userEmail, {
                spaceName, path: documentPath
            });

            if (docMissing) {
                return res.json({ success: true, removedFromDocument: false, count: 0 });
            }

            const { content: updated, count, changed } = removeLiker(original, userEmail);

            if (!changed) {
                return res.json({ success: true, removedFromDocument: false, count });
            }

            await fs.writeFile(absolutePath, updated, 'utf8');

            if (cache) {
                try {
                    await writeContentCache(cache, `${spaceName}-${documentPath}`, updated, await fs.stat(absolutePath));
                } catch (e) {
                    log.warn('[Likes] cache update failed:', e.message);
                }
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
                } catch (e) {
                    log.warn('[Likes] event emit failed:', e.message);
                }
            }

            log.info(`[Likes] ${userEmail} removed their like on ${spaceName}/${documentPath} (count=${count})`);
            res.json({ success: true, removedFromDocument: true, count, content: updated });
        } catch (err) {
            log.error('[Likes] DELETE failed:', err);
            const status = err.message === 'Space not found' ? 404
                : err.message?.startsWith('Access denied') ? 403
                : 500;
            res.status(status).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki likes routes registered');
};
