'use strict';

/**
 * Per-user artefact scoping — pins, recent, starred.
 *
 * Several spaces are VIEWS of one content root (Engineering, Financial Services,
 * People and Retail all sit on `knowledge-content/engineering`, differing only
 * by `excludedPaths`), and `spaceUserStore` resolves a space to that root — so
 * they already share one `pins.json` / `activity.json`.
 *
 * Records used to carry a `spaceName` string that the UI filtered on. That
 * failed in production: renaming a space silently orphaned every record it had
 * ever written, and four real pins plus eight recent entries became invisible
 * because they were stamped with a space name that no longer existed.
 *
 * The stamp is gone. Identity is the PATH, and scoping is the real visibility
 * matcher — the same code the folder tree, search and the filing routes use.
 * These tests pin the three properties that buys: legacy records heal on read,
 * duplicates collapse, and exclusions are genuinely enforced.
 */

const userArtifacts = require('../../../src/wiki/components/userArtifacts');

/** The real shape, including the dead space name that caused the incident. */
const LEGACY_PINS = [
  {
    type: 'folder',
    spaceName: 'Engineering Collaboration Space',
    path: 'Solution Design/Distribution',
    title: 'Distribution',
    pinnedAt: '2026-06-01T10:00:00.000Z'
  },
  {
    type: 'folder',
    spaceName: 'Engineering Collaboration Space',
    path: 'Solution Design/Fintech Technologies/Payments',
    title: 'Payments',
    pinnedAt: '2026-06-02T10:00:00.000Z'
  }
];

/** Two views of one root, as configured. */
const ENGINEERING = {
  id: 1,
  name: 'Engineering Space',
  configuration: {
    filing: { baseDir: '../knowledge-content/engineering' },
    excludedPaths: ['Solution Design/Fintech Technologies/', 'Fintech.md']
  }
};
const FINTECH = {
  id: 2,
  name: 'Financial Services Space',
  configuration: {
    filing: { baseDir: '../knowledge-content/engineering' },
    excludedPaths: ['Solution Design/People Technologies/', 'Engineering.md']
  }
};
const UNRESTRICTED = { id: 9, name: 'All', configuration: {} };

describe('normalise — legacy records heal on read', () => {
  test('the space stamp is dropped', () => {
    const out = userArtifacts.normalise(LEGACY_PINS);

    expect(out).toHaveLength(2);
    for (const record of out) {
      expect(record).not.toHaveProperty('spaceName');
    }
    // ...and everything else survives.
    expect(out[0]).toMatchObject({
      type: 'folder',
      path: 'Solution Design/Distribution',
      title: 'Distribution',
      pinnedAt: '2026-06-01T10:00:00.000Z'
    });
  });

  test('the duplicates the stamp created collapse to one', () => {
    // The same document pinned from two views was two records, because the
    // dedupe key included the space name.
    const out = userArtifacts.normalise([
      { type: 'document', spaceName: 'Engineering Space', path: 'a/b.md', title: 'B', pinnedAt: '2026-06-01T00:00:00.000Z' },
      { type: 'document', spaceName: 'Retail Space', path: 'a/b.md', title: 'B', pinnedAt: '2026-07-01T00:00:00.000Z' }
    ]);

    expect(out).toHaveLength(1);
    // The NEWER wins, or re-pinning from a second view would revert the date.
    expect(out[0].pinnedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  test('a folder and a document at the same path stay distinct', () => {
    const out = userArtifacts.normalise([
      { type: 'folder', path: 'Standards' },
      { type: 'document', path: 'Standards' }
    ]);
    expect(out).toHaveLength(2);
  });

  test('recent/starred entries (no `type`) are treated as documents', () => {
    const out = userArtifacts.normalise([
      { path: 'a/b.md', spaceName: 'X', visitedAt: '2026-06-01T00:00:00.000Z' },
      { path: 'a/b.md', spaceName: 'Y', visitedAt: '2026-06-05T00:00:00.000Z' }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].visitedAt).toBe('2026-06-05T00:00:00.000Z');
  });

  test('backslash paths normalise, so Windows writes match POSIX ones', () => {
    const out = userArtifacts.normalise([
      { type: 'folder', path: 'Solution Design\\Distribution', pinnedAt: '2026-06-01T00:00:00.000Z' },
      { type: 'folder', path: 'Solution Design/Distribution', pinnedAt: '2026-06-02T00:00:00.000Z' }
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('Solution Design/Distribution');
  });

  test('junk is discarded rather than thrown on', () => {
    expect(userArtifacts.normalise(null)).toEqual([]);
    expect(userArtifacts.normalise('nope')).toEqual([]);
    expect(userArtifacts.normalise([null, undefined, 42, {}, { title: 'no path' }])).toEqual([]);
  });

  test('the input is not mutated — the caller may still hold it', () => {
    const input = JSON.parse(JSON.stringify(LEGACY_PINS));
    userArtifacts.normalise(input);
    expect(input[0].spaceName).toBe('Engineering Collaboration Space');
  });
});

describe('filterVisible — exclusions are actually enforced', () => {
  const pins = userArtifacts.normalise(LEGACY_PINS);

  test('a pin follows the user into every view that exposes it', () => {
    // The whole point: one pin, visible from both views, no duplication.
    for (const space of [ENGINEERING, FINTECH]) {
      const visible = userArtifacts.filterVisible(space, pins);
      expect(visible.map(p => p.path)).toContain('Solution Design/Distribution');
    }
  });

  test("a view that excludes the target does not show its pin", () => {
    // Engineering excludes Fintech Technologies; the Fintech view does not.
    expect(userArtifacts.filterVisible(ENGINEERING, pins).map(p => p.path))
      .not.toContain('Solution Design/Fintech Technologies/Payments');
    expect(userArtifacts.filterVisible(FINTECH, pins).map(p => p.path))
      .toContain('Solution Design/Fintech Technologies/Payments');
  });

  test('this is a real access check, not a name match', () => {
    // The regression that started all this: every one of these is stamped with
    // a space name that no longer exists. Under the old filter they were
    // invisible everywhere; now the stamp is irrelevant.
    expect(userArtifacts.filterVisible(FINTECH, pins)).toHaveLength(2);
  });

  test('an unrestricted space keeps everything', () => {
    expect(userArtifacts.filterVisible(UNRESTRICTED, pins)).toHaveLength(2);
    expect(userArtifacts.filterVisible({}, pins)).toHaveLength(2);
  });

  test('a pinned FOLDER is judged on accessibility, not strict visibility', () => {
    // A pass-through ancestor is not visible in its own right but IS navigable,
    // so a user who pinned it can still drill through.
    const curated = {
      name: 'Curated',
      configuration: { allowedPaths: ['Solution Design/Distribution'] }
    };
    const visible = userArtifacts.filterVisible(curated, [
      { type: 'folder', path: 'Solution Design' },
      { type: 'folder', path: 'Standards' }
    ]);
    expect(visible.map(p => p.path)).toEqual(['Solution Design']);
  });

  test('an excluded DOCUMENT is dropped from recent', () => {
    const recent = userArtifacts.normalise([
      { path: 'Solution Design/Fintech Technologies/rails.md', visitedAt: '2026-07-01T00:00:00.000Z' },
      { path: 'Standards/naming.md', visitedAt: '2026-07-02T00:00:00.000Z' }
    ]);
    expect(userArtifacts.filterVisible(ENGINEERING, recent).map(r => r.path))
      .toEqual(['Standards/naming.md']);
  });
});

describe('forSpace — the order every consumer needs', () => {
  test('normalises then scopes, in one call', () => {
    expect(userArtifacts.forSpace(ENGINEERING, LEGACY_PINS)).toEqual(
      userArtifacts.filterVisible(ENGINEERING, userArtifacts.normalise(LEGACY_PINS))
    );
  });
});

describe('the recent cap', () => {
  test('is generous, because one list serves every view of a root', () => {
    // Every space on a content root draws from the SAME list and then filters,
    // so a tight cap lets a busy afternoon in one view evict another view's
    // history entirely. The UI shows ~6 per space after filtering.
    expect(userArtifacts.RECENT_LIMIT).toBeGreaterThanOrEqual(50);
  });
});
