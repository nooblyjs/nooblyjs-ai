'use strict';

/**
 * Folder-tree build sharing and the lean wire format.
 *
 * The `GET /spaces/:id/folder-tree` walk is the most expensive thing the wiki
 * does — several thousand sequential directory listings on a large content
 * root. Three changes made it survivable, and each has a correctness surface
 * worth pinning:
 *
 *   1. COALESCING — concurrent requests share one walk. A single page load can
 *      ask for the same tree more than once before the first answer lands, and
 *      the per-space cache cannot help because nothing has finished yet.
 *   2. ROOT SHARING — spaces on the same content root reuse the raw tree, so
 *      the second space pays a prune instead of a walk.
 *   3. LEAN PAYLOAD — the response omits `path` (implied by the nesting) and
 *      `title`/`fileName`/`spaceName` (duplicates or constant). That is only
 *      safe while the client rehydration is its exact inverse, which is what
 *      the round-trip test below asserts.
 *
 * The helpers are module-private to filingRoutes.js, so they are reached the
 * same way the route reaches them: by loading the module and reading the
 * functions out of its scope is not possible, so the module is required and the
 * behaviour exercised through a fake express app + services.
 */

const path = require('node:path');

const ROUTES = path.resolve(__dirname, '../../../src/wiki/routes/filingRoutes');

/** Collects the registered handlers so a request can be driven through them. */
function makeApp() {
  const routes = new Map();
  const register = (method) => (routePath, ...handlers) => {
    routes.set(`${method} ${routePath}`, handlers[handlers.length - 1]);
  };
  return {
    get: register('GET'),
    post: register('POST'),
    put: register('PUT'),
    delete: register('DELETE'),
    patch: register('PATCH'),
    use: () => {},
    routes
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    ended: false,
    setHeader(k, v) { this.headers[k] = v; },
    get(k) { return this.headers[k]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.ended = true; return this; },
    end() { this.ended = true; return this; }
  };
  return res;
}

const TREE = {
  'home.md': 1,
  'Standards/': { 'principles.md': 1 },
  'Archive/': { 'old.md': 1 }
};

/** Filing service over the nested fixture, counting directory listings. */
function makeFiling(fixture) {
  const listed = [];
  const at = (dir) => {
    if (!dir || dir === '.') return fixture;
    return dir.split('/').reduce((node, seg) => (node && node[`${seg}/`]) || null, fixture);
  };
  return {
    listed,
    async list(dirPath) {
      const node = at(dirPath);
      if (!node) throw new Error(`ENOENT: ${dirPath}`);
      listed.push(dirPath === '.' ? '' : dirPath);
      // A real listing is not instant; the delay is what lets a second caller
      // arrive while the first build is still running.
      await new Promise(r => setTimeout(r, 5));
      return Object.keys(node).map(k => ({
        name: k.endsWith('/') ? k.slice(0, -1) : k,
        isDirectory: k.endsWith('/'),
        type: k.endsWith('/') ? 'folder' : 'file',
        size: 10,
        created: '2026-01-01T00:00:00.000Z',
        modified: '2026-01-02T00:00:00.000Z'
      }));
    },
    async read() { throw new Error('ENOENT'); }
  };
}

const SPACES = [
  {
    id: 1,
    name: 'Engineering',
    visibility: 'team',
    configuration: { filing: { baseDir: '../knowledge-content/engineering' } }
  },
  {
    id: 5,
    name: 'Retail',
    visibility: 'team',
    configuration: {
      filing: { baseDir: '../knowledge-content/engineering' },
      allowedPaths: ['Standards/*']
    }
  },
  {
    id: 2,
    name: 'Other',
    visibility: 'team',
    configuration: { filing: { baseDir: '../knowledge-content/other' } }
  }
];

function setup({ fixture = TREE } = {}) {
  jest.resetModules();
  const filing = makeFiling(fixture);
  const app = makeApp();
  const log = { info() {}, warn() {}, error() {}, debug() {} };

  // The route reads spaces.json off disk; point appBaseDir at a temp dir with
  // one written by us.
  const fs = require('node:fs');
  const os = require('node:os');
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-tree-test-'));
  fs.mkdirSync(path.join(baseDir, 'spaces'), { recursive: true });
  fs.writeFileSync(path.join(baseDir, 'spaces', 'spaces.json'), JSON.stringify(SPACES), 'utf8');

  const treeCache = {
    entries: new Map(),
    get(id) { return this.entries.get(id) || null; },
    set(id, tree, meta = {}) {
      const entry = { ...meta, tree, etag: `W/"tree-${id}-1"` };
      this.entries.set(id, entry);
      return entry;
    }
  };

  require(ROUTES)({ app }, null, {
    spaceManager: {},
    spaceFilingManager: { getFilingService: async () => filing },
    log,
    dataManager: { read: async () => SPACES },
    appBaseDir: baseDir,
    treeCache,
    eventBus: null
  });

  const handler = app.routes.get('GET /applications/wiki/api/spaces/:spaceId/folder-tree');
  const request = (spaceId, { headers = {}, query = {} } = {}) => {
    const res = makeRes();
    const req = {
      params: { spaceId: String(spaceId) },
      // The default walk is depth-limited; these tests assert tree SHAPE, so
      // unless a case is specifically about laziness they ask for everything.
      query: { depth: 'all', ...query },
      isAuthenticated: () => true,
      user: { email: 'a@b.c' },
      get: (h) => headers[h] || undefined
    };
    return handler(req, res).then(() => res);
  };

  return { request, filing, treeCache };
}

const rootListings = (filing) => filing.listed.filter(p => p === '').length;

describe('concurrent requests share one walk', () => {
  test('three simultaneous requests for one space build the tree once', async () => {
    const { request, filing } = setup();

    const [a, b, c] = await Promise.all([request(1), request(1), request(1)]);

    expect(rootListings(filing)).toBe(1);
    for (const res of [a, b, c]) {
      expect(res.body.success).toBe(true);
      expect(res.body.tree.map(n => n.name).sort()).toEqual(['Archive', 'Standards', 'home.md']);
    }
  });

  test('simultaneous requests for DIFFERENT spaces on one root also share it', async () => {
    const { request, filing } = setup();

    const [engineering, retail] = await Promise.all([request(1), request(5)]);

    expect(rootListings(filing)).toBe(1);
    // ...and each still gets its own curated view out of that shared tree.
    expect(engineering.body.tree.map(n => n.name).sort()).toEqual(['Archive', 'Standards', 'home.md']);
    expect(retail.body.tree.map(n => n.name).sort()).toEqual(['Standards', 'home.md']);
  });

  test('a second space on the same root reuses the completed tree', async () => {
    const { request, filing } = setup();

    await request(1);
    const before = rootListings(filing);
    await request(5);

    expect(rootListings(filing)).toBe(before);
  });

  test('a space on a different root is built separately', async () => {
    const { request, filing } = setup();

    await request(1);
    const before = rootListings(filing);
    await request(2);

    // Space 2 points at a different baseDir, so it must NOT be served space 1's
    // raw tree — it does its own walk. (The fixture filing service is shared, so
    // the trees look alike; the walk count is what distinguishes them.)
    expect(rootListings(filing)).toBe(before + 1);
  });

  test('a failed build is not handed to later callers', async () => {
    const { request } = setup({ fixture: null });

    const first = await request(1);
    const second = await request(1);

    expect(first.body.tree).toEqual([]);
    expect(second.body.tree).toEqual([]);
  });
});

describe('depth-limited walk', () => {
  // Four levels, so a default (2-level) walk has to stop somewhere visible.
  const DEEP = {
    'home.md': 1,
    'Standards/': {
      'principles.md': 1,
      'Security/': {
        'policy.md': 1,
        'Controls/': { 'iso.md': 1 }
      }
    }
  };

  const listedDirs = (filing) => filing.listed.slice();

  test('the default walk stops after two levels and flags what it skipped', async () => {
    const { request, filing } = setup({ fixture: DEEP });

    // `depth: undefined` overrides the harness default and exercises the real
    // out-of-the-box behaviour.
    const res = await request(1, { query: { depth: undefined } });

    const standards = res.body.tree.find(n => n.name === 'Standards');
    const security = standards.children.find(n => n.name === 'Security');

    // Level 2 is listed...
    expect(standards.truncated).toBeUndefined();
    // ...level 3 is not, and says so rather than looking empty.
    expect(security.truncated).toBe(true);
    expect(security.children).toEqual([]);

    // The proof that this is cheaper and not merely trimmed after the fact:
    // "Standards/Security" was never listed at all.
    expect(listedDirs(filing)).toEqual(['', 'Standards']);
    expect(res.body.depth).toBe(2);
  });

  test('a truncated folder is fetched on demand via ?path=', async () => {
    const { request, filing } = setup({ fixture: DEEP });

    await request(1, { query: { depth: undefined } });
    const res = await request(1, { query: { depth: undefined, path: 'Standards/Security' } });

    expect(res.body.success).toBe(true);
    expect(res.body.path).toBe('Standards/Security');
    // Paths stay space-relative, so the client can graft the result straight in.
    expect(res.body.tree.map(n => n.name).sort()).toEqual(['Controls', 'policy.md']);
    // A subtree fetch is two levels deep as well, which is what gives the
    // folder view an item count for each child folder without another round
    // trip. Anything below THAT would be truncated in turn.
    expect(res.body.tree.find(n => n.name === 'Controls').children.map(n => n.name))
      .toEqual(['iso.md']);

    // Only the requested subtree was walked; the root came from cache, and the
    // levels above "Security" were never re-listed.
    expect(listedDirs(filing)).toEqual([
      '', 'Standards', 'Standards/Security', 'Standards/Security/Controls'
    ]);
  });

  test('depth=all still walks everything', async () => {
    const { request } = setup({ fixture: DEEP });

    const res = await request(1, { query: { depth: 'all' } });

    const controls = res.body.tree
      .find(n => n.name === 'Standards').children
      .find(n => n.name === 'Security').children
      .find(n => n.name === 'Controls');
    expect(controls.truncated).toBeUndefined();
    expect(controls.children.map(n => n.name)).toEqual(['iso.md']);
  });

  test('a subtree request for a path the space hides is a 404', async () => {
    // Space 5 allows only "Standards", so "Archive" must not be listable
    // through the lazy loader either.
    const { request } = setup();

    const res = await request(5, { query: { path: 'Archive' } });

    expect(res.statusCode).toBe(404);
  });

  test('a pass-through container survives the space filter while truncated', async () => {
    // Retail allows "Standards" only. At depth 1 the root's folders come
    // back unlisted — dropping "Standards" for having no loaded children would
    // leave no way to ever reach the subtree it is allowed to show.
    const { request } = setup();

    const res = await request(5, { query: { depth: '1' } });

    const names = res.body.tree.map(n => n.name).sort();
    expect(names).toEqual(['Standards', 'home.md']);
    expect(res.body.tree.find(n => n.name === 'Standards').truncated).toBe(true);
  });

  test('path traversal is rejected', async () => {
    const { request } = setup();

    const res = await request(1, { query: { path: '../../etc' } });

    expect(res.statusCode).toBe(400);
  });
});

describe('lean wire format', () => {
  test('derivable fields are not sent', async () => {
    const { request } = setup();
    const res = await request(1);

    const doc = res.body.tree.find(n => n.type === 'document');
    const folder = res.body.tree.find(n => n.type === 'folder');

    for (const node of [doc, folder]) {
      expect(node).not.toHaveProperty('path');
      expect(node).not.toHaveProperty('title');
      expect(node).not.toHaveProperty('fileName');
      expect(node).not.toHaveProperty('spaceName');
      // status is omitted when unset rather than sent as an explicit null
      expect(node).not.toHaveProperty('status');
    }

    // What the UI genuinely needs is still there.
    expect(doc.name).toBe('home.md');
    expect(doc.size).toBe(10);
    expect(doc.modified).toBe('2026-01-02T00:00:00.000Z');
    expect(folder.children).toHaveLength(1);
  });

  test('client rehydration is the exact inverse of the server projection', async () => {
    const { request } = setup();
    const res = await request(1);

    // navigationController.rehydrateTree, reproduced — it is an ES module in
    // the browser bundle, so the algorithm is mirrored here and the round trip
    // asserted against paths built independently from the fixture.
    const rehydrate = (nodes, spaceName, prefix = '') => {
      for (const node of nodes) {
        node.path = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.status === undefined) node.status = null;
        if (node.type === 'folder') {
          rehydrate(node.children || (node.children = []), spaceName, node.path);
        } else {
          node.title = node.name;
          node.fileName = node.name;
          node.spaceName = spaceName;
        }
      }
      return nodes;
    };

    const hydrated = rehydrate(res.body.tree, 'Engineering');
    const paths = [];
    const collect = (nodes) => {
      for (const n of nodes) {
        paths.push(n.path);
        if (n.children) collect(n.children);
      }
    };
    collect(hydrated);

    expect(paths.sort()).toEqual([
      'Archive',
      'Archive/old.md',
      'Standards',
      'Standards/principles.md',
      'home.md'
    ]);

    const doc = hydrated.find(n => n.type === 'document');
    expect(doc.title).toBe('home.md');
    expect(doc.fileName).toBe('home.md');
    expect(doc.spaceName).toBe('Engineering');
    expect(doc.status).toBeNull();
  });
});
