'use strict';

/**
 * @fileoverview POST /applications/wiki/api/documents — refusing a curated path.
 *
 * Four production spaces sit on ONE content root (`knowledge-content/engineering`)
 * and each excludes the other three's landing pages, so the root of that root
 * holds `Engineering.md`, `Fintech.md`, `People.md` and `Retail.md` side by
 * side with only `excludedPaths` keeping each space out of the others'.
 *
 * That makes the CREATE endpoint the one place where the two halves of the
 * root-level rule meet, and they pull in opposite directions:
 *
 *   - a root-level file is EXEMPT from `allowedPaths` (`owner === ''`), which is
 *     what keeps every curated space's own `home.md` landing page reachable;
 *   - a root-level file is NOT exempt from `excludedPaths`, which is the only
 *     thing stopping Retail from seeing Engineering's landing page.
 *
 * Invert either and the failure is silent: exempt from exclusions and the spaces
 * leak into each other; subject to allowedPaths and every curated space's home
 * screen goes blank.
 *
 * The second thing pinned here is the RESPONSE. A create refused by curation used
 * to answer the same contentless "Document not found" as a read — telling the
 * user the document they were trying to MAKE did not exist — and
 * `handleHiddenPath` returned before the route's `logger.warn`, so nothing was
 * written to the log either. A live 404 was therefore indistinguishable from a
 * broken endpoint. The status stays 404 (a 403 would confirm the path is real),
 * but the body now names the path the caller just supplied and the space whose
 * config refused it, and the server records the attempt.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { compileVisibility } = require('../../../src/shared/spaces/spaceVisibility');

const CREATE = 'POST /applications/wiki/api/documents';

/** Minimal Express double: records handlers by "METHOD path". */
function makeApp() {
    const routes = new Map();
    const record = (method) => (routePath, ...handlers) => {
        routes.set(`${method} ${routePath}`, handlers[handlers.length - 1]);
    };
    return {
        get: record('GET'), post: record('POST'),
        put: record('PUT'), delete: record('DELETE'),
        routes
    };
}

function makeRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
}

function makeReq(body) {
    return {
        body,
        query: {},
        user: { email: 'srbooysen@example.com' },
        isAuthenticated: () => true
    };
}

/**
 * The real production arrangement: one content root, four spaces, each hiding
 * the other three's root-level landing page.
 */
function makeSpaces(root) {
    return [
        {
            id: 1, name: 'Engineering Space', path: root,
            configuration: {
                allowedPaths: [],
                excludedPaths: [
                    'Solution Design/Fintech Technologies/',
                    'Solution Design/People Technologies/',
                    'Fintech.md', 'People.md', 'Retail.md'
                ]
            }
        },
        {
            id: 5, name: 'Retail Space', path: root,
            configuration: {
                allowedPaths: [],
                excludedPaths: [
                    'Solution Design/Fintech Technologies',
                    'Solution Design/People Technologies',
                    'Engineering.md', 'Fintech.md', 'People.md'
                ]
            }
        },
        // A space that curates by allowedPaths instead, to pin the exemption.
        {
            id: 9, name: 'Curated Space', path: root,
            configuration: { allowedPaths: ['Standards'], excludedPaths: [] }
        }
    ];
}

let ROOT;
let APP_BASE;
let warnings;

beforeEach(() => {
    ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'create-curation-root-'));
    APP_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'create-curation-app-'));
    fs.mkdirSync(path.join(APP_BASE, 'spaces'), { recursive: true });
    fs.writeFileSync(
        path.join(APP_BASE, 'spaces', 'spaces.json'),
        JSON.stringify(makeSpaces(ROOT), null, 2)
    );
    warnings = [];
});

afterEach(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
    fs.rmSync(APP_BASE, { recursive: true, force: true });
});

/** Register documentRoutes against the express double and return the handler map. */
function mountRoutes() {
    const app = makeApp();
    const logger = {
        info() {}, error() {}, debug() {},
        warn(message) { warnings.push(String(message)); }
    };
    const spaces = JSON.parse(
        fs.readFileSync(path.join(APP_BASE, 'spaces', 'spaces.json'), 'utf8')
    );

    require('../../../src/wiki/routes/documentRoutes')(
        { app },
        { emit() {} },
        {
            dataManager: { read: async (type) => (type === 'spaces' ? spaces : []) },
            filing: {},
            cache: { delete: async () => {}, get: async () => null, put: async () => {} },
            log: logger,
            queue: {},
            search: {},
            searchIndexer: null,
            documentService: null,
            appBaseDir: APP_BASE
        }
    );
    return app.routes;
}

async function createFile({ spaceId, fileName, folderPath = '' }) {
    const routes = mountRoutes();
    const handler = routes.get(CREATE);
    const res = makeRes();
    await handler(makeReq({ spaceId, fileName, folderPath, content: '# Hi\n' }), res);
    return res;
}

// ---------------------------------------------------------------------------
// The visibility rule the whole behaviour rests on
// ---------------------------------------------------------------------------

describe('root-level files on a shared content root', () => {
    const spaces = () => makeSpaces('/tmp/root');
    const spaceNamed = (name) => spaces().find(s => s.name === name);

    it('exempts a root-level file from allowedPaths — the landing page rule', () => {
        const v = compileVisibility(spaceNamed('Curated Space'));
        expect(v.restricted).toBe(true);
        // Nothing at the root is under `Standards`, yet all of it stays visible.
        expect(v.isFileVisible('home.md')).toBe(true);
        expect(v.isFileVisible('.home.md')).toBe(true);
        expect(v.isFileVisible('Anything At All.md')).toBe(true);
        // A root-level FOLDER gets no such pass.
        expect(v.isFolderVisible('Marketing')).toBe(false);
        expect(v.isFolderVisible('Standards')).toBe(true);
    });

    it('does NOT exempt a root-level file from excludedPaths', () => {
        const v = compileVisibility(spaceNamed('Engineering Space'));
        expect(v.isFileVisible('Fintech.md')).toBe(false);
        expect(v.isFileVisible('People.md')).toBe(false);
        expect(v.isFileVisible('Retail.md')).toBe(false);
    });

    it('lets each space keep its OWN landing page while hiding the others', () => {
        const engineering = compileVisibility(spaceNamed('Engineering Space'));
        const retail = compileVisibility(spaceNamed('Retail Space'));

        expect(engineering.isFileVisible('Engineering.md')).toBe(true);
        expect(engineering.isFileVisible('Retail.md')).toBe(false);

        expect(retail.isFileVisible('Retail.md')).toBe(true);
        expect(retail.isFileVisible('Engineering.md')).toBe(false);
    });

    it('matches an exclusion case-insensitively and ignores a trailing slash', () => {
        const v = compileVisibility(spaceNamed('Engineering Space'));
        // Config says "Fintech.md"; the content lives on Windows.
        expect(v.isFileVisible('FINTECH.MD')).toBe(false);
        // Config says "Solution Design/Fintech Technologies/" with a trailing /.
        expect(v.isFileVisible('Solution Design/Fintech Technologies/Notes.md')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// What the create endpoint answers
// ---------------------------------------------------------------------------

describe('POST /documents — a path the space curates away', () => {
    it('creates an ordinary root-level file', async () => {
        const res = await createFile({ spaceId: 1, fileName: 'Meeting Notes.md' });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.path).toBe('Meeting Notes.md');
        expect(fs.existsSync(path.join(ROOT, 'Meeting Notes.md'))).toBe(true);
    });

    it("refuses another space's landing page at the root", async () => {
        const res = await createFile({ spaceId: 1, fileName: 'Fintech.md' });
        expect(res.statusCode).toBe(404);
        expect(res.body.success).toBe(false);
        expect(res.body.reason).toBe('PATH_NOT_PERMITTED');
        expect(fs.existsSync(path.join(ROOT, 'Fintech.md'))).toBe(false);
    });

    it('names the path and the space so the refusal is actionable', async () => {
        const res = await createFile({ spaceId: 1, fileName: 'Fintech.md' });
        expect(res.body.path).toBe('Fintech.md');
        expect(res.body.message).toContain('Fintech.md');
        expect(res.body.message).toContain('Engineering Space');
        // The old body said this, which cannot be true of a file being created.
        expect(res.body.message).not.toMatch(/Document not found/i);
    });

    it('keeps the status at 404 — a 403 would confirm the path is real', async () => {
        // The excluded file genuinely exists on the shared root...
        fs.writeFileSync(path.join(ROOT, 'Fintech.md'), '# Fintech\n');
        const hidden = await createFile({ spaceId: 1, fileName: 'Fintech.md' });
        // ...and one that does not exist is refused identically.
        const absent = await createFile({ spaceId: 1, fileName: 'People.md' });

        expect(hidden.statusCode).toBe(404);
        expect(absent.statusCode).toBe(404);
        expect(hidden.body.reason).toBe(absent.body.reason);
        // The existing file must NOT be reported as a 409 conflict — that would
        // confirm it is there, which is what the exclusion hides.
        expect(hidden.body.reason).toBe('PATH_NOT_PERMITTED');
        expect(fs.readFileSync(path.join(ROOT, 'Fintech.md'), 'utf8')).toBe('# Fintech\n');
    });

    it('records the refusal server-side — it used to leave no trace at all', async () => {
        await createFile({ spaceId: 1, fileName: 'Fintech.md' });
        const line = warnings.find(w => w.includes('[Create] Refused'));
        expect(line).toBeDefined();
        expect(line).toContain('Fintech.md');
        expect(line).toContain('Engineering Space');
        expect(line).toContain('srbooysen@example.com');
    });

    it('refuses a file inside an excluded subtree too', async () => {
        const res = await createFile({
            spaceId: 1,
            fileName: 'Plan.md',
            folderPath: 'Solution Design/Fintech Technologies'
        });
        expect(res.statusCode).toBe(404);
        expect(res.body.reason).toBe('PATH_NOT_PERMITTED');
        expect(res.body.path).toBe('Solution Design/Fintech Technologies/Plan.md');
    });

    it('lets the SAME name through in the space that owns it', async () => {
        const refused = await createFile({ spaceId: 1, fileName: 'Retail.md' });
        const allowed = await createFile({ spaceId: 5, fileName: 'Retail.md' });
        expect(refused.statusCode).toBe(404);
        expect(allowed.statusCode).toBe(200);
        expect(allowed.body.success).toBe(true);
    });

    it('still answers 404 "Space not found" for an unknown space id', async () => {
        const res = await createFile({ spaceId: 999, fileName: 'Notes.md' });
        expect(res.statusCode).toBe(404);
        expect(res.body.message).toMatch(/Space not found/);
        // Distinguishable from a curated refusal, which is the point.
        expect(res.body.reason).toBeUndefined();
    });
});
