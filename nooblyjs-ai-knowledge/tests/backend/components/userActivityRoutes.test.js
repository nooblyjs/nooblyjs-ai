/**
 * @fileoverview /api/user-activity — the backoffice usage screen's read side.
 *
 * The tally maths is covered by visitTally.test.js. What these tests pin is what
 * the HTTP layer adds, all of which is about SHARED CONTENT ROOTS and identity:
 *
 *  1. PER-USER ARTEFACTS ARE PER CONTENT ROOT, NOT PER SPACE. Four spaces are
 *     lenses over `knowledge-content/engineering` and share one activity folder.
 *     Iterating spaces instead of distinct roots would count every visit four
 *     times — the same class of bug that made search return nothing for three
 *     of those four spaces.
 *  2. THE LIST IS A UNION. A registered user who has never opened a document
 *     must appear at zero (otherwise "who is using this" answers with
 *     survivorship bias), and a folder with no account — a departed user, or
 *     `anonymous` — must not vanish.
 *  3. "WHICH SPACE WAS THIS READ IN" IS A VISIBILITY QUESTION. Nothing on the
 *     record says which space; a curated space hides part of the shared root, so
 *     the answer has to come from the real matcher.
 *  4. `:userKey` NAMES A DIRECTORY. It is joined onto a path, so its shape is
 *     validated on the way in — `userDir()` sanitises the WRITE path, and this
 *     is a different way in.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const visitTally = require('../../../src/wiki/components/visitTally');

const LIST = 'GET /api/user-activity';
const DETAIL = 'GET /api/user-activity/:userKey';

/** Minimal Express double: records handlers by "METHOD path". */
function makeApp() {
  const routes = new Map();
  return {
    get: (routePath, ...handlers) => routes.set(`GET ${routePath}`, handlers[handlers.length - 1]),
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

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };

async function call(routes, key, query = {}, params = {}) {
  const res = makeRes();
  await routes.get(key)({ query, params }, res);
  return res;
}

/* -------------------------------------------------------------------------- */

let workspace;
let appBaseDir;
let engineeringRoot;
let archiveRoot;

/**
 * A realistic install: FOUR spaces over ONE content root (one of them curated),
 * plus a second space on a root of its own so the per-root merge is exercised.
 */
const SPACES = () => ([
  { id: 1, name: 'Engineering Space', configuration: { filing: { baseDir: engineeringRoot } } },
  { id: 2, name: 'Financial Services Space', configuration: { filing: { baseDir: engineeringRoot } } },
  { id: 3, name: 'People Space', configuration: { filing: { baseDir: engineeringRoot } } },
  {
    id: 5,
    name: 'Retail Space',
    configuration: { filing: { baseDir: engineeringRoot }, allowedPaths: ['Commerce/'] }
  },
  { id: 9, name: 'Archive Space', configuration: { filing: { baseDir: archiveRoot } } }
]);

const USERS = [
  { email: 'ana@example.com', fullName: 'Ana Reader', roles: ['admin'], lastLogin: '2026-09-01T08:00:00.000Z', isActive: true },
  { email: 'newjoiner@example.com', fullName: 'New Joiner', roles: ['user'], isActive: true }
];

function writeActivity(root, identity, activity) {
  const dir = path.join(root, '.system', 'useractivity', identity);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'activity.json'), JSON.stringify(activity), 'utf8');
}

function writeTally(root, identity, days) {
  const dir = path.join(root, '.system', 'useractivity', identity);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'visits.json'),
    JSON.stringify({ version: 1, startedAt: '2026-08-01T00:00:00.000Z', days }),
    'utf8'
  );
}

/** Today, in the same local-day terms the tally uses. */
const TODAY = visitTally.dayKey(new Date());
const YESTERDAY = visitTally.dayKey(visitTally.shiftDays(new Date(), 1));

function register({ authservice } = {}) {
  const app = makeApp();
  require('../../../src/datasources/routes/userActivityRoutes')(
    'test',
    {
      'express-app': app,
      dependencies: {
        log: noopLog,
        appBaseDir,
        authservice: authservice === undefined
          ? { listUsers: async () => USERS }
          : authservice
      }
    },
    null
  );
  return app.routes;
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'user-activity-'));
  appBaseDir = path.join(workspace, '.application');
  engineeringRoot = path.join(workspace, 'content', 'engineering');
  archiveRoot = path.join(workspace, 'content', 'archive');
  fs.mkdirSync(path.join(appBaseDir, 'spaces'), { recursive: true });
  fs.mkdirSync(engineeringRoot, { recursive: true });
  fs.mkdirSync(archiveRoot, { recursive: true });
  fs.writeFileSync(path.join(appBaseDir, 'spaces', 'spaces.json'), JSON.stringify(SPACES()), 'utf8');

  // Ana reads across both roots. Note `Commerce/…` is the only path Retail
  // exposes, and `Finance/…` is outside it.
  writeActivity(engineeringRoot, 'ana', {
    userId: 'u-ana',
    starred: [{ path: 'Commerce/Pricing.md', title: 'Pricing', starredAt: `${YESTERDAY}T09:00:00.000Z` }],
    recent: [
      { path: 'Commerce/Pricing.md', title: 'Pricing', action: 'viewed', visitedAt: `${TODAY}T09:00:00.000Z` },
      { path: 'Finance/Ledger.md', title: 'Ledger', action: 'edited', visitedAt: `${YESTERDAY}T09:00:00.000Z` }
    ]
  });
  writeTally(engineeringRoot, 'ana', { [TODAY]: { viewed: 11, edited: 0 } });
  writeActivity(archiveRoot, 'ana', {
    recent: [{ path: 'Old/Notes.md', title: 'Notes', action: 'viewed', visitedAt: `${TODAY}T10:00:00.000Z` }]
  });
  writeTally(archiveRoot, 'ana', { [TODAY]: { viewed: 4, edited: 0 } });

  // A folder with no matching account — a departed user whose history is real.
  writeActivity(engineeringRoot, 'departed', {
    recent: [{ path: 'Commerce/Old.md', title: 'Old', action: 'viewed', visitedAt: `${YESTERDAY}T11:00:00.000Z` }]
  });
});

afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */

describe('GET /api/user-activity', () => {
  test('lists registered users AND folders with no account', async () => {
    const res = await call(register(), LIST);
    const keys = res.body.data.users.map((u) => u.userKey).sort();

    expect(keys).toEqual(['ana', 'departed', 'newjoiner']);

    const departed = res.body.data.users.find((u) => u.userKey === 'departed');
    expect(departed.registered).toBe(false);
    expect(departed.email).toBeNull();
  });

  test('a registered user with no activity appears at zero, not omitted', async () => {
    const res = await call(register(), LIST);
    const joiner = res.body.data.users.find((u) => u.userKey === 'newjoiner');

    expect(joiner.registered).toBe(true);
    expect(joiner.window.total).toBe(0);
    expect(joiner.lastVisitAt).toBeNull();
    expect(joiner.documents).toBe(0);
  });

  test('groups the four spaces on one directory into ONE content root', async () => {
    const res = await call(register(), LIST);
    // Five spaces, two directories.
    expect(res.body.data.roots).toHaveLength(2);

    const engineering = res.body.data.roots.find((r) => r.spaces.length === 4);
    expect(engineering.spaces.map((s) => s.name)).toEqual([
      'Engineering Space', 'Financial Services Space', 'People Space', 'Retail Space'
    ]);
  });

  test('sums a user across roots ONCE, not once per space', async () => {
    const res = await call(register(), LIST);
    const ana = res.body.data.users.find((u) => u.userKey === 'ana');

    // Today: 11 views on engineering + 4 on archive. Iterating the five SPACES
    // instead of the two distinct roots would give 11×4 + 4 = 48.
    expect(ana.window.viewed).toBe(15);
    expect(ana.window.edited).toBe(1);        // yesterday, known only from `recent`
    expect(ana.window.total).toBe(16);
    expect(ana.documents).toBe(3);
    expect(ana.roots).toHaveLength(2);
  });

  test('sorts the most recently active first and never-active last', async () => {
    const res = await call(register(), LIST);
    expect(res.body.data.users.map((u) => u.userKey)).toEqual(['ana', 'departed', 'newjoiner']);
  });

  test('degrades to folders-only when the user directory cannot be read', async () => {
    const routes = register({ authservice: { listUsers: async () => { throw new Error('LDAP down'); } } });
    const res = await call(routes, LIST);

    // A usage screen listing only the people with activity beats one that 500s.
    expect(res.statusCode).toBe(200);
    expect(res.body.data.users.map((u) => u.userKey).sort()).toEqual(['ana', 'departed']);
  });

  test('clamps the window to something the tally can answer', async () => {
    expect((await call(register(), LIST, { days: '999999' })).body.data.days)
      .toBe(visitTally.RETENTION_DAYS);
    expect((await call(register(), LIST, { days: '-4' })).body.data.days).toBe(1);
    expect((await call(register(), LIST, { days: 'lots' })).body.data.days).toBe(30);
  });
});

describe('GET /api/user-activity/:userKey', () => {
  test('returns the visits from every root, newest first', async () => {
    const res = await call(register(), DETAIL, {}, { userKey: 'ana' });
    expect(res.body.data.visits.map((v) => v.path)).toEqual([
      'Old/Notes.md',            // today 10:00
      'Commerce/Pricing.md',     // today 09:00
      'Finance/Ledger.md'        // yesterday
    ]);
  });

  test('names the spaces that actually EXPOSE each path, not every space on the root', async () => {
    const res = await call(register(), DETAIL, {}, { userKey: 'ana' });
    const byPath = Object.fromEntries(res.body.data.visits.map((v) => [v.path, v.spaces]));

    // Retail only allows `Commerce/`, so it sees the first and not the second.
    expect(byPath['Commerce/Pricing.md']).toContain('Retail Space');
    expect(byPath['Finance/Ledger.md']).not.toContain('Retail Space');
    expect(byPath['Finance/Ledger.md']).toContain('Engineering Space');
  });

  test('merges the daily series across roots', async () => {
    const res = await call(register(), DETAIL, { days: '7' }, { userKey: 'ana' });
    const today = res.body.data.series.find((p) => p.date === TODAY);

    expect(today.viewed).toBe(15);          // 11 + 4
    expect(res.body.data.series).toHaveLength(7);
    expect(res.body.data.window.total).toBe(16);   // + yesterday's edit, from `recent`
  });

  test('falls back to `recent` for days the tally predates', async () => {
    // Yesterday has no tally bucket at all; the edit is only knowable from
    // `recent`, and dropping it would report a day of work as a quiet day.
    const res = await call(register(), DETAIL, { days: '7' }, { userKey: 'ana' });
    const yesterday = res.body.data.series.find((p) => p.date === YESTERDAY);
    expect(yesterday).toEqual({ date: YESTERDAY, viewed: 0, edited: 1, total: 1 });
  });

  test('reports when exact counting started, so the screen can caveat the rest', async () => {
    expect((await call(register(), DETAIL, {}, { userKey: 'ana' })).body.data.tallyStartedAt)
      .toBe('2026-08-01T00:00:00.000Z');
    expect((await call(register(), DETAIL, {}, { userKey: 'departed' })).body.data.tallyStartedAt)
      .toBeNull();
  });

  test('returns starred documents', async () => {
    const res = await call(register(), DETAIL, {}, { userKey: 'ana' });
    expect(res.body.data.starred.map((s) => s.path)).toEqual(['Commerce/Pricing.md']);
  });

  test('an unknown user is an empty record, not a 404 or a crash', async () => {
    const res = await call(register(), DETAIL, {}, { userKey: 'nobody' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.visits).toEqual([]);
    expect(res.body.data.window.total).toBe(0);
  });

  test('rejects a user key that is not a folder name', async () => {
    // The key is joined onto a path, so its shape is checked before it is used.
    for (const userKey of ['../etc', 'a/b', 'a\\b', '..', 'has space', '']) {
      const res = await call(register(), DETAIL, {}, { userKey });
      expect(res.statusCode).toBe(400);
    }
  });
});
