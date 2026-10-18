/**
 * @fileoverview User Notes API routes.
 *
 * Private, per-user notes about a document or a folder, stored per CONTENT ROOT
 * as plain text files:
 *
 *   <space content dir>/.system/useractivity/<prefix>/notes/<title>.txt
 *
 * See components/noteStore.js for the layout and why the index sits beside the
 * .txt files. As with pins, A NOTE BELONGS TO A PATH, NOT TO A SPACE: records
 * carry no `spaceName` (it names WHICH content root to read/write, nothing
 * more), and scoping is the space's real visibility matcher — so a note follows
 * the user into every view that can see the target, and a space rename orphans
 * nothing.
 *
 * EVERY ROUTE CARRIES THE TARGET (`type` + `path`), id-addressed ones included.
 * Notes are stored in the folder they are about, so an index is per folder and
 * an id alone no longer says which one holds it; the client always knows the
 * target, because it listed the note from there. Same rule the Continuous
 * Exploration template routes follow.
 *
 * THAT MAKES THE TARGET A WRITE LOCATION, so `targetVisible` gates every route
 * rather than just the listing ones. Without it a caller could name a path this
 * space curates away and have notes written into it — the folder is derived
 * from the path, so the path decides where bytes land.
 *
 *   GET    /applications/wiki/api/notes?space=&type=&path=   notes for content
 *   GET    /applications/wiki/api/notes/count?space=&type=&path=   just the count
 *   POST   /applications/wiki/api/notes                      create
 *   PUT    /applications/wiki/api/notes/:id                  replace the body
 *   DELETE /applications/wiki/api/notes/:id                  delete
 *
 *   POST   /applications/wiki/api/notes/audio                create a VOICE note
 *   POST   /applications/wiki/api/notes/:id/audio            attach/replace audio
 *   GET    /applications/wiki/api/notes/:id/audio            play it back
 *   DELETE /applications/wiki/api/notes/:id/audio            drop the recording
 *
 *   POST   /applications/wiki/api/notes/images               create a note with a picture
 *   POST   /applications/wiki/api/notes/:id/images           paste a picture into one
 *   GET    /applications/wiki/api/notes/:id/images/:imageId  show it
 *   DELETE /applications/wiki/api/notes/:id/images/:imageId  remove just that picture
 *
 * VOICE NOTES. A recording is an attachment on an ordinary note, so everything
 * above keeps working unchanged and a voice note is counted, listed, scoped and
 * deleted exactly like any other. Uploads are multipart rather than base64 in
 * JSON: base64 inflates by a third, and the body limit in app.js is 10 MB.
 *
 * A note may be created WITH its recording in one request (POST /notes/audio).
 * Recording and attaching as two round trips is the obvious alternative and is
 * worse: when the second call fails the user is left holding an empty note they
 * never asked for, which looks exactly like a bug in the New note button.
 * Pictures follow the same pattern for the same reason (POST /notes/images).
 *
 * Recordings and pictures are served by ONE function, `sendAttachment`: both
 * are private bytes addressed by note id, and both need the same range, ETag
 * and cache handling. Only the 404 wording differs.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-04
 */

'use strict';

const path = require('node:path');

const multer = require('multer');

const noteStore = require('../components/noteStore');
const spaceUserStore = require('../components/spaceUserStore');
const userArtifacts = require('../components/userArtifacts');

/** Ids are minted server-side; anything else is a malformed request. */
const ID_PATTERN = /^[a-z0-9_-]+$/i;

/** Form field carrying the recording. */
const AUDIO_FIELD = 'audio';

/** Form field carrying a pasted picture. */
const IMAGE_FIELD = 'image';

module.exports = (options, eventEmitter, services) => {
    const app = options.app;
    const log = services.log || services.logger || console;
    const appBaseDir = services.appBaseDir
        || path.resolve(__dirname, '../../../.application');

    // Recordings are small and are written through noteStore (which owns the
    // file naming), so they are buffered in memory and never handed to multer's
    // disk storage — the same arrangement as the avatar upload in userRoutes.
    const upload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: noteStore.MAX_AUDIO_BYTES, files: 1 },
        fileFilter: (req, file, cb) => {
            if (noteStore.audioExtensionFor(file.mimetype)) return cb(null, true);
            cb(Object.assign(new Error(`Unsupported recording type: ${file.mimetype}`), {
                code: 'UNSUPPORTED_AUDIO_TYPE'
            }));
        }
    });

    // Pictures. A separate multer instance because the limit and the accepted
    // types differ; the handling around it is identical.
    const uploadImage = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: noteStore.MAX_IMAGE_BYTES, files: 1 },
        fileFilter: (req, file, cb) => {
            if (noteStore.imageExtensionFor(file.mimetype)) return cb(null, true);
            cb(Object.assign(new Error(`Unsupported picture type: ${file.mimetype}`), {
                code: 'UNSUPPORTED_IMAGE_TYPE'
            }));
        }
    });

    /**
     * `upload.single` as a handler rather than as middleware.
     *
     * Left as middleware, a rejected upload (too large, wrong type) propagates
     * to Express's default error handler, which answers an HTML error page —
     * from a fetch() that is expecting JSON, that surfaces as an unhelpful
     * "Unexpected token <". Running it here turns both refusals into the JSON
     * the client already knows how to display.
     */
    function receiveUpload(req, res, { middleware, field, tooBig, unsupported }) {
        return new Promise((resolve) => {
            middleware(field)(req, res, (err) => {
                if (!err) return resolve(true);

                if (err.code === 'LIMIT_FILE_SIZE') {
                    res.status(413).json({ success: false, error: tooBig });
                } else if (err.code === unsupported) {
                    res.status(415).json({ success: false, error: err.message });
                } else {
                    log.error('[Notes] upload failed:', err);
                    res.status(400).json({ success: false, error: err.message });
                }
                resolve(false);
            });
        });
    }

    /** Take a recording off the request, or answer and return false. */
    function receiveAudio(req, res) {
        const mb = Math.round(noteStore.MAX_AUDIO_BYTES / (1024 * 1024));
        return receiveUpload(req, res, {
            middleware: (field) => upload.single(field),
            field: AUDIO_FIELD,
            tooBig: `That recording is too long — the limit is ${mb} MB.`,
            unsupported: 'UNSUPPORTED_AUDIO_TYPE'
        });
    }

    /** Take a picture off the request, or answer and return false. */
    function receiveImage(req, res) {
        const mb = Math.round(noteStore.MAX_IMAGE_BYTES / (1024 * 1024));
        return receiveUpload(req, res, {
            middleware: (field) => uploadImage.single(field),
            field: IMAGE_FIELD,
            tooBig: `That picture is too large — the limit is ${mb} MB.`,
            unsupported: 'UNSUPPORTED_IMAGE_TYPE'
        });
    }

    /** The uploaded picture in the shape noteStore wants, or null. */
    function imageFrom(req) {
        if (!req.file || !req.file.buffer || !req.file.buffer.length) return null;
        return {
            buffer: req.file.buffer,
            mime: req.file.mimetype,
            // Measured by the browser before uploading, so the panel can
            // reserve the right space instead of reflowing as each picture
            // loads. Absent is fine — normaliseImage stores null.
            width: Number(req.body && req.body.width) || null,
            height: Number(req.body && req.body.height) || null
        };
    }

    /**
     * Serve one private attachment: a recording or a picture.
     *
     * RANGE REQUESTS ARE HONOURED because an <audio> element issues one as soon
     * as the listener drags the scrub bar, and a server that answers 200-with-
     * everything to `Range:` leaves Safari unable to seek.
     *
     * `Cache-Control` is `private` — this is one person's note, and a shared
     * cache holding it would be a disclosure — and revalidating rather than
     * immutable, because replacing an attachment reuses a URL that stays the
     * same. The ETag makes that cheap: a second view is a 304, not a download.
     *
     * `nosniff` because the type comes from an allow-list keyed on what the
     * BROWSER said it was uploading; no bytes are inspected, so the one thing
     * that must not happen is a client deciding for itself what this is.
     */
    function sendAttachment(req, res, found, etagSeed) {
        const total = found.buffer.length;
        const etag = `"${etagSeed}-${total}"`;

        res.setHeader('Content-Type', found.mime);
        res.setHeader('Cache-Control', 'private, no-cache');
        res.setHeader('ETag', etag);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        // The browser saves it under the note's own file name, which is the
        // content's title — a saved attachment says what it is about.
        res.setHeader('Content-Disposition',
            `inline; filename="${found.file.replace(/"/g, '')}"`);

        if (req.headers && req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        const range = req.headers && req.headers.range;
        const match = /^bytes=(\d*)-(\d*)$/.exec(String(range || ''));
        if (match && (match[1] || match[2])) {
            // An open-ended suffix range ("bytes=-500") counts back from the
            // end; anything past the last byte is clamped rather than 416'd,
            // which is what browsers expect for a file this small.
            const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2]));
            const end = match[1]
                ? Math.min(match[2] ? Number(match[2]) : total - 1, total - 1)
                : total - 1;

            if (start > end || start >= total) {
                res.setHeader('Content-Range', `bytes */${total}`);
                return res.status(416).end();
            }

            res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
            res.setHeader('Content-Length', end - start + 1);
            return res.status(206).end(found.buffer.subarray(start, end + 1));
        }

        res.setHeader('Content-Length', total);
        return res.end(found.buffer);
    }

    /** The uploaded recording in the shape noteStore wants, or null. */
    function audioFrom(req) {
        if (!req.file || !req.file.buffer || !req.file.buffer.length) return null;
        return {
            buffer: req.file.buffer,
            mime: req.file.mimetype,
            // Timed by the browser while it recorded: MediaRecorder writes a
            // streaming container with no duration in its header, so this is
            // the only number anybody has. See noteStore.normaliseAudio.
            durationMs: Number(req.body && req.body.durationMs) || null
        };
    }

    /**
     * The { type, path } a request is about, from the body or the query.
     * `path` may legitimately be '' (the space root), so its presence is
     * checked with == null rather than for truthiness.
     */
    function targetFrom(source) {
        if (!source) return null;
        const targetPath = source.path != null ? source.path : source.targetPath;
        if (targetPath == null) return null;
        return { type: source.type, path: targetPath, title: source.title };
    }

    /**
     * Resolve a request to its space, base dir and target, refusing when the
     * target is missing or the space will not show it. Returns null having
     * answered, so callers read as `const ctx = await located(...); if (!ctx) return;`
     */
    async function located(req, res, source) {
        const target = targetFrom(source);
        if (!target) {
            res.status(400).json({ success: false, error: 'type and path are required' });
            return null;
        }

        const spaceRef = (source && (source.spaceName || source.space))
            || req.query.space || req.query.spaceName;
        const { space, baseDir, identity } = await context(req, spaceRef);

        if (!targetVisible(space, target.type, target.path)) {
            res.status(403).json({ success: false, error: 'Path is not available in this space' });
            return null;
        }
        return { baseDir, identity, target };
    }

    /** Validate a server-minted id, answering 400 when it is not one. */
    function noteId(req, res) {
        const id = String(req.params.id || '');
        if (ID_PATTERN.test(id)) return id;
        res.status(400).json({ success: false, error: 'Invalid note id' });
        return null;
    }

    /** Resolve the request to { space, baseDir, identity }, or throw. */
    async function context(req, spaceRef) {
        const space = await spaceUserStore.resolveSpace(appBaseDir, spaceRef);
        const baseDir = await spaceUserStore.resolveSpaceDir(appBaseDir, spaceRef);
        return { space, baseDir, identity: req.user.email };
    }

    /**
     * Is `space` willing to show this path at all? Notes are per-path, so a
     * space that excludes the path must neither list nor accept notes for it —
     * the same check `filterVisible` applies to pins, expressed for one target.
     */
    function targetVisible(space, type, targetPath) {
        const normalised = noteStore.normalisePath(targetPath);
        // The space root is always reachable; there is nothing to exclude.
        if (!normalised) return true;
        const record = { type: noteStore.normaliseType(type), path: normalised };
        return userArtifacts.filterVisible(space, [record]).length > 0;
    }

    function requireAuth(req, res) {
        if (req.isAuthenticated && req.isAuthenticated()) return true;
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return false;
    }

    /**
     * GET /applications/wiki/api/notes?space=<name|id>&type=<document|folder>&path=<path>
     *
     * The current user's notes about one piece of content, newest edit first.
     * An excluded path answers with an empty list rather than a 403 — the
     * client asks for this on every navigation, and a curated space hiding a
     * path is not an error worth surfacing.
     */
    app.get('/applications/wiki/api/notes', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;

            // A curated-away path answers with an empty list rather than the
            // 403 `located` would give: the client asks on every navigation,
            // and a space hiding a path is not an error worth surfacing.
            const target = { type: req.query.type, path: req.query.path || '' };
            const { space, baseDir, identity } = await context(
                req, req.query.space || req.query.spaceName
            );
            if (!targetVisible(space, target.type, target.path)) {
                return res.json({ success: true, notes: [] });
            }

            const notes = await noteStore.listForTarget(baseDir, identity, target);
            res.json({ success: true, notes });
        } catch (err) {
            log.error('[Notes] GET failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * GET /applications/wiki/api/notes/count?space=&type=&path=
     *
     * How many notes the user holds about this content — what the header badge
     * needs. Reads the index only, never a note body.
     */
    app.get('/applications/wiki/api/notes/count', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;

            const target = { type: req.query.type, path: req.query.path || '' };
            const { space, baseDir, identity } = await context(
                req, req.query.space || req.query.spaceName
            );
            if (!targetVisible(space, target.type, target.path)) {
                return res.json({ success: true, count: 0 });
            }

            // Only this folder's index is read, not the whole content root.
            const key = noteStore.targetKey(target.type, target.path);
            const index = await noteStore.listIndex(baseDir, identity, target);
            const count = index.filter(r => noteStore.targetKey(r.type, r.path) === key).length;
            res.json({ success: true, count });
        } catch (err) {
            log.error('[Notes] count failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /applications/wiki/api/notes
     * Body: { spaceName?, type, path, title?, text? }
     *
     * `spaceName` picks the content root to write to; it is not recorded.
     */
    app.post('/applications/wiki/api/notes', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;

            const { text } = req.body || {};
            if (String(text || '').length > noteStore.MAX_TEXT_LENGTH) {
                return res.status(400).json({
                    success: false,
                    error: `A note is limited to ${noteStore.MAX_TEXT_LENGTH} characters`
                });
            }

            const ctx = await located(req, res, req.body);
            if (!ctx) return;

            const note = await noteStore.create(ctx.baseDir, ctx.identity, {
                ...ctx.target, text
            });
            res.json({ success: true, note });
        } catch (err) {
            log.error('[Notes] POST failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * PUT /applications/wiki/api/notes/:id
     * Body: { spaceName?, type, path, text }
     *
     * Replaces the body. An unknown id is a 404 rather than a silent create —
     * the panel autosaves, so a note deleted in another tab would otherwise
     * come back the moment the first tab flushed a keystroke.
     */
    app.put('/applications/wiki/api/notes/:id', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;

            const id = String(req.params.id || '');
            if (!ID_PATTERN.test(id)) {
                return res.status(400).json({ success: false, error: 'Invalid note id' });
            }
            const { text } = req.body || {};
            if (String(text || '').length > noteStore.MAX_TEXT_LENGTH) {
                return res.status(400).json({
                    success: false,
                    error: `A note is limited to ${noteStore.MAX_TEXT_LENGTH} characters`
                });
            }

            const ctx = await located(req, res, req.body);
            if (!ctx) return;
            const note = await noteStore.update(ctx.baseDir, ctx.identity, ctx.target, id, text);
            if (!note) {
                return res.status(404).json({ success: false, error: 'Note not found' });
            }
            res.json({ success: true, note });
        } catch (err) {
            log.error('[Notes] PUT failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE /applications/wiki/api/notes/:id
     * Body or query: { spaceName?, type, path }
     */
    app.delete('/applications/wiki/api/notes/:id', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;

            const id = String(req.params.id || '');
            if (!ID_PATTERN.test(id)) {
                return res.status(400).json({ success: false, error: 'Invalid note id' });
            }
            const ctx = await located(req, res, (req.body && req.body.path != null) ? req.body : req.query);
            if (!ctx) return;
            const note = await noteStore.remove(ctx.baseDir, ctx.identity, ctx.target, id);
            if (!note) {
                return res.status(404).json({ success: false, error: 'Note not found' });
            }
            res.json({ success: true, note });
        } catch (err) {
            log.error('[Notes] DELETE failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /applications/wiki/api/notes/audio
     * multipart: audio=<blob>, spaceName?, type, path, title?, text?, durationMs?
     *
     * Create a note that has a recording.
     *
     * `/notes/audio` and `/notes/:id` are both two segments, so this route is
     * one POST away from the dead-literal-route trap the workflows API hit: a
     * `POST /notes/:id` registered ABOVE it would swallow every request here as
     * a note whose id is the literal string "audio", and the symptom would be a
     * 404 that looks like a missing endpoint. Only PUT and DELETE are bound to
     * `/notes/:id` today, so nothing shadows it — if a POST is ever added
     * there, it belongs BELOW this route.
     */
    app.post('/applications/wiki/api/notes/audio', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;
            if (!await receiveAudio(req, res)) return;

            const audio = audioFrom(req);
            if (!audio) {
                return res.status(400).json({ success: false, error: 'No recording was uploaded' });
            }

            const ctx = await located(req, res, req.body);
            if (!ctx) return;

            const note = await noteStore.create(ctx.baseDir, ctx.identity, {
                ...ctx.target, text: (req.body || {}).text, audio
            });
            res.json({ success: true, note });
        } catch (err) {
            log.error('[Notes] voice note create failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /applications/wiki/api/notes/:id/audio
     * multipart: audio=<blob>, spaceName?, type, path, durationMs?
     *
     * Attach a recording to a note that already exists, replacing any recording
     * it already had. An unknown id is a 404 for the same reason PUT is: the
     * panel keeps working while a second tab deletes things.
     */
    app.post('/applications/wiki/api/notes/:id/audio', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;
            const id = noteId(req, res);
            if (!id) return;
            if (!await receiveAudio(req, res)) return;

            const audio = audioFrom(req);
            if (!audio) {
                return res.status(400).json({ success: false, error: 'No recording was uploaded' });
            }

            const ctx = await located(req, res, req.body);
            if (!ctx) return;
            const note = await noteStore.attachAudio(ctx.baseDir, ctx.identity, ctx.target, id, audio);
            if (!note) {
                return res.status(404).json({ success: false, error: 'Note not found' });
            }
            res.json({ success: true, note });
        } catch (err) {
            if (err.code === 'UNSUPPORTED_AUDIO_TYPE') {
                return res.status(415).json({ success: false, error: err.message });
            }
            log.error('[Notes] audio attach failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * GET /applications/wiki/api/notes/:id/audio?space=&type=&path=
     *
     * The recording itself, addressed by NOTE id — the on-disk name never
     * leaves noteStore, so a client cannot name a file here any more than it
     * can when reading a note's text. See `sendAttachment` for the headers.
     */
    app.get('/applications/wiki/api/notes/:id/audio', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;
            const id = noteId(req, res);
            if (!id) return;

            const ctx = await located(req, res, req.query);
            if (!ctx) return;
            const found = await noteStore.readAudio(ctx.baseDir, ctx.identity, ctx.target, id);
            if (!found) {
                return res.status(404).json({ success: false, error: 'Recording not found' });
            }

            // The recording time is in the seed, so re-recording changes the
            // ETag and a player cannot go on serving the old take from cache.
            return sendAttachment(req, res, found, `${id}-${found.audio.recordedAt || ''}`);
        } catch (err) {
            log.error('[Notes] audio read failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE /applications/wiki/api/notes/:id/audio (+ type & path)
     *
     * Drop the recording, keep the note. Separate from deleting the note so a
     * bad take can be discarded without losing a caption typed beside it.
     */
    app.delete('/applications/wiki/api/notes/:id/audio', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;
            const id = noteId(req, res);
            if (!id) return;

            const ctx = await located(req, res, (req.body && req.body.path != null) ? req.body : req.query);
            if (!ctx) return;
            const note = await noteStore.removeAudio(ctx.baseDir, ctx.identity, ctx.target, id);
            if (!note) {
                return res.status(404).json({ success: false, error: 'Note not found' });
            }
            res.json({ success: true, note });
        } catch (err) {
            log.error('[Notes] audio delete failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /applications/wiki/api/notes/images
     * multipart: image=<blob>, spaceName?, type, path, title?, text?, width?, height?
     *
     * Create a note from a pasted picture. Same shape and the same reasoning as
     * POST /notes/audio, including its position above the `:id` routes: this is
     * two segments, so a `POST /notes/:id` added ABOVE it would read every
     * request here as a note whose id is the literal string "images".
     */
    app.post('/applications/wiki/api/notes/images', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;
            if (!await receiveImage(req, res)) return;

            const image = imageFrom(req);
            if (!image) {
                return res.status(400).json({ success: false, error: 'No picture was uploaded' });
            }

            const ctx = await located(req, res, req.body);
            if (!ctx) return;

            const note = await noteStore.create(ctx.baseDir, ctx.identity, {
                ...ctx.target, text: (req.body || {}).text, images: [image]
            });
            res.json({ success: true, note });
        } catch (err) {
            if (err.code === 'UNSUPPORTED_IMAGE_TYPE') {
                return res.status(415).json({ success: false, error: err.message });
            }
            log.error('[Notes] picture note create failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * POST /applications/wiki/api/notes/:id/images
     * multipart: image=<blob>, spaceName?, type, path, width?, height?
     *
     * Paste a picture into a note that already exists. Unlike a recording this
     * ADDS rather than replaces — a note holds several pictures — so a full
     * note answers 409 with a message the panel can show, rather than quietly
     * discarding what the user just pasted.
     */
    app.post('/applications/wiki/api/notes/:id/images', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;
            const id = noteId(req, res);
            if (!id) return;
            if (!await receiveImage(req, res)) return;

            const image = imageFrom(req);
            if (!image) {
                return res.status(400).json({ success: false, error: 'No picture was uploaded' });
            }

            const ctx = await located(req, res, req.body);
            if (!ctx) return;
            const note = await noteStore.addImage(ctx.baseDir, ctx.identity, ctx.target, id, image);
            if (!note) {
                return res.status(404).json({ success: false, error: 'Note not found' });
            }
            res.json({ success: true, note });
        } catch (err) {
            if (err.code === 'TOO_MANY_IMAGES') {
                return res.status(409).json({ success: false, error: err.message });
            }
            if (err.code === 'UNSUPPORTED_IMAGE_TYPE') {
                return res.status(415).json({ success: false, error: err.message });
            }
            log.error('[Notes] picture add failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * GET /applications/wiki/api/notes/:id/images/:imageId?space=&type=&path=
     *
     * One picture, addressed by note id plus picture id — neither of which is
     * a file name. See `sendAttachment` for the headers, `nosniff` included:
     * the stored type came from what the browser SAID it was pasting.
     */
    app.get('/applications/wiki/api/notes/:id/images/:imageId', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;
            const id = noteId(req, res);
            if (!id) return;
            const imageId = String(req.params.imageId || '');
            if (!ID_PATTERN.test(imageId)) {
                return res.status(400).json({ success: false, error: 'Invalid picture id' });
            }

            const ctx = await located(req, res, req.query);
            if (!ctx) return;
            const found = await noteStore.readImage(ctx.baseDir, ctx.identity, ctx.target, id, imageId);
            if (!found) {
                return res.status(404).json({ success: false, error: 'Picture not found' });
            }

            // A picture is never edited in place — removing one and pasting
            // another mints a fresh id — so its own id is a sufficient seed.
            return sendAttachment(req, res, found, imageId);
        } catch (err) {
            log.error('[Notes] picture read failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    /**
     * DELETE /applications/wiki/api/notes/:id/images/:imageId (+ type & path)
     *
     * Remove one picture, keeping the note, its words and its other pictures.
     */
    app.delete('/applications/wiki/api/notes/:id/images/:imageId', async (req, res) => {
        try {
            if (!requireAuth(req, res)) return;
            const id = noteId(req, res);
            if (!id) return;
            const imageId = String(req.params.imageId || '');
            if (!ID_PATTERN.test(imageId)) {
                return res.status(400).json({ success: false, error: 'Invalid picture id' });
            }

            const ctx = await located(req, res, (req.body && req.body.path != null) ? req.body : req.query);
            if (!ctx) return;
            const note = await noteStore.removeImage(ctx.baseDir, ctx.identity, ctx.target, id, imageId);
            if (!note) {
                return res.status(404).json({ success: false, error: 'Picture not found' });
            }
            res.json({ success: true, note });
        } catch (err) {
            log.error('[Notes] picture delete failed:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    log.info('✓ Wiki user notes routes registered');
};
