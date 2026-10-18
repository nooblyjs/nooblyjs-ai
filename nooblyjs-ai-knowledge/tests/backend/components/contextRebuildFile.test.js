/**
 * @fileoverview POST /applications/wiki/api/spaces/:spaceId/context/rebuild-file
 *
 * The single-document context rebuild behind the AI Context Manager's per-file
 * Regenerate button. What matters here is the translation from what the UI holds
 * — a `.system/context/` sidecar path — back to the document the workflow must
 * re-summarise, and the shape of the input handed to the build step:
 *
 *   - `files: [<document>]` is what selects the step's TARGETED mode. Drop it and
 *     the same workflow walks the whole subtree instead (many AI calls, minutes).
 *   - `appBaseDir` must be absolute and `aiTimeoutMs` explicit: the workflow's
 *     defaultInput is used only when the input is entirely empty, never merged.
 *
 * The sidecar name is ambiguous by construction (`x.md` describes `x.md`,
 * `x.pdf.md` describes `x.pdf`), so resolution is settled against the folder's
 * real contents — covered below, including the dotted markdown name that the
 * name rule alone gets wrong.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROUTE = '/applications/wiki/api/spaces/:spaceId/context/rebuild-file';

/** Minimal Express double: records handlers by "METHOD path". */
function makeApp() {
  const routes = new Map();
  const record = (method) => (routePath, ...handlers) => {
    routes.set(`${method} ${routePath}`, handlers[handlers.length - 1]);
  };
  return { get: record('GET'), post: record('POST'), put: record('PUT'), delete: record('DELETE'), routes };
}

/** Response double capturing the status/body the handler settles on. */
function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return res;
}

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

describe('context rebuild-file route', () => {
  let baseDir;
  let handler;
  let started;
  let folderEntries;

  beforeAll(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-rebuild-'));
    fs.mkdirSync(path.join(baseDir, 'spaces'), { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, 'spaces', 'spaces.json'),
      JSON.stringify([{ id: 1, name: 'Engineering', visibility: 'public' }]),
      'utf8'
    );
  });

  afterAll(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Default folder contents; individual tests override before calling.
    folderEntries = [
      { name: 'Notes.md' },
      { name: 'Deck.pdf' },
      { name: 'notes.v2.md' }
    ];
    started = [];

    const app = makeApp();
    const registerRoutes = require('../../../src/wiki/routes/filingRoutes');
    registerRoutes({ app }, null, {
      spaceManager: {},
      spaceFilingManager: {
        getFilingService: async () => ({ list: async () => folderEntries })
      },
      log: noopLog,
      dataManager: {},
      appBaseDir: baseDir,
      treeCache: { invalidateAll() {} }
    });

    handler = app.routes.get(`POST ${ROUTE}`);
    expect(typeof handler).toBe('function');
  });

  /** Drive the handler with a body, returning the captured response. */
  async function post(body) {
    const workflowBridge = {
      initialized: true,
      resolveWorkflowByName: (name) => ({ id: 'wf-1', name }),
      startWorkflowByName: async (name, input) => {
        started.push({ name, input });
        return { executionId: 'exec-1' };
      }
    };
    const req = {
      isAuthenticated: () => true,
      user: { email: 'someone@example.com' },
      params: { spaceId: '1' },
      body,
      app: { get: (key) => (key === 'workflowBridge' ? workflowBridge : null) }
    };
    const res = makeRes();
    await handler(req, res);
    return res;
  }

  test('a markdown sidecar resolves to the markdown document', async () => {
    const res = await post({ contextPath: 'Standards/.system/context/Notes.md' });

    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({
      success: true,
      executionId: 'exec-1',
      filePath: 'Standards/Notes.md',
      contextPath: 'Standards/.system/context/Notes.md',
      folder: 'Standards'
    });
    expect(started).toHaveLength(1);
    expect(started[0].name).toBe('Context: Overwrite Context (On-Demand)');
  });

  test('targeted mode: exactly the one document, forced, with an absolute base dir', async () => {
    await post({ contextPath: 'Standards/.system/context/Notes.md' });

    const { input } = started[0];
    expect(input.files).toEqual(['Standards/Notes.md']);
    expect(input.force).toBe(true);
    expect(input.space).toBe('Engineering');
    expect(path.isAbsolute(input.appBaseDir)).toBe(true);
    // Without an explicit ceiling the step waits forever on a stalled model.
    expect(input.aiTimeoutMs).toBeGreaterThan(0);
  });

  test('a binary sidecar keeps the source extension (x.pdf.md -> x.pdf)', async () => {
    const res = await post({ contextPath: 'Standards/.system/context/Deck.pdf.md' });

    expect(res.statusCode).toBe(202);
    expect(started[0].input.files).toEqual(['Standards/Deck.pdf']);
  });

  test('a dotted markdown name is settled against the folder, not the name rule', async () => {
    // `notes.v2.md` -> stripping `.md` leaves `notes.v2`, which still has an
    // "extension", so the name rule alone would look for a file that is not there.
    const res = await post({ contextPath: 'Standards/.system/context/notes.v2.md' });

    expect(res.statusCode).toBe(202);
    expect(started[0].input.files).toEqual(['Standards/notes.v2.md']);
  });

  test('a space-root sidecar resolves to a root document', async () => {
    folderEntries = [{ name: 'home.md' }];
    const res = await post({ contextPath: '.system/context/home.md' });

    expect(res.statusCode).toBe(202);
    expect(res.body.folder).toBe('');
    expect(started[0].input.files).toEqual(['home.md']);
  });

  test('the folder roll-up is refused — it describes no single document', async () => {
    const res = await post({ contextPath: 'Standards/.system/context/_folder.md' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/folder/i);
    expect(started).toHaveLength(0);
  });

  test('a missing source is a 404, not a background run that logs "no such file"', async () => {
    folderEntries = [{ name: 'Something Else.md' }];
    const res = await post({ contextPath: 'Standards/.system/context/Notes.md' });

    expect(res.statusCode).toBe(404);
    expect(started).toHaveLength(0);
  });

  test('a hidden path is refused outright', async () => {
    const res = await post({ filePath: 'Standards/.aicontext/Notes-summary.md' });

    expect(res.statusCode).toBe(400);
    expect(started).toHaveLength(0);
  });

  test('an unauthenticated caller gets 401', async () => {
    const req = {
      isAuthenticated: () => false,
      params: { spaceId: '1' },
      body: { contextPath: 'Standards/.system/context/Notes.md' },
      app: { get: () => null }
    };
    const res = makeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(started).toHaveLength(0);
  });
});
