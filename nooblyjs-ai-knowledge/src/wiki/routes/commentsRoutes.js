/**
 * @fileoverview Document comments routes
 *
 * Comments are stored inline in the source markdown inside a fenced
 * ```comments``` block. Each entry follows this shape:
 *
 *   Comment: free-form comment text
 *   Commentor: user-email@example.com
 *   Date: 2026-05-14 09:00
 *   ---
 *
 * Newest comment is prepended (top of the block) so readers see the most
 * recent activity first. POSTing here mutates the source file directly so
 * comments are versioned alongside the document content.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-05-14
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');
const mime = require('mime-types');
const userContentIndex = require('../components/userContentIndex');
const { writeContentCache } = require('../utils/documentContentCache');
const { resolveSpacePath, PATH_HIDDEN } = require('../../shared/spaces/spacePaths');

const COMMENTS_FENCE_RE = /(```comments\s*\n)([\s\S]*?)(\n```)/i;

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function nowStamp(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function buildEntry({ comment, commentor, date }) {
    const lines = [
        `Comment: ${comment.replace(/\r/g, '').trim()}`,
        `Commentor: ${(commentor || 'unknown').trim()}`,
        `Date: ${date || nowStamp()}`,
        '---'
    ];
    return lines.join('\n');
}

/**
 * Insert a new entry at the top of the existing ```comments``` block.
 * If no block exists, append a new one to the end of the file.
 */
function injectComment(originalContent, entry) {
    const fenceRe = /(```comments\s*\n)([\s\S]*?)(\n```)/i;
    const m = originalContent.match(fenceRe);
    if (m) {
        const [, fenceOpen, body, fenceClose] = m;
        const trimmedBody = body.replace(/^\s+/, '');
        const newBody = entry + (trimmedBody ? '\n' + trimmedBody : '');
        return originalContent.replace(fenceRe, fenceOpen + newBody + fenceClose);
    }
    // No existing block — append one.
    const trailing = originalContent.endsWith('\n') ? '' : '\n';
    return originalContent + trailing + '\n```comments\n' + entry + '\n```\n';
}

/**
 * Parse the body of a ```comments``` block into structured entries.
 * Entries are separated by a line containing only `---`.
 */
function parseCommentEntries(body) {
    const entries = [];
    for (const chunk of String(body || '').split(/^\s*---\s*$/m)) {
        let comment = null, commentor = '', date = '', collecting = false;
        for (const line of chunk.split(/\r?\n/)) {
            const mc = line.match(/^Comment:\s?(.*)$/);
            const mu = line.match(/^Commentor:\s?(.*)$/);
            const md = line.match(/^Date:\s?(.*)$/);
            if (mc) { comment = mc[1]; collecting = true; }
            else if (mu) { commentor = mu[1].trim(); collecting = false; }
            else if (md) { date = md[1].trim(); collecting = false; }
            else if (collecting && comment !== null) { comment += '\n' + line; }
        }
        if (comment !== null) {
            entries.push({ comment: comment.trim(), commentor, date });
        }
    }
    return entries;
}

/**
 * Remove a single entry from the document's ```comments``` block, matched on
 * commentor + date + text. Returns the updated content, or null when no
 * matching entry was found.
 */
function removeCommentFromContent(content, target) {
    const m = content.match(COMMENTS_FENCE_RE);
    if (!m) return null;
    const [, fenceOpen, body, fenceClose] = m;
    const wantCommentor = String(target.commentor || '').trim().toLowerCase();
    let removed = false;
    const kept = parseCommentEntries(body).filter(e => {
        if (!removed
            && e.commentor.toLowerCase() === wantCommentor
            && e.date === target.date
            && e.comment === target.text) {
            removed = true;
            return false;
        }
        return true;
    });
    if (!removed) return null;
    const newBody = kept
        .map(e => buildEntry({ comment: e.comment, commentor: e.commentor, date: e.date }))
        .join('\n');
    return content.replace(COMMENTS_FENCE_RE, fenceOpen + newBody + fenceClose);
}

/**
 * Resolve a document path within its space.
 *
 * Delegates to the shared resolver, which applies BOTH the traversal guard and
 * the space's allowedPaths/excludedPaths filter. This was previously a private
 * copy doing the traversal guard alone — "self-contained" turned out to mean
 * "missed the access boundary added later", and since POST echoes the whole
 * updated document back, commenting on a hidden path returned its full contents.
 * See shared/spaces/spacePaths.js.
 */
async function resolveDocPath(spaceName, documentPath, appBaseDir) {
    return resolveSpacePath({ spaceName, documentPath, appBaseDir });
}

module.exports = (options, eventEmitter, services) => {
    const app = options.app;
    const log = services.log || services.logger || console;
    const cache = services.cache;
    const appBaseDir = services.appBaseDir;

    /**
     * POST /applications/wiki/api/comments
     * Body: { spaceName, path, comment }
     * Authenticated. Sets Commentor from req.user.email and Date from server clock.
     */
    app.post('/applications/wiki/api/comments', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { spaceName, path: documentPath, comment } = req.body || {};
            if (!spaceName || !documentPath) {
                return res.status(400).json({ success: false, error: 'spaceName and path are required' });
            }
            if (typeof comment !== 'string' || !comment.trim()) {
                return res.status(400).json({ success: false, error: 'comment is required' });
            }

            // Only allow commenting on markdown files — the inline-block
            // approach doesn't fit other formats.
            const ext = path.extname(documentPath).toLowerCase();
            if (ext !== '.md' && ext !== '.markdown') {
                return res.status(400).json({ success: false, error: 'Comments are only supported on markdown files' });
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

            const commentText = comment.trim();
            const commentor = req.user?.email || req.user?.name || 'unknown';
            const commentDate = nowStamp();
            const entry = buildEntry({ comment: commentText, commentor, date: commentDate });
            const updated = injectComment(original, entry);

            await fs.writeFile(absolutePath, updated, 'utf8');

            // Index the comment so it appears on the author's profile screen.
            try {
                await userContentIndex.recordComment(appBaseDir, spaceName, commentor, {
                    spaceName,
                    path: documentPath,
                    title: path.basename(documentPath).replace(/\.(md|markdown)$/i, ''),
                    text: commentText,
                    date: commentDate
                });
            } catch (e) {
                log.warn('[Comments] index update failed:', e.message);
            }

            // Refresh the document content cache so the next read sees the
            // new comment without waiting for cache TTL.
            if (cache) {
                try {
                    const cacheKey = `-`;
                    await writeContentCache(cache, cacheKey, updated, await fs.stat(absolutePath));
                } catch (e) {
                    log.warn('[Comments] cache update failed:', e.message);
                }
            }

            // Emit event so subscribers / file watchers / search index see the change.
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
                    log.warn('[Comments] event emit failed:', e.message);
                }
            }

            log.info(`[Comments] ${req.user?.email || req.user?.id} commented on ${spaceName}/${documentPath}`);
            res.json({ success: true, content: updated });
        } catch (err) {
            log.error('[Comments] POST failed:', err);
            // A hidden path answers 404, never 403 — a 403 would confirm the
            // document exists, which is what a curated space is hiding.
            const status = err?.code === PATH_HIDDEN ? 404
                : err.message === 'Space not found' ? 404
                : err.message?.startsWith('Access denied') ? 403
                : 500;
            res.status(status).json({ success: false, error: err.message });
        }
    });

    /**
     * GET /applications/wiki/api/user/comments
     * Authenticated. Returns the current user's comments from the content index.
     */
    app.get('/applications/wiki/api/user/comments', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const email = req.user?.email || req.user?.name;
            const spaceName = req.query.space || req.query.spaceName;
            const data = await userContentIndex.read(appBaseDir, spaceName, email);
            res.json({ success: true, comments: data.comments });
        } catch (err) {
            log.error('[Comments] GET /user/comments failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE /applications/wiki/api/comments
     * Body: { spaceName, path, date, text }
     * Authenticated. Removes the user's own comment from the document's
     * ```comments``` block and from their content index.
     */
    app.delete('/applications/wiki/api/comments', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { spaceName, path: documentPath, date, text } = req.body || {};
            if (!spaceName || !documentPath || !date || typeof text !== 'string') {
                return res.status(400).json({ success: false, error: 'spaceName, path, date and text are required' });
            }

            const email = req.user?.email || req.user?.name;
            const { absolutePath, space } = await resolveDocPath(spaceName, documentPath, appBaseDir);

            let original = '';
            let docMissing = false;
            try {
                original = await fs.readFile(absolutePath, 'utf8');
            } catch (err) {
                if (err.code === 'ENOENT') docMissing = true;
                else throw err;
            }

            // Always drop the entry from the index so the profile stays consistent
            // even if the document or comment block has since changed.
            await userContentIndex.removeComment(appBaseDir, spaceName, email, {
                spaceName, path: documentPath, date, text
            });

            const updated = docMissing
                ? null
                : removeCommentFromContent(original, { commentor: email, date, text });

            if (updated === null) {
                return res.json({ success: true, removedFromDocument: false });
            }

            await fs.writeFile(absolutePath, updated, 'utf8');

            if (cache) {
                try {
                    await writeContentCache(cache, `${spaceName}-${documentPath}`, updated, await fs.stat(absolutePath));
                } catch (e) {
                    log.warn('[Comments] cache update failed:', e.message);
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
                    log.warn('[Comments] event emit failed:', e.message);
                }
            }

            log.info(`[Comments] ${email} deleted a comment on ${spaceName}/${documentPath}`);
            res.json({ success: true, removedFromDocument: true, content: updated });
        } catch (err) {
            log.error('[Comments] DELETE failed:', err);
            // A hidden path answers 404, never 403 — a 403 would confirm the
            // document exists, which is what a curated space is hiding.
            const status = err?.code === PATH_HIDDEN ? 404
                : err.message === 'Space not found' ? 404
                : err.message?.startsWith('Access denied') ? 403
                : 500;
            res.status(status).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki comments routes registered');
};
