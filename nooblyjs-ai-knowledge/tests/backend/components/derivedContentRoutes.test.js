/**
 * @fileoverview GET/PUT /applications/wiki/api/documents/derived (+ /regenerate)
 *
 * The editable view of a PDF's extracted text. Three things matter here and are
 * easy to get wrong:
 *
 *  1. The routes take the ORIGINAL document's path and derive the sidecar
 *     themselves, so no caller has to know the `.system/derived/<name>.<ext>.md`
 *     rule — that stays owned by filePolicy.
 *  2. A save MUST re-index the ORIGINAL. `.system` is in the file watcher's
 *     ignore list (it has to be — the watcher writes sidecars itself), so writing
 *     this file raises no event and nothing else would ever notice. Skip it and
 *     the correction sits on disk while search keeps answering from old text.
 *  3. A save makes the sidecar newer than its source, so the indexer's staleness
 *     check treats it as current and a later rebuild will not clobber the edit.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { sidecarStatus, SidecarStatus } = require('../../../src/wiki/utils/derivedSidecar');

const GET_ROUTE = 'GET /applications/wiki/api/documents/derived';
const PUT_ROUTE = 'PUT /applications/wiki/api/documents/derived';
const REGEN_ROUTE = 'POST /applications/wiki/api/documents/derived/regenerate';

jest.mock('../../../src/shared/processors/documentConverter', () => {
  const nodePath = require('node:path');
  const SUPPORTED_EXTENSIONS = new Set(['.docx', '.doc', '.pdf', '.xlsx', '.xls']);
  return {
    SUPPORTED_EXTENSIONS,
    canConvert: (filePath) => SUPPORTED_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase()),
    convertToMarkdown: jest.fn(async () => '# Freshly extracted\n\nmachine text\n')
  };
});

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
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    send(payload) { this.body = payload; return this; }
  };
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

describe('derived content routes', () => {
  let appBaseDir;
  let spaceRoot;
  let routes;
  let indexed;
  let cacheDeletes;

  beforeEach(() => {
    appBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'derived-routes-'));
    spaceRoot = path.join(appBaseDir, 'content');
    fs.mkdirSync(path.join(appBaseDir, 'spaces'), { recursive: true });
    fs.mkdirSync(path.join(spaceRoot, 'Standards'), { recursive: true });
    fs.writeFileSync(
      path.join(appBaseDir, 'spaces', 'spaces.json'),
      JSON.stringify([{ id: 1, name: 'Engineering', visibility: 'public', path: spaceRoot }]),
      'utf8'
    );
    fs.writeFileSync(path.join(spaceRoot, 'Standards', 'Annexure.pdf'), 'PDF-BYTES');

    indexed = [];
    cacheDeletes = [];

    const app = makeApp();
    require('../../../src/wiki/routes/documentRoutes')({ app }, null, {
      dataManager: { read: async () => [] },
      cache: { delete: async (key) => { cacheDeletes.push(key); } },
      log: noopLog,
      searchIndexer: {
        updateFileInSpace: async (spaceName, relativePath) => { indexed.push(`${spaceName}/${relativePath}`); }
      },
      documentService: {},
      appBaseDir
    });
    routes = app.routes;
  });

  afterEach(() => {
    fs.rmSync(appBaseDir, { recursive: true, force: true });
  });

  const authedReq = (over = {}) => ({ isAuthenticated: () => true, user: { email: 'a@b.c' }, query: {}, body: {}, ...over });

  async function call(route, req) {
    const handler = routes.get(route);
    expect(typeof handler).toBe('function');
    const res = makeRes();
    await handler(req, res);
    return res;
  }

  const sidecarAbs = () =>
    path.join(spaceRoot, 'Standards', '.system', 'derived', 'Annexure.pdf.md');

  describe('GET', () => {
    test('returns the sidecar addressed by the ORIGINAL document path', async () => {
      fs.mkdirSync(path.dirname(sidecarAbs()), { recursive: true });
      fs.writeFileSync(sidecarAbs(), '# Extracted\n\nsome text');

      const res = await call(GET_ROUTE, authedReq({
        query: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering' }
      }));

      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        exists: true,
        content: '# Extracted\n\nsome text',
        derivedPath: 'Standards/.system/derived/Annexure.pdf.md'
      });
    });

    test('a missing sidecar is a normal answer, not an error', async () => {
      const res = await call(GET_ROUTE, authedReq({
        query: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering' }
      }));

      expect(res.statusCode).toBe(200);
      expect(res.body.exists).toBe(false);
      expect(res.body.content).toBe('');
    });

    test('never cached — the view exists to show what is on disk right now', async () => {
      const res = await call(GET_ROUTE, authedReq({
        query: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering' }
      }));
      expect(res.headers['cache-control']).toBe('no-store');
    });

    test('flags a sidecar that predates its PDF', async () => {
      fs.mkdirSync(path.dirname(sidecarAbs()), { recursive: true });
      fs.writeFileSync(sidecarAbs(), 'old extraction');
      const past = new Date(Date.now() - 600000);
      fs.utimesSync(sidecarAbs(), past, past);

      const res = await call(GET_ROUTE, authedReq({
        query: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering' }
      }));

      expect(res.body.stale).toBe(true);
    });

    test('a markdown page has no derived content — that is a caller bug, not an empty result', async () => {
      fs.writeFileSync(path.join(spaceRoot, 'Standards', 'Notes.md'), '# hi');

      const res = await call(GET_ROUTE, authedReq({
        query: { path: 'Standards/Notes.md', spaceName: 'Engineering' }
      }));

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/no derived markdown/i);
    });

    test('refuses to escape the space root', async () => {
      const res = await call(GET_ROUTE, authedReq({
        query: { path: '../../../etc/passwd.pdf', spaceName: 'Engineering' }
      }));
      expect(res.statusCode).toBe(403);
    });
  });

  describe('PUT', () => {
    test('writes the correction to the sidecar, leaving the PDF untouched', async () => {
      const res = await call(PUT_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering', content: '# Corrected by hand' }
      }));

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(fs.readFileSync(sidecarAbs(), 'utf8')).toBe('# Corrected by hand');
      expect(fs.readFileSync(path.join(spaceRoot, 'Standards', 'Annexure.pdf'), 'utf8')).toBe('PDF-BYTES');
    });

    test('re-indexes the ORIGINAL — nothing else would, since the watcher ignores .system', async () => {
      await call(PUT_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering', content: 'corrected text' }
      }));

      // The PDF's path, not the sidecar's: the sidecar is never a document.
      expect(indexed).toEqual(['Engineering/Standards/Annexure.pdf']);
    });

    test('drops the cached search pages so the next query sees the correction', async () => {
      await call(PUT_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering', content: 'corrected' }
      }));

      expect(cacheDeletes).toEqual(expect.arrayContaining(['wiki:search:*', 'wiki:suggestions:*']));
    });

    test('a saved correction reads as CURRENT, so a rebuild will not overwrite it', async () => {
      await call(PUT_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering', content: 'hand-corrected' }
      }));

      await expect(sidecarStatus(spaceRoot, 'Standards/Annexure.pdf'))
        .resolves.toBe(SidecarStatus.CURRENT);
    });

    test('creates the sidecar when none existed', async () => {
      expect(fs.existsSync(sidecarAbs())).toBe(false);

      await call(PUT_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering', content: 'typed from scratch' }
      }));

      expect(fs.readFileSync(sidecarAbs(), 'utf8')).toBe('typed from scratch');
    });

    test('requires authentication', async () => {
      const res = await call(PUT_ROUTE, {
        isAuthenticated: () => false,
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering', content: 'x' }
      });
      expect(res.statusCode).toBe(401);
    });

    test('an empty string is a legitimate save, not a missing field', async () => {
      const res = await call(PUT_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering', content: '' }
      }));
      expect(res.statusCode).toBe(200);
      expect(fs.readFileSync(sidecarAbs(), 'utf8')).toBe('');
    });

    test('rejects a request with no content field at all', async () => {
      const res = await call(PUT_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering' }
      }));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /regenerate', () => {
    test('replaces a hand-edited sidecar with a fresh extraction', async () => {
      await call(PUT_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering', content: 'wrong on purpose' }
      }));
      indexed = [];

      const res = await call(REGEN_ROUTE, authedReq({
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering' }
      }));

      expect(res.statusCode).toBe(200);
      expect(res.body.content).toContain('Freshly extracted');
      expect(fs.readFileSync(sidecarAbs(), 'utf8')).toContain('Freshly extracted');
      // …and the new text reaches search the same way a manual save does.
      expect(indexed).toEqual(['Engineering/Standards/Annexure.pdf']);
    });

    test('requires authentication', async () => {
      const res = await call(REGEN_ROUTE, {
        isAuthenticated: () => false,
        body: { path: 'Standards/Annexure.pdf', spaceName: 'Engineering' }
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
