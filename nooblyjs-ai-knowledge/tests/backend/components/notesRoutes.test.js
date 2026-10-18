/**
 * @fileoverview /applications/wiki/api/notes — private per-user notes.
 *
 * The store (components/noteStore.js) is covered by noteStore.test.js. What
 * these tests pin is what the HTTP layer adds on top of it, all of which has
 * bitten a sibling feature before:
 *
 *  1. NOTES ARE SCOPED BY REAL VISIBILITY, NOT BY A SPACE NAME. Several spaces
 *     are views of ONE content root, so notes land in one store — exactly like
 *     pins. A space that excludes a path must not list or accept notes for it,
 *     and (this is the part a name stamp never gave) a note written from one
 *     view is still there from another view of the same root. Stamping the
 *     space name instead is what orphaned every pin on a rename; see
 *     components/userArtifacts.js.
 *  2. AN UNKNOWN ID IS A 404, NEVER A CREATE. The panel autosaves, so a note
 *     deleted in a second tab would otherwise resurrect itself the moment the
 *     first tab flushed a keystroke.
 *  3. AN ID IS SERVER-MINTED. A path-shaped id must be refused rather than
 *     reaching the filesystem.
 *  4. VOICE NOTES GO THROUGH THE SAME GATES. A recording is an attachment on
 *     an ordinary note, so a curated-away path must refuse one exactly as it
 *     refuses a typed note; and playback is addressed by NOTE id, so the
 *     response headers (range, revalidation, `private`) are the interesting
 *     part rather than any path handling.
 *
 * Note that multer passes a NON-MULTIPART request straight through without an
 * error, so these tests set `req.file` directly and still exercise the real
 * handler — including the visibility check and the duration handling.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GET = 'GET /applications/wiki/api/notes';
const COUNT = 'GET /applications/wiki/api/notes/count';
const POST = 'POST /applications/wiki/api/notes';
const PUT = 'PUT /applications/wiki/api/notes/:id';
const DELETE = 'DELETE /applications/wiki/api/notes/:id';
const POST_AUDIO = 'POST /applications/wiki/api/notes/audio';
const ATTACH_AUDIO = 'POST /applications/wiki/api/notes/:id/audio';
const GET_AUDIO = 'GET /applications/wiki/api/notes/:id/audio';
const DELETE_AUDIO = 'DELETE /applications/wiki/api/notes/:id/audio';
const POST_IMAGE = 'POST /applications/wiki/api/notes/images';
const ADD_IMAGE = 'POST /applications/wiki/api/notes/:id/images';
const GET_IMAGE = 'GET /applications/wiki/api/notes/:id/images/:imageId';
const DELETE_IMAGE = 'DELETE /applications/wiki/api/notes/:id/images/:imageId';

/** Minimal Express double: records handlers by "METHOD path". */
function makeApp() {
    const routes = new Map();
    const record = (method) => (routePath, ...handlers) => {
        routes.set(`${method} ${routePath}`, handlers[handlers.length - 1]);
    };
    return { get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE'), routes };
}

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        ended: false,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; return this; },
        end(payload) {
            this.ended = true;
            if (payload !== undefined) this.body = payload;
            return this;
        }
    };
}

/** A logged-in request. `authenticated: false` produces an anonymous one. */
function makeReq({
    query = {}, body = {}, params = {}, authenticated = true, headers = {}, file = null
} = {}) {
    return {
        query,
        body,
        params,
        headers,
        file,
        user: { email: 'srbooysen@example.com' },
        isAuthenticated: () => authenticated
    };
}

/** An uploaded recording, as multer would hand it to the handler. */
function upload(buffer, mimetype = 'audio/webm;codecs=opus') {
    return { buffer, mimetype, fieldname: 'audio', originalname: 'recording.webm' };
}

/** An uploaded picture, as multer would hand it to the handler. */
function pasted(buffer, mimetype = 'image/png') {
    return { buffer, mimetype, fieldname: 'image', originalname: 'pasted.png' };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * The target these suites work against, and where its notes therefore live.
 *
 * Notes are FOLDER-LOCAL, so every request — id-addressed ones included —
 * carries `type` + `path`: that is what tells the server which folder's index
 * holds the note. `WHERE` is the directory that implies.
 */
const TARGET = { type: 'folder', path: 'Solution Design' };
const WHERE = ['Solution Design', '.system', 'useractivity', 'srbooysen', 'notes'];

/** Request fields identifying the target, plus whatever else a call needs. */
function about(extra = {}) {
    return { spaceName: 'Engineering', ...TARGET, ...extra };
}

async function call(routes, key, req) {
    const res = makeRes();
    await routes.get(key)(req, res);
    return res;
}

describe('notes routes', () => {
    let appBaseDir;
    let contentRoot;
    let routes;

    beforeEach(() => {
        appBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-routes-'));
        contentRoot = path.join(appBaseDir, 'content');
        fs.mkdirSync(path.join(appBaseDir, 'spaces'), { recursive: true });
        fs.mkdirSync(path.join(contentRoot, 'Solution Design'), { recursive: true });

        // Two VIEWS of one content root — the arrangement in production.
        // "Engineering" sees everything; "Fintech" excludes Solution Design.
        fs.writeFileSync(
            path.join(appBaseDir, 'spaces', 'spaces.json'),
            JSON.stringify([
                { id: 1, name: 'Engineering', visibility: 'public', path: contentRoot },
                {
                    id: 2, name: 'Fintech', visibility: 'public', path: contentRoot,
                    configuration: { excludedPaths: ['Solution Design/'] }
                }
            ]),
            'utf8'
        );

        const app = makeApp();
        require('../../../src/wiki/routes/notesRoutes')(
            { app }, null, { log: noopLog, appBaseDir }
        );
        routes = app.routes;
    });

    afterEach(() => {
        fs.rmSync(appBaseDir, { recursive: true, force: true });
    });

    test('every verb is registered', () => {
        [GET, COUNT, POST, PUT, DELETE].forEach(route => {
            expect(routes.has(route)).toBe(true);
        });
    });

    test('an anonymous request is refused', async () => {
        const res = await call(routes, GET, makeReq({ authenticated: false }));
        expect(res.statusCode).toBe(401);
    });

    test('create → list → update → delete, round trip', async () => {
        const created = await call(routes, POST, makeReq({
            body: {
                spaceName: 'Engineering', type: 'folder',
                path: 'Solution Design', title: 'Solution Design',
                text: 'Ask about the Q3 capacity plan.'
            }
        }));
        expect(created.body.success).toBe(true);
        const id = created.body.note.id;

        // The note landed as a .txt named after the content, as promised.
        const file = path.join(contentRoot, ...WHERE, 'solution-design.txt');
        expect(fs.readFileSync(file, 'utf8')).toBe('Ask about the Q3 capacity plan.');

        const listed = await call(routes, GET, makeReq({
            query: { space: 'Engineering', type: 'folder', path: 'Solution Design' }
        }));
        expect(listed.body.notes).toHaveLength(1);
        expect(listed.body.notes[0].text).toBe('Ask about the Q3 capacity plan.');

        const counted = await call(routes, COUNT, makeReq({
            query: { space: 'Engineering', type: 'folder', path: 'Solution Design' }
        }));
        expect(counted.body.count).toBe(1);

        const updated = await call(routes, PUT, makeReq({
            params: { id }, body: about({ text: 'Answered — capacity is fine.' })
        }));
        expect(updated.body.note.text).toBe('Answered — capacity is fine.');
        expect(fs.readFileSync(file, 'utf8')).toBe('Answered — capacity is fine.');

        const removed = await call(routes, DELETE, makeReq({
            params: { id }, body: about()
        }));
        expect(removed.body.success).toBe(true);
        expect(fs.existsSync(file)).toBe(false);
    });

    test('a note written in one view is visible from another view of the same root', async () => {
        await call(routes, POST, makeReq({
            body: { spaceName: 'Engineering', type: 'document', path: 'Readme.md', title: 'Readme', text: 'shared' }
        }));

        // Fintech excludes Solution Design only — Readme.md is visible to both.
        const listed = await call(routes, GET, makeReq({
            query: { space: 'Fintech', type: 'document', path: 'Readme.md' }
        }));
        expect(listed.body.notes).toHaveLength(1);
        expect(listed.body.notes[0].text).toBe('shared');
    });

    test('a space that excludes the path neither lists nor accepts notes for it', async () => {
        await call(routes, POST, makeReq({
            body: { spaceName: 'Engineering', type: 'folder', path: 'Solution Design', title: 'SD', text: 'private' }
        }));

        const listed = await call(routes, GET, makeReq({
            query: { space: 'Fintech', type: 'folder', path: 'Solution Design' }
        }));
        expect(listed.body.notes).toEqual([]);

        const counted = await call(routes, COUNT, makeReq({
            query: { space: 'Fintech', type: 'folder', path: 'Solution Design' }
        }));
        expect(counted.body.count).toBe(0);

        const refused = await call(routes, POST, makeReq({
            body: { spaceName: 'Fintech', type: 'folder', path: 'Solution Design', title: 'SD', text: 'nope' }
        }));
        expect(refused.statusCode).toBe(403);
    });

    test('the space root is always noteable, even in a curated space', async () => {
        const created = await call(routes, POST, makeReq({
            body: { spaceName: 'Fintech', type: 'folder', path: '', title: 'Fintech', text: 'about this space' }
        }));
        expect(created.statusCode).toBe(200);
        expect(created.body.note.path).toBe('');
    });

    test('updating an unknown id is a 404, not a create', async () => {
        const res = await call(routes, PUT, makeReq({
            params: { id: 'nsuchthing' }, body: about({ text: 'ghost' })
        }));
        expect(res.statusCode).toBe(404);
    });

    test('a path-shaped id is refused before it reaches the filesystem', async () => {
        const res = await call(routes, PUT, makeReq({
            params: { id: '../../../../etc/passwd' }, body: about({ text: 'x' })
        }));
        expect(res.statusCode).toBe(400);

        const del = await call(routes, DELETE, makeReq({ params: { id: '../../etc/passwd' } }));
        expect(del.statusCode).toBe(400);
    });

    test('POST without a path is a 400', async () => {
        const res = await call(routes, POST, makeReq({ body: { spaceName: 'Engineering', type: 'folder' } }));
        expect(res.statusCode).toBe(400);
    });

    test('an over-long body is refused rather than silently truncated', async () => {
        const noteStore = require('../../../src/wiki/components/noteStore');
        const res = await call(routes, POST, makeReq({
            body: {
                spaceName: 'Engineering', type: 'document', path: 'Readme.md',
                text: 'x'.repeat(noteStore.MAX_TEXT_LENGTH + 1)
            }
        }));
        expect(res.statusCode).toBe(400);
    });

    test('the note record carries no space stamp — it belongs to a path', async () => {
        const created = await call(routes, POST, makeReq({
            body: { spaceName: 'Engineering', type: 'document', path: 'Readme.md', title: 'Readme', text: 'x' }
        }));
        expect(created.body.note.spaceName).toBeUndefined();

        const index = JSON.parse(fs.readFileSync(
            path.join(contentRoot, '.system', 'useractivity', 'srbooysen', 'notes', 'notes.json'),
            'utf8'
        ));
        expect(index).toHaveLength(1);
        expect(index[0].spaceName).toBeUndefined();
    });
});

describe('notes routes — voice notes', () => {
    let appBaseDir;
    let contentRoot;
    let routes;

    const TAKE = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x11, 0x22, 0x33, 0x44]);

    beforeEach(() => {
        appBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-audio-'));
        contentRoot = path.join(appBaseDir, 'content');
        fs.mkdirSync(path.join(appBaseDir, 'spaces'), { recursive: true });
        fs.mkdirSync(path.join(contentRoot, 'Solution Design'), { recursive: true });

        fs.writeFileSync(
            path.join(appBaseDir, 'spaces', 'spaces.json'),
            JSON.stringify([
                { id: 1, name: 'Engineering', visibility: 'public', path: contentRoot },
                {
                    id: 2, name: 'Fintech', visibility: 'public', path: contentRoot,
                    configuration: { excludedPaths: ['Solution Design/'] }
                }
            ]),
            'utf8'
        );

        const app = makeApp();
        require('../../../src/wiki/routes/notesRoutes')(
            { app }, null, { log: noopLog, appBaseDir }
        );
        routes = app.routes;
    });

    afterEach(() => {
        fs.rmSync(appBaseDir, { recursive: true, force: true });
    });

    /** Create a voice note about Solution Design, as Engineering. */
    async function createVoiceNote(extra = {}) {
        const res = await call(routes, POST_AUDIO, makeReq({
            file: upload(TAKE),
            body: {
                spaceName: 'Engineering', type: 'folder',
                path: 'Solution Design', title: 'Solution Design',
                durationMs: '7400', ...extra
            }
        }));
        return res;
    }

    test('every audio verb is registered', () => {
        [POST_AUDIO, ATTACH_AUDIO, GET_AUDIO, DELETE_AUDIO].forEach(route => {
            expect(routes.has(route)).toBe(true);
        });
    });

    test('an anonymous request cannot record', async () => {
        const res = await call(routes, POST_AUDIO, makeReq({ authenticated: false }));
        expect(res.statusCode).toBe(401);
    });

    test('a voice note is created in ONE request, recording and all', async () => {
        const res = await createVoiceNote();

        expect(res.body.success).toBe(true);
        expect(res.body.note.audio).toMatchObject({ mime: 'audio/webm', durationMs: 7400 });

        // On disk beside the body, under the content's own name.
        const dir = path.join(contentRoot, ...WHERE);
        expect(fs.readdirSync(dir).sort())
            .toEqual(['notes.json', 'solution-design.txt', 'solution-design.webm']);
    });

    test('a voice note is counted and listed like any other note', async () => {
        const created = await createVoiceNote();

        const listed = await call(routes, GET, makeReq({
            query: { space: 'Engineering', type: 'folder', path: 'Solution Design' }
        }));
        expect(listed.body.notes).toHaveLength(1);
        expect(listed.body.notes[0].id).toBe(created.body.note.id);

        const counted = await call(routes, COUNT, makeReq({
            query: { space: 'Engineering', type: 'folder', path: 'Solution Design' }
        }));
        expect(counted.body.count).toBe(1);
    });

    test('a space that curates the path away refuses the recording', async () => {
        // Same gate as a typed note: a recording must not be a way in.
        const res = await call(routes, POST_AUDIO, makeReq({
            file: upload(TAKE),
            body: { spaceName: 'Fintech', type: 'folder', path: 'Solution Design' }
        }));
        expect(res.statusCode).toBe(403);
    });

    test('a request with no recording attached is a 400, not an empty note', async () => {
        const res = await call(routes, POST_AUDIO, makeReq({
            body: { spaceName: 'Engineering', type: 'folder', path: 'Solution Design' }
        }));
        expect(res.statusCode).toBe(400);
    });

    test('a recording can be attached to a note that was typed first', async () => {
        const created = await call(routes, POST, makeReq({
            body: {
                spaceName: 'Engineering', type: 'folder',
                path: 'Solution Design', title: 'Solution Design', text: 'typed first'
            }
        }));
        const id = created.body.note.id;

        const attached = await call(routes, ATTACH_AUDIO, makeReq({
            params: { id },
            file: upload(TAKE),
            body: about({ durationMs: '2000' })
        }));

        expect(attached.body.note.audio.durationMs).toBe(2000);
        expect(attached.body.note.text).toBe('typed first');
    });

    test('attaching to an unknown id is a 404, never a create', async () => {
        const res = await call(routes, ATTACH_AUDIO, makeReq({
            params: { id: 'nsuchthing' },
            file: upload(TAKE),
            body: about()
        }));
        expect(res.statusCode).toBe(404);
    });

    test('a path-shaped id is refused before it reaches the filesystem', async () => {
        for (const route of [ATTACH_AUDIO, GET_AUDIO, DELETE_AUDIO]) {
            const res = await call(routes, route, makeReq({
                params: { id: '../../../../etc/passwd' },
                file: upload(TAKE),
                query: about(),
                body: about()
            }));
            expect(res.statusCode).toBe(400);
        }
    });

    test('playback returns the bytes, typed and privately cacheable', async () => {
        const created = await createVoiceNote();
        const res = await call(routes, GET_AUDIO, makeReq({
            params: { id: created.body.note.id },
            query: about()
        }));

        expect(res.statusCode).toBe(200);
        expect(Buffer.from(res.body).equals(TAKE)).toBe(true);
        expect(res.headers['content-type']).toBe('audio/webm');
        expect(res.headers['content-length']).toBe(TAKE.length);
        expect(res.headers['accept-ranges']).toBe('bytes');
        // `private` — one person's note must never sit in a shared cache.
        expect(res.headers['cache-control']).toContain('private');
        expect(res.headers.etag).toBeTruthy();
    });

    test('an unchanged recording revalidates to 304 rather than downloading again', async () => {
        const created = await createVoiceNote();
        const first = await call(routes, GET_AUDIO, makeReq({
            params: { id: created.body.note.id }, query: about()
        }));

        const second = await call(routes, GET_AUDIO, makeReq({
            params: { id: created.body.note.id },
            query: about(),
            headers: { 'if-none-match': first.headers.etag }
        }));
        expect(second.statusCode).toBe(304);
    });

    test('re-recording changes the ETag, so a player cannot keep the old take', async () => {
        const created = await createVoiceNote();
        const id = created.body.note.id;
        const before = await call(routes, GET_AUDIO, makeReq({
            params: { id }, query: about()
        }));

        await call(routes, ATTACH_AUDIO, makeReq({
            params: { id },
            file: upload(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x99])),
            body: about()
        }));

        const after = await call(routes, GET_AUDIO, makeReq({
            params: { id }, query: about()
        }));
        expect(after.headers.etag).not.toBe(before.headers.etag);
    });

    test('a range request is answered with 206 and just that slice', async () => {
        // An <audio> element issues one the moment the listener drags the scrub
        // bar; answering 200-with-everything leaves Safari unable to seek.
        const created = await createVoiceNote();
        const res = await call(routes, GET_AUDIO, makeReq({
            params: { id: created.body.note.id },
            query: about(),
            headers: { range: 'bytes=2-5' }
        }));

        expect(res.statusCode).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 2-5/${TAKE.length}`);
        expect(res.headers['content-length']).toBe(4);
        expect(Buffer.from(res.body).equals(TAKE.subarray(2, 6))).toBe(true);
    });

    test('an open-ended range runs to the end of the recording', async () => {
        const created = await createVoiceNote();
        const res = await call(routes, GET_AUDIO, makeReq({
            params: { id: created.body.note.id },
            query: about(),
            headers: { range: 'bytes=4-' }
        }));

        expect(res.statusCode).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 4-${TAKE.length - 1}/${TAKE.length}`);
    });

    test('a range starting past the end is a 416, not an empty 206', async () => {
        const created = await createVoiceNote();
        const res = await call(routes, GET_AUDIO, makeReq({
            params: { id: created.body.note.id },
            query: about(),
            headers: { range: `bytes=${TAKE.length + 10}-` }
        }));
        expect(res.statusCode).toBe(416);
    });

    test('asking for the audio of a note that has none is a 404', async () => {
        const created = await call(routes, POST, makeReq({
            body: {
                spaceName: 'Engineering', type: 'folder',
                path: 'Solution Design', title: 'Solution Design', text: 'words only'
            }
        }));
        const res = await call(routes, GET_AUDIO, makeReq({
            params: { id: created.body.note.id }, query: about()
        }));
        expect(res.statusCode).toBe(404);
    });

    test('removing the recording keeps the note; deleting the note removes both', async () => {
        const created = await createVoiceNote({ text: 'a caption' });
        const id = created.body.note.id;
        const dir = path.join(contentRoot, ...WHERE);

        const dropped = await call(routes, DELETE_AUDIO, makeReq({
            params: { id }, body: about()
        }));
        expect(dropped.body.note.audio).toBeNull();
        expect(dropped.body.note.text).toBe('a caption');
        expect(fs.readdirSync(dir)).not.toContain('solution-design.webm');
        expect(fs.readdirSync(dir)).toContain('solution-design.txt');

        await call(routes, DELETE, makeReq({ params: { id }, body: about() }));
        expect(fs.readdirSync(dir)).toEqual(['notes.json']);
    });

    test('a voice note made in one view is there in another view of the same root', async () => {
        // The pins failure in miniature: nothing stamps a space name, so the
        // recording follows the path, not the view it was made in.
        await call(routes, POST_AUDIO, makeReq({
            file: upload(TAKE),
            body: { spaceName: 'Engineering', type: 'folder', path: '', title: 'Home' }
        }));

        const fromFintech = await call(routes, GET, makeReq({
            query: { space: 'Fintech', type: 'folder', path: '' }
        }));
        expect(fromFintech.body.notes).toHaveLength(1);
        expect(fromFintech.body.notes[0].audio.mime).toBe('audio/webm');
    });
});

describe('notes routes — pictures', () => {
    let appBaseDir;
    let contentRoot;
    let routes;

    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x07]);

    beforeEach(() => {
        appBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-img-'));
        contentRoot = path.join(appBaseDir, 'content');
        fs.mkdirSync(path.join(appBaseDir, 'spaces'), { recursive: true });
        fs.mkdirSync(path.join(contentRoot, 'Solution Design'), { recursive: true });

        fs.writeFileSync(
            path.join(appBaseDir, 'spaces', 'spaces.json'),
            JSON.stringify([
                { id: 1, name: 'Engineering', visibility: 'public', path: contentRoot },
                {
                    id: 2, name: 'Fintech', visibility: 'public', path: contentRoot,
                    configuration: { excludedPaths: ['Solution Design/'] }
                }
            ]),
            'utf8'
        );

        const app = makeApp();
        require('../../../src/wiki/routes/notesRoutes')(
            { app }, null, { log: noopLog, appBaseDir }
        );
        routes = app.routes;
    });

    afterEach(() => {
        fs.rmSync(appBaseDir, { recursive: true, force: true });
    });

    /** Paste a picture as a new note about Solution Design, as Engineering. */
    async function pasteNewNote(extra = {}) {
        return call(routes, POST_IMAGE, makeReq({
            file: pasted(PNG),
            body: {
                spaceName: 'Engineering', type: 'folder',
                path: 'Solution Design', title: 'Solution Design',
                width: '1920', height: '1080', ...extra
            }
        }));
    }

    test('every picture verb is registered', () => {
        [POST_IMAGE, ADD_IMAGE, GET_IMAGE, DELETE_IMAGE].forEach(route => {
            expect(routes.has(route)).toBe(true);
        });
    });

    test('an anonymous request cannot paste', async () => {
        const res = await call(routes, POST_IMAGE, makeReq({ authenticated: false }));
        expect(res.statusCode).toBe(401);
    });

    test('a pasted picture becomes a note in ONE request', async () => {
        const res = await pasteNewNote();

        expect(res.body.success).toBe(true);
        expect(res.body.note.images).toHaveLength(1);
        expect(res.body.note.images[0]).toMatchObject({
            mime: 'image/png', width: 1920, height: 1080
        });

        const dir = path.join(contentRoot, ...WHERE);
        expect(fs.readdirSync(dir).sort())
            .toEqual(['notes.json', 'solution-design.png', 'solution-design.txt']);
    });

    test('a picture note is counted and listed like any other note', async () => {
        await pasteNewNote();

        const counted = await call(routes, COUNT, makeReq({
            query: { space: 'Engineering', type: 'folder', path: 'Solution Design' }
        }));
        expect(counted.body.count).toBe(1);
    });

    test('a space that curates the path away refuses the picture', async () => {
        const res = await call(routes, POST_IMAGE, makeReq({
            file: pasted(PNG),
            body: { spaceName: 'Fintech', type: 'folder', path: 'Solution Design' }
        }));
        expect(res.statusCode).toBe(403);
    });

    test('a request with no picture attached is a 400, not an empty note', async () => {
        const res = await call(routes, POST_IMAGE, makeReq({
            body: { spaceName: 'Engineering', type: 'folder', path: 'Solution Design' }
        }));
        expect(res.statusCode).toBe(400);
    });

    test('a picture can be pasted into a note that was typed first', async () => {
        const created = await call(routes, POST, makeReq({
            body: {
                spaceName: 'Engineering', type: 'folder',
                path: 'Solution Design', title: 'Solution Design', text: 'typed first'
            }
        }));

        const added = await call(routes, ADD_IMAGE, makeReq({
            params: { id: created.body.note.id },
            file: pasted(PNG),
            body: about()
        }));

        expect(added.body.note.images).toHaveLength(1);
        expect(added.body.note.text).toBe('typed first');
    });

    test('pasting a second picture ADDS rather than replacing', async () => {
        // The difference from a recording, which replaces.
        const created = await pasteNewNote();
        const id = created.body.note.id;

        const added = await call(routes, ADD_IMAGE, makeReq({
            params: { id },
            file: pasted(Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'),
            body: about()
        }));
        expect(added.body.note.images).toHaveLength(2);
    });

    test('a full note refuses the next picture with a message, not silence', async () => {
        const created = await pasteNewNote();
        const id = created.body.note.id;

        let last;
        for (let n = 1; n <= noteStoreMaxImages(); n += 1) {
            last = await call(routes, ADD_IMAGE, makeReq({
                params: { id }, file: pasted(PNG), body: about()
            }));
        }

        expect(last.statusCode).toBe(409);
        expect(last.body.error).toMatch(/pictures/);
    });

    test('pasting into an unknown id is a 404, never a create', async () => {
        const res = await call(routes, ADD_IMAGE, makeReq({
            params: { id: 'nsuchthing' }, file: pasted(PNG), body: about()
        }));
        expect(res.statusCode).toBe(404);
    });

    test('a path-shaped picture id is refused before it reaches the filesystem', async () => {
        const created = await pasteNewNote();
        for (const route of [GET_IMAGE, DELETE_IMAGE]) {
            const res = await call(routes, route, makeReq({
                params: { id: created.body.note.id, imageId: '../../../../etc/passwd' },
                query: about(),
                body: about()
            }));
            expect(res.statusCode).toBe(400);
        }
    });

    test('a picture is served with its type, privately, and nosniff', async () => {
        const created = await pasteNewNote();
        const res = await call(routes, GET_IMAGE, makeReq({
            params: {
                id: created.body.note.id,
                imageId: created.body.note.images[0].id
            },
            query: about()
        }));

        expect(res.statusCode).toBe(200);
        expect(Buffer.from(res.body).equals(PNG)).toBe(true);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['cache-control']).toContain('private');
        // The stored type came from what the BROWSER said it was pasting, so a
        // client must not be left to decide for itself what these bytes are.
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('an unchanged picture revalidates to 304', async () => {
        const created = await pasteNewNote();
        const params = {
            id: created.body.note.id,
            imageId: created.body.note.images[0].id
        };
        const first = await call(routes, GET_IMAGE, makeReq({ params, query: about() }));

        const second = await call(routes, GET_IMAGE, makeReq({
            params,
            query: about(),
            headers: { 'if-none-match': first.headers.etag }
        }));
        expect(second.statusCode).toBe(304);
    });

    test('asking for a picture that is not on the note is a 404', async () => {
        const created = await pasteNewNote();
        const res = await call(routes, GET_IMAGE, makeReq({
            params: { id: created.body.note.id, imageId: 'inope' },
            query: about()
        }));
        expect(res.statusCode).toBe(404);
    });

    test('removing one picture keeps the note; deleting the note removes both', async () => {
        const created = await pasteNewNote({ text: 'a caption' });
        const id = created.body.note.id;
        const imageId = created.body.note.images[0].id;
        const dir = path.join(contentRoot, ...WHERE);

        const dropped = await call(routes, DELETE_IMAGE, makeReq({
            params: { id, imageId }, body: about()
        }));
        expect(dropped.body.note.images).toEqual([]);
        expect(dropped.body.note.text).toBe('a caption');
        expect(fs.readdirSync(dir)).not.toContain('solution-design.png');

        await call(routes, DELETE, makeReq({ params: { id }, body: about() }));
        expect(fs.readdirSync(dir)).toEqual(['notes.json']);
    });

    test('a picture pasted in one view is there in another view of the same root', async () => {
        await call(routes, POST_IMAGE, makeReq({
            file: pasted(PNG),
            body: { spaceName: 'Engineering', type: 'folder', path: '', title: 'Home' }
        }));

        const fromFintech = await call(routes, GET, makeReq({
            query: { space: 'Fintech', type: 'folder', path: '' }
        }));
        expect(fromFintech.body.notes).toHaveLength(1);
        expect(fromFintech.body.notes[0].images).toHaveLength(1);
    });
});

/** The store's own cap, so the 409 test cannot drift away from it. */
function noteStoreMaxImages() {
    return require('../../../src/wiki/components/noteStore').MAX_IMAGES_PER_NOTE;
}
