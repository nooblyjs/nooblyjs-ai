/**
 * @fileoverview /applications/wiki/api/linked-documents — the relationship band.
 *
 * The grammar (components/linkedDocumentBlocks.js) is covered by
 * linkedDocumentBlocks.test.js. What these tests pin is what the HTTP layer adds
 * on top of it, which is entirely about ACCESS — and the resolve endpoint is the
 * one place in this feature where getting it wrong is silent:
 *
 *  1. A REFERENCE MAY NAME ANOTHER SPACE. So every reference is judged against
 *     the space that OWNS it, not the one the caller is browsing — both for
 *     whether the caller can reach that space at all (public / team /
 *     private+allowedUsers, the same rule the spaces list applies) and for
 *     whether that space exposes the path (several spaces share one content
 *     root and each curates a slice of it).
 *  2. THE RULE DEPENDS ON WHAT THE REFERENCE POINTS AT. A file is judged by
 *     `isFileVisible`, whose root-level exemption is what keeps a curated
 *     space's own landing page visible to it; a folder is judged by the
 *     listable `container` rule so a pass-through ancestor of an allowed
 *     subtree stays a real destination. Asking either question of the wrong
 *     kind answers confidently and wrongly — during development the container
 *     rule hid every root-level file, which reads exactly like a broken link.
 *  3. HIDDEN AND MISSING MUST BE INDISTINGUISHABLE INSIDE A HIDDEN SUBTREE, or
 *     resolve becomes a probe for what a curated space is hiding.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const GET = 'GET /applications/wiki/api/linked-documents';
const PUT = 'PUT /applications/wiki/api/linked-documents';
const RESOLVE = 'POST /applications/wiki/api/linked-documents/resolve';

/** Minimal Express double: records handlers by "METHOD path". */
function makeApp() {
    const routes = new Map();
    const record = (method) => (routePath, ...handlers) => {
        routes.set(`${method} ${routePath}`, handlers[handlers.length - 1]);
    };
    return { get: record('GET'), post: record('POST'), put: record('PUT'), routes };
}

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

function makeReq({ query = {}, body = {}, authenticated = true, email = 'member@example.com' } = {}) {
    return { query, body, user: { email }, isAuthenticated: () => authenticated };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

async function call(routes, key, req) {
    const res = makeRes();
    await routes.get(key)(req, res);
    return res;
}

/** kind of each resolved reference, in request order. */
const kinds = (res) => res.body.items.map((i) => i.kind);

describe('linked-documents routes', () => {
    let appBaseDir;
    let contentRoot;
    let routes;

    beforeEach(() => {
        appBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'linked-docs-routes-'));
        contentRoot = path.join(appBaseDir, 'content');
        fs.mkdirSync(path.join(appBaseDir, 'spaces'), { recursive: true });
        fs.mkdirSync(path.join(contentRoot, 'Open', 'Sub'), { recursive: true });
        fs.mkdirSync(path.join(contentRoot, 'Curated'), { recursive: true });

        fs.writeFileSync(path.join(contentRoot, 'home.md'), '# Root landing page\n', 'utf8');
        fs.writeFileSync(path.join(contentRoot, 'Open', '.home.md'), '# Open\n\nProse.\n', 'utf8');
        fs.writeFileSync(path.join(contentRoot, 'Open', 'Sub', 'page.md'), '# Page\n', 'utf8');
        fs.writeFileSync(path.join(contentRoot, 'Curated', 'secret.md'), '# Secret\n', 'utf8');

        // Three views. "Engineering" sees everything. "Fintech" excludes
        // Curated/ — the shared-content-root arrangement in production.
        // "Private" is reachable only by its allowedUsers.
        fs.writeFileSync(
            path.join(appBaseDir, 'spaces', 'spaces.json'),
            JSON.stringify([
                { id: 1, name: 'Engineering', visibility: 'team', path: contentRoot },
                {
                    id: 2, name: 'Fintech', visibility: 'team', path: contentRoot,
                    configuration: { excludedPaths: ['Curated/'] }
                },
                {
                    id: 3, name: 'Private', visibility: 'private', path: contentRoot,
                    allowedUsers: ['member@example.com']
                }
            ]),
            'utf8'
        );

        const app = makeApp();
        require('../../../src/wiki/routes/linkedDocumentsRoutes')(
            { app }, null, { log: noopLog, appBaseDir }
        );
        routes = app.routes;
    });

    afterEach(() => {
        fs.rmSync(appBaseDir, { recursive: true, force: true });
    });

    test('every verb is registered', () => {
        [GET, PUT, RESOLVE].forEach((route) => expect(routes.has(route)).toBe(true));
    });

    test.each([[GET], [PUT], [RESOLVE]])('%s refuses an anonymous request', async (route) => {
        const res = await call(routes, route, makeReq({ authenticated: false }));
        expect(res.statusCode).toBe(401);
    });

    // ---- read / write ------------------------------------------------------

    test('read → write → read round trip', async () => {
        const before = await call(routes, GET, makeReq({
            query: { spaceName: 'Engineering', path: 'Open/.home.md' }
        }));
        expect(before.body).toMatchObject({ success: true, exists: true, hasBlock: false, items: [] });

        const written = await call(routes, PUT, makeReq({
            body: {
                spaceName: 'Engineering', path: 'Open/.home.md', title: 'Related work',
                items: [{ ref: '[Engineering]/Open/Sub', label: '' },
                        { ref: 'Open/Sub/page.md', label: 'The page' }]
            }
        }));
        expect(written.body).toMatchObject({ success: true, changed: true });

        const after = await call(routes, GET, makeReq({
            query: { spaceName: 'Engineering', path: 'Open/.home.md' }
        }));
        expect(after.body.title).toBe('Related work');
        expect(after.body.items).toEqual([
            { ref: '[Engineering]/Open/Sub', label: '' },
            { ref: 'Open/Sub/page.md', label: 'The page' }
        ]);
        // The prose it was written into is untouched.
        expect(fs.readFileSync(path.join(contentRoot, 'Open', '.home.md'), 'utf8')).toContain('Prose.');
    });

    test('an empty list removes the block', async () => {
        await call(routes, PUT, makeReq({
            body: { spaceName: 'Engineering', path: 'Open/.home.md', items: ['[Engineering]/Open/Sub'] }
        }));
        await call(routes, PUT, makeReq({
            body: { spaceName: 'Engineering', path: 'Open/.home.md', items: [] }
        }));
        const raw = fs.readFileSync(path.join(contentRoot, 'Open', '.home.md'), 'utf8');
        expect(raw).not.toContain('```linked-documents');
        expect(raw).toContain('Prose.');
    });

    test('GET on a document that does not exist reports it rather than erroring', async () => {
        const res = await call(routes, GET, makeReq({
            query: { spaceName: 'Engineering', path: 'Open/nope.md' }
        }));
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, exists: false, items: [] });
    });

    test('PUT refuses a non-markdown target', async () => {
        const res = await call(routes, PUT, makeReq({
            body: { spaceName: 'Engineering', path: 'Open/notes.txt', items: [] }
        }));
        expect(res.statusCode).toBe(400);
    });

    test('PUT refuses a traversal out of the content root', async () => {
        const res = await call(routes, PUT, makeReq({
            body: { spaceName: 'Engineering', path: '../../escape.md', items: [] }
        }));
        expect(res.statusCode).toBe(403);
    });

    test('PUT into a space that curates the path away answers 404, never 403', async () => {
        // A 403 would confirm the document exists, which is what the curation
        // is hiding.
        const res = await call(routes, PUT, makeReq({
            body: { spaceName: 'Fintech', path: 'Curated/secret.md', items: [] }
        }));
        expect(res.statusCode).toBe(404);
    });

    test('PUT caps how many links one page may hold', async () => {
        const many = Array.from({ length: 61 }, (_, i) => `[Engineering]/Open/f${i}.md`);
        const res = await call(routes, PUT, makeReq({
            body: { spaceName: 'Engineering', path: 'Open/.home.md', items: many }
        }));
        expect(res.statusCode).toBe(400);
    });

    // ---- resolve -----------------------------------------------------------

    test('resolves folders with a child count and files with a size', async () => {
        const res = await call(routes, RESOLVE, makeReq({
            body: { spaceName: 'Engineering', refs: ['[Engineering]/Open', 'Open/Sub/page.md'] }
        }));
        expect(res.body.items[0]).toMatchObject({ kind: 'folder', title: 'Open' });
        expect(res.body.items[0].childCount).toBe(1); // Sub/ — .home.md is not an item
        expect(res.body.items[1]).toMatchObject({ kind: 'file', title: 'page' });
        expect(typeof res.body.items[1].size).toBe('number');
    });

    test('a folder-home reference is titled after its FOLDER, not ".home.md"', async () => {
        const res = await call(routes, RESOLVE, makeReq({
            body: { spaceName: 'Engineering', refs: ['Open/.home.md'] }
        }));
        expect(res.body.items[0].title).toBe('Open');
    });

    test('an unprefixed reference is resolved against the HOST space', async () => {
        const res = await call(routes, RESOLVE, makeReq({
            body: { spaceName: 'Engineering', refs: ['Curated/secret.md'] }
        }));
        expect(res.body.items[0]).toMatchObject({ kind: 'file', spaceName: 'Engineering' });
    });

    test('a ROOT-LEVEL file resolves in a curated space', async () => {
        // The file rule exempts root-level files; the folder rule does not.
        // Judging this one as a container hides every curated space's own
        // landing page, which reads exactly like a broken link.
        const res = await call(routes, RESOLVE, makeReq({
            body: { spaceName: 'Fintech', refs: ['[Fintech]/home.md'] }
        }));
        expect(kinds(res)).toEqual(['file']);
    });

    test('a path the naming space curates away is hidden, whoever asks', async () => {
        const res = await call(routes, RESOLVE, makeReq({
            body: { spaceName: 'Engineering', refs: ['[Fintech]/Curated/secret.md'] }
        }));
        expect(kinds(res)).toEqual(['hidden']);
        // …and it leaks nothing about what is there.
        expect(res.body.items[0].title).toBeUndefined();
        expect(res.body.items[0].modified).toBeUndefined();
    });

    test('inside a hidden subtree, missing is indistinguishable from hidden', async () => {
        const res = await call(routes, RESOLVE, makeReq({
            body: {
                spaceName: 'Engineering',
                refs: ['[Fintech]/Curated/secret.md', '[Fintech]/Curated/nothing-here.md']
            }
        }));
        expect(kinds(res)).toEqual(['hidden', 'hidden']);
    });

    test('a reference into a private space is hidden from a non-member', async () => {
        const refs = ['[Private]/Open/Sub/page.md'];
        const asMember = await call(routes, RESOLVE, makeReq({ body: { spaceName: 'Engineering', refs } }));
        expect(kinds(asMember)).toEqual(['file']);

        const asStranger = await call(routes, RESOLVE, makeReq({
            body: { spaceName: 'Engineering', refs }, email: 'stranger@example.com'
        }));
        expect(kinds(asStranger)).toEqual(['hidden']);
    });

    test('a reference naming a space that does not exist is hidden, not an error', async () => {
        const res = await call(routes, RESOLVE, makeReq({
            body: { spaceName: 'Engineering', refs: ['[No Such Space]/a/b'] }
        }));
        expect(res.statusCode).toBe(200);
        expect(kinds(res)).toEqual(['hidden']);
    });

    test('a reference that no longer exists is reported, not dropped', async () => {
        // A broken relationship is information; silently dropping the card
        // would hide it.
        const res = await call(routes, RESOLVE, makeReq({
            body: { spaceName: 'Engineering', refs: ['[Engineering]/Open/gone.md'] }
        }));
        expect(kinds(res)).toEqual(['missing']);
    });

    test('resolve refuses anything but an array of refs', async () => {
        const res = await call(routes, RESOLVE, makeReq({ body: { spaceName: 'Engineering', refs: 'x' } }));
        expect(res.statusCode).toBe(400);
    });
});
