/**
 * @fileoverview Linked-documents routes.
 *
 * A page declares its relationships to other wiki content in an inline
 * ```linked-documents``` block (see components/linkedDocumentBlocks.js). These
 * routes are what the "Link documents" dialog talks to, so the client never has
 * to read a whole document, splice a fence into it by hand and PUT the result
 * back — a round trip that would race any other edit in flight and rewrite
 * every byte of the file to change one line.
 *
 *   GET    /applications/wiki/api/linked-documents        ?spaceName=&path=
 *   PUT    /applications/wiki/api/linked-documents        { spaceName, path, items, title?, across? }
 *   POST   /applications/wiki/api/linked-documents/resolve { spaceName, refs: [...] }
 *
 * RESOLVE exists because a reference is just a path: the card that renders it
 * needs to know whether it points at a folder or a file, what it is called,
 * when it changed and how many items it holds — and a reference may name a
 * DIFFERENT space, so every one of those questions has to be answered against
 * the space that owns it. Doing that per card in the browser would be four
 * round trips each; doing it here is one, and it is the only place that can
 * apply the access rules honestly.
 *
 * ACCESS. Two independent gates, both mandatory:
 *   1. The caller must be able to reach the space a reference names (the same
 *      public / team / private+allowedUsers rule the spaces list applies).
 *   2. The space must EXPOSE the path — several spaces share one content root
 *      and each curates a slice of it (spacePaths.resolveSpacePath, visibility
 *      default-on).
 * A reference that fails either gate resolves to `kind: 'hidden'` and carries
 * no name, date or count. It is not an error: a page may legitimately link
 * something a particular reader cannot see, and the card simply says so.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-21
 */

'use strict';

const fs = require('node:fs').promises;
const path = require('node:path');

const L = require('../components/linkedDocumentBlocks');
const {
    readSpaces,
    resolveSpacePath,
    isPathVisible,
    handleSpacePathError
} = require('../../shared/spaces/spacePaths');
const { writeContentCache } = require('../utils/documentContentCache');

/** Cap on a single block's references — a relationship band, not a directory. */
const MAX_ITEMS = 60;

/** Folder-home file names, in the probe order the rest of the wiki uses. */
const HOME_NAMES = ['home.md', '.home.md', 'Home.md'];

module.exports = (options, eventEmitter, services) => {
    const app = options.app;
    const log = services.log || services.logger || console;
    const cache = services.cache;
    const appBaseDir = services.appBaseDir;

    const isMarkdown = (p) => ['.md', '.markdown'].includes(path.extname(p || '').toLowerCase());

    /**
     * The space-list access rule, applied to one space record. Mirrors
     * spacesRoutes' GET /spaces filter — a reference must not become a way to
     * read the name of something in a space the caller cannot open.
     */
    function canReachSpace(req, space) {
        if (!space) return false;
        if (space.visibility === 'public') return true;
        if (!req.isAuthenticated || !req.isAuthenticated()) return false;
        if (space.visibility === 'team') return true;
        if (space.visibility === 'private') {
            const email = req.user && req.user.email;
            return Array.isArray(space.allowedUsers) && email
                ? space.allowedUsers.includes(email)
                : false;
        }
        // An unset/unknown visibility is treated as team — the same effective
        // behaviour as the spaces list, which only admits the three known values.
        return true;
    }

    /** Count a folder's visible children, mirroring what the nav tree shows. */
    async function countChildren(space, absoluteDir, relativeDir) {
        let entries;
        try {
            entries = await fs.readdir(absoluteDir, { withFileTypes: true });
        } catch (_) {
            return 0;
        }
        let count = 0;
        for (const entry of entries) {
            // Dot-folders are wiki plumbing (.system, .aicontext) and dot-files
            // are folder homes — neither is an "item" a reader would count.
            if (entry.name.startsWith('.')) continue;
            const childRel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
            if (!isPathVisible(space, childRel, entry.isDirectory() ? 'folder' : 'file')) continue;
            count += 1;
        }
        return count;
    }

    /**
     * Display title for a resolved reference. A folder home file is shown as
     * its FOLDER's name — `.../Landscapes/.home.md` reads as "Landscapes",
     * never as ".home.md", which is what the rest of the wiki does too.
     */
    function titleFor(relativePath, isDirectory) {
        const segments = String(relativePath || '').split('/').filter(Boolean);
        const base = segments[segments.length - 1] || '';
        if (isDirectory) return base;
        if (HOME_NAMES.some(n => n.toLowerCase() === base.toLowerCase())) {
            return segments[segments.length - 2] || base;
        }
        return base.replace(/\.(md|markdown)$/i, '');
    }

    /**
     * Resolve one reference against the space it names (or the host space when
     * it carries no prefix). Never throws — an unresolvable reference comes
     * back as `missing` or `hidden` so one bad link cannot fail the whole band.
     */
    async function resolveOne(req, ref, hostSpaceName, spaces) {
        const { spaceName: refSpace, path: refPath } = L.splitRef(ref);
        const spaceName = refSpace || hostSpaceName;
        const base = { ref, spaceName, path: refPath };

        if (!refPath) return { ...base, kind: 'missing' };

        const space = spaces.find(s => s.name === spaceName);
        if (!space || !canReachSpace(req, space)) return { ...base, kind: 'hidden' };

        // Visibility is switched OFF here and applied explicitly below —
        // the ONE place in this file that does so, and it needs the reason
        // spelled out. The correct rule depends on what the reference points
        // AT, and that is only knowable after the stat: a FILE is judged by
        // `isFileVisible` (which lets root-level files and `.system` plumbing
        // through — without that exemption a curated space's own `home.md`
        // would be hidden from it), while a FOLDER is judged by the listable
        // `container` rule so a pass-through ancestor of an allowed subtree
        // stays a real destination. Asking either question of the wrong kind
        // gives the wrong answer, so nothing is returned until the right one
        // has been asked. The traversal guard still runs.
        let resolved;
        try {
            resolved = await resolveSpacePath({
                spaceName, documentPath: refPath, appBaseDir, spaces, enforceVisibility: false
            });
        } catch (_) {
            return { ...base, kind: 'hidden' };
        }

        let stats;
        try {
            stats = await fs.stat(resolved.absolutePath);
        } catch (_) {
            // A path the space hides answers `hidden` whether or not anything
            // is actually there, so "missing" can never be used to probe for
            // the existence of something inside a curated-away subtree.
            return isPathVisible(space, resolved.relativePath, 'file')
                ? { ...base, kind: 'missing', spaceId: space.id || null }
                : { ...base, kind: 'hidden' };
        }

        const isDirectory = stats.isDirectory();
        if (!isPathVisible(space, resolved.relativePath, isDirectory ? 'container' : 'file')) {
            return { ...base, kind: 'hidden' };
        }

        const relative = resolved.relativePath.replace(/\\/g, '/');
        const out = {
            ...base,
            path: relative,
            kind: isDirectory ? 'folder' : 'file',
            spaceId: space.id || null,
            title: titleFor(relative, isDirectory),
            modified: stats.mtime.toISOString()
        };
        if (isDirectory) {
            out.childCount = await countChildren(space, resolved.absolutePath, relative);
        } else {
            out.size = stats.size;
        }
        return out;
    }

    /**
     * GET — read a document's linked-documents block.
     * Query: ?spaceName=&path=
     */
    app.get('/applications/wiki/api/linked-documents', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const spaceName = (req.query.spaceName || '').trim();
            const documentPath = (req.query.path || '').trim();
            if (!spaceName || !documentPath) {
                return res.status(400).json({ success: false, error: 'spaceName and path are required' });
            }

            let resolved;
            try {
                resolved = await resolveSpacePath({ spaceName, documentPath, appBaseDir });
            } catch (err) {
                if (handleSpacePathError(res, err)) return;
                throw err;
            }

            let content = '';
            try {
                content = await fs.readFile(resolved.absolutePath, 'utf8');
            } catch (err) {
                if (err.code !== 'ENOENT') throw err;
                // A document that does not exist yet simply has no links; the
                // dialog opens empty rather than erroring.
                return res.json({ success: true, exists: false, title: '', across: 0, items: [] });
            }

            const block = L.parseLinkedDocuments(content);
            res.json({
                success: true,
                exists: true,
                hasBlock: !!block,
                title: (block && block.title) || '',
                across: (block && block.across) || 0,
                items: (block && block.items) || []
            });
        } catch (err) {
            log.error('[LinkedDocuments] GET failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * PUT — set a document's links. An empty `items` array removes the block.
     * Body: { spaceName, path, items: [{ref, label}], title?, across? }
     */
    app.put('/applications/wiki/api/linked-documents', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { spaceName, path: documentPath, items, title, across } = req.body || {};
            if (!spaceName || !documentPath) {
                return res.status(400).json({ success: false, error: 'spaceName and path are required' });
            }
            if (!Array.isArray(items)) {
                return res.status(400).json({ success: false, error: 'items must be an array' });
            }
            if (items.length > MAX_ITEMS) {
                return res.status(400).json({ success: false, error: `At most ${MAX_ITEMS} links per document` });
            }
            if (!isMarkdown(documentPath)) {
                return res.status(400).json({ success: false, error: 'Linked documents are only supported on markdown files' });
            }

            let resolved;
            try {
                resolved = await resolveSpacePath({ spaceName, documentPath, appBaseDir });
            } catch (err) {
                if (handleSpacePathError(res, err)) return;
                throw err;
            }

            let original;
            try {
                original = await fs.readFile(resolved.absolutePath, 'utf8');
            } catch (err) {
                if (err.code === 'ENOENT') {
                    return res.status(404).json({ success: false, error: 'Document not found' });
                }
                throw err;
            }

            const options = {};
            if (title !== undefined) options.title = String(title || '').trim();
            if (across !== undefined) options.across = parseInt(across, 10) || 0;
            const updated = L.setLinkedDocuments(original, items, options);

            if (updated === original) {
                return res.json({ success: true, changed: false, content: original });
            }

            await fs.writeFile(resolved.absolutePath, updated, 'utf8');

            const stats = await fs.stat(resolved.absolutePath);
            if (cache) {
                try {
                    await writeContentCache(cache, `${spaceName}-${documentPath}`, updated, stats);
                } catch (e) {
                    log.warn('[LinkedDocuments] cache update failed:', e.message);
                }
            }
            if (global.eventBus) {
                try {
                    global.eventBus.emitChange('update', 'file', {
                        spaceId: resolved.space?.id || null,
                        spaceName,
                        name: path.basename(documentPath),
                        path: documentPath,
                        modified: stats.mtime.toISOString(),
                        size: stats.size,
                        source: 'api'
                    });
                } catch (e) {
                    log.warn('[LinkedDocuments] event emit failed:', e.message);
                }
            }

            log.info(`[LinkedDocuments] ${req.user?.email || 'unknown'} set ${items.length} link(s) on ${spaceName}/${documentPath}`);
            res.json({ success: true, changed: true, content: updated });
        } catch (err) {
            log.error('[LinkedDocuments] PUT failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /resolve — turn references into card-ready descriptors.
     * Body: { spaceName (the host document's space), refs: ["[Space]/a/b", ...] }
     */
    app.post('/applications/wiki/api/linked-documents/resolve', async (req, res) => {
        try {
            if (!req.isAuthenticated()) {
                return res.status(401).json({ success: false, error: 'Authentication required' });
            }
            const { spaceName, refs } = req.body || {};
            if (!Array.isArray(refs)) {
                return res.status(400).json({ success: false, error: 'refs must be an array' });
            }
            const wanted = refs.slice(0, MAX_ITEMS).map(r => L.normaliseRef(r)).filter(Boolean);
            if (!wanted.length) return res.json({ success: true, items: [] });

            const spaces = await readSpaces(appBaseDir);
            const hostSpaceName = (spaceName || '').trim();
            const items = [];
            for (const ref of wanted) {
                items.push(await resolveOne(req, ref, hostSpaceName, spaces));
            }
            res.json({ success: true, items });
        } catch (err) {
            log.error('[LinkedDocuments] resolve failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki linked-documents routes registered');
};
