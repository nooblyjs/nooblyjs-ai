'use strict';

/**
 * @fileoverview Access boundaries on a SHARED content root.
 *
 * Four spaces sit on `knowledge-content/engineering` and each shows a curated
 * slice of it (allowedPaths / excludedPaths). "Inside the content root" and
 * "this space may see it" are therefore different questions, and every seam that
 * only asked the first one leaked across the boundary:
 *
 *   - annotations and comments resolved a path with the traversal guard alone,
 *     then returned the WHOLE document in the response and wrote a modified copy
 *     back — a read leak and an unauthorised write in one call;
 *   - `PUT /documents/content` and `POST /documents` never opted in to the
 *     visibility flag, so a curated space could overwrite and create files
 *     anywhere in the shared root;
 *   - the template cascade walked ancestors, reaching straight through a
 *     pass-through container into a subtree the space hides.
 *
 * The common cause was that enforcement was OPT-IN. These tests pin the
 * inversion: `resolveSpacePath` enforces by default, and a caller has to ask for
 * the exemption. A regression here re-opens an access boundary silently, which
 * is exactly how it was lost the first time.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveSpacePath,
  isPathVisible,
  contentDirOf,
  handleSpacePathError,
  PATH_HIDDEN
} = require('../../../src/shared/spaces/spacePaths');

/** A temp content root shared by several spaces, as production has. */
let ROOT;
let APP_BASE;

/**
 * Retail sees three subtrees of the shared root; Engineering sees all of it.
 * Modelled on the real spaces.json arrangement.
 */
function makeSpaces(root) {
  return [
    { id: 1, name: 'Engineering', path: root },
    {
      id: 5,
      name: 'Retail',
      path: root,
      configuration: {
        allowedPaths: ['Solution Design/Distribution', 'Standards'],
        excludedPaths: ['Solution Design/Distribution/Secret']
      }
    }
  ];
}

beforeAll(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kr-shared-root-'));
  APP_BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'kr-appbase-'));
  fs.mkdirSync(path.join(APP_BASE, 'spaces'), { recursive: true });
  fs.writeFileSync(
    path.join(APP_BASE, 'spaces', 'spaces.json'),
    JSON.stringify(makeSpaces(ROOT), null, 2),
    'utf8'
  );
});

afterAll(() => {
  for (const dir of [ROOT, APP_BASE]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
});

const retail = () => makeSpaces(ROOT)[1];
const engineering = () => makeSpaces(ROOT)[0];

describe('resolveSpacePath enforces visibility BY DEFAULT', () => {
  test('an allowed path resolves', async () => {
    const r = await resolveSpacePath({
      spaceName: 'Retail',
      documentPath: 'Standards/coding.md',
      appBaseDir: APP_BASE
    });
    expect(r.relativePath.replace(/\\/g, '/')).toBe('Standards/coding.md');
    expect(r.space.id).toBe(5);
  });

  test('a path outside the curated slice throws PATH_HIDDEN with NO flag passed', async () => {
    // The whole point of the inversion: forgetting the option is now safe.
    await expect(resolveSpacePath({
      spaceName: 'Retail',
      documentPath: 'Business Processes/private.md',
      appBaseDir: APP_BASE
    })).rejects.toMatchObject({ code: PATH_HIDDEN });
  });

  test('an excluded carve-out inside an allowed subtree is hidden', async () => {
    await expect(resolveSpacePath({
      spaceName: 'Retail',
      documentPath: 'Solution Design/Distribution/Secret/plan.md',
      appBaseDir: APP_BASE
    })).rejects.toMatchObject({ code: PATH_HIDDEN });
  });

  test('the SAME path resolves for a space that is not restricted', async () => {
    // Proves the boundary is per-space, not a property of the path — which is
    // what makes a shared content root workable at all.
    const r = await resolveSpacePath({
      spaceName: 'Engineering',
      documentPath: 'Business Processes/private.md',
      appBaseDir: APP_BASE
    });
    expect(r.space.id).toBe(1);
  });

  test('enforceVisibility:false is the documented escape hatch', async () => {
    const r = await resolveSpacePath({
      spaceName: 'Retail',
      documentPath: 'Business Processes/private.md',
      appBaseDir: APP_BASE,
      enforceVisibility: false
    });
    expect(r.relativePath.replace(/\\/g, '/')).toBe('Business Processes/private.md');
  });

  test('traversal is still refused, and separately from visibility', async () => {
    await expect(resolveSpacePath({
      spaceName: 'Retail',
      documentPath: '../../../etc/passwd',
      appBaseDir: APP_BASE
    })).rejects.toThrow(/outside space directory/);
  });

  test('traversal is refused even with visibility disabled', async () => {
    // The two guards are independent — opting out of one must not drop the other.
    await expect(resolveSpacePath({
      spaceName: 'Retail',
      documentPath: '../../../etc/passwd',
      appBaseDir: APP_BASE,
      enforceVisibility: false
    })).rejects.toThrow(/outside space directory/);
  });

  test('an unknown space is a miss, not a crash', async () => {
    await expect(resolveSpacePath({
      spaceName: 'Nope',
      documentPath: 'x.md',
      appBaseDir: APP_BASE
    })).rejects.toThrow('Space not found');
  });
});

describe('the root-level and .system exemptions still hold', () => {
  test('the space landing page is reachable in a curated space', () => {
    // Hiding home.md behind allowedPaths would blank the home screen of every
    // filtered space.
    expect(isPathVisible(retail(), 'home.md')).toBe(true);
    expect(isPathVisible(retail(), '.home.md')).toBe(true);
  });

  test('space-root .system plumbing is reachable', () => {
    expect(isPathVisible(retail(), '.system/templates/meeting-notes.md')).toBe(true);
  });

  test('.system inside an ALLOWED folder is reachable', () => {
    expect(isPathVisible(retail(), 'Standards/.system/templates/x.md')).toBe(true);
  });

  test('.system inside a HIDDEN folder is NOT a back door', () => {
    // The template-cascade leak: plumbing inherits its folder's verdict, so a
    // hidden folder's templates stay hidden.
    expect(isPathVisible(retail(), 'Business Processes/.system/templates/x.md')).toBe(false);
    expect(isPathVisible(retail(), 'Business Processes/.system/originals/x.docx')).toBe(false);
  });

  test('a PASS-THROUGH container hides its own contents but stays listable', () => {
    // `Solution Design` exists in the nav only so you can drill into
    // `Distribution`. Its own files — and its own templates — must not show.
    expect(isPathVisible(retail(), 'Solution Design/notes.md')).toBe(false);
    expect(isPathVisible(retail(), 'Solution Design/.system/templates/x.md')).toBe(false);
    expect(isPathVisible(retail(), 'Solution Design', 'container')).toBe(true);
    expect(isPathVisible(retail(), 'Solution Design', 'folder')).toBe(false);
  });
});

describe('path kinds are judged differently, and that matters', () => {
  test('a folder is judged on itself; a file on its parent', () => {
    expect(isPathVisible(retail(), 'Standards', 'folder')).toBe(true);
    expect(isPathVisible(retail(), 'Standards/anything.md', 'file')).toBe(true);
    expect(isPathVisible(retail(), 'Business Processes', 'folder')).toBe(false);
  });

  test('an unrestricted space admits everything, whatever the kind', () => {
    for (const kind of ['file', 'folder', 'container']) {
      expect(isPathVisible(engineering(), 'Anything/at/all.md', kind)).toBe(true);
    }
  });
});

describe('hidden paths answer 404, never 403', () => {
  const mockRes = () => {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  };

  test('a hidden path is indistinguishable from a missing one', () => {
    // A 403 would confirm the document exists, which is what the curation hides.
    const res = mockRes();
    const handled = handleSpacePathError(res, Object.assign(new Error('Not found'), { code: PATH_HIDDEN }));
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/denied|forbidden|hidden/i);
  });

  test('traversal is a 403 — it is a malformed request, not a curated miss', () => {
    const res = mockRes();
    expect(handleSpacePathError(res, new Error('Access denied: path outside space directory'))).toBe(true);
    expect(res.statusCode).toBe(403);
  });

  test('an unrelated error is left for the caller', () => {
    const res = mockRes();
    expect(handleSpacePathError(res, new Error('disk on fire'))).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});

describe('contentDirOf', () => {
  test('spaces sharing a root resolve to the SAME directory', () => {
    // The premise of the whole suite — if this ever stops being true the
    // cross-space tests below are vacuous.
    expect(contentDirOf(engineering())).toBe(contentDirOf(retail()));
  });

  test('reads configuration.filing.baseDir when `path` is absent', () => {
    const space = { id: 9, name: 'Cfg', configuration: { filing: { baseDir: ROOT } } };
    expect(contentDirOf(space)).toBe(ROOT);
  });

  test('the legacy fallback folds the space name into the content dir', () => {
    // So the derived relative path is genuinely space-relative in BOTH branches;
    // the old inline copies produced `SpaceName/...`, which no rule would match.
    const dir = contentDirOf({ id: 3, name: 'Legacy' }, 'Legacy');
    expect(dir.replace(/\\/g, '/')).toMatch(/\/documents\/Legacy$/);
  });
});
