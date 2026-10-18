/**
 * @fileoverview Folder template cascade — templates are authored in any folder and
 * inherited downward, closest first.
 *
 * The contract under test:
 *   1. Creating a document in a folder offers that folder's `.system/templates/`
 *      first, then each ancestor's, ending at the space root — which is therefore
 *      the space-wide tier, not a separate namespace.
 *   2. A nearer template SHADOWS a further one of the same name, so a team can
 *      override a space-wide template locally without renaming it.
 *   3. Writing a folder template needs only the right to write that folder;
 *      writing the space root's still needs a space admin.
 *
 * (3) is the load-bearing one: gate folder templates behind space admin and the
 * whole tier is unusable by the teams it exists for, which is the failure this
 * suite is here to catch.
 */

'use strict';

const {
  TEMPLATES_DIR,
  ancestorDirsFor,
  templateDirsFor,
  toTemplateRelPath,
  folderForTemplateRelPath,
  isTemplateRelPath,
  pickClosest,
  isSpaceScopedSystemPath,
} = require('../../../src/shared/utils/filePolicy');

const { templateWriteCheck } = require('../../../src/wiki/components/spacePermissions');

describe('filePolicy — template cascade', () => {
  test('templates live in the same folder-local .system namespace as artifacts', () => {
    expect(TEMPLATES_DIR).toBe('.system/templates');
  });

  describe('templateDirsFor', () => {
    test('walks the folder then every ancestor, closest first, ending at the root', () => {
      expect(templateDirsFor('Solution Design/Entreprise Technology/Buy')).toEqual([
        'Solution Design/Entreprise Technology/Buy/.system/templates',
        'Solution Design/Entreprise Technology/.system/templates',
        'Solution Design/.system/templates',
        '.system/templates',
      ]);
    });

    test('the space root is the last rung — a root-level folder still inherits it', () => {
      expect(templateDirsFor('Standards')).toEqual([
        'Standards/.system/templates',
        '.system/templates',
      ]);
    });

    test('the space root itself resolves to exactly one directory', () => {
      expect(templateDirsFor('')).toEqual(['.system/templates']);
      expect(templateDirsFor(null)).toEqual(['.system/templates']);
    });

    test('tolerates Windows separators and stray slashes from clients', () => {
      expect(templateDirsFor('A\\B')).toEqual(templateDirsFor('A/B'));
      expect(templateDirsFor('/A/B/')).toEqual(templateDirsFor('A/B'));
    });

    test('the walk is bounded by the path depth, not the size of the tree', () => {
      // One listing per level is what keeps this cheap on content roots made of
      // symlinked git repositories, where an exhaustive walk is thousands of reads.
      expect(templateDirsFor('a/b/c/d/e')).toHaveLength(6);
    });
  });

  describe('ancestorDirsFor', () => {
    test('is the shared walk — Continuous Exploration templates cascade identically', () => {
      const subDir = '.system/continuous-explorations/.templates';
      expect(ancestorDirsFor('Solution Design/Buy', subDir)).toEqual([
        `Solution Design/Buy/${subDir}`,
        `Solution Design/${subDir}`,
        subDir,
      ]);
    });
  });

  describe('path round-tripping', () => {
    test('toTemplateRelPath places a template in its folder', () => {
      expect(toTemplateRelPath('Solution Design/Buy', 'code-repositories.md'))
        .toBe('Solution Design/Buy/.system/templates/code-repositories.md');
      expect(toTemplateRelPath('', 'code-repositories.md'))
        .toBe('.system/templates/code-repositories.md');
    });

    test('folderForTemplateRelPath recovers the owning folder', () => {
      expect(folderForTemplateRelPath('Solution Design/Buy/.system/templates/x.md'))
        .toBe('Solution Design/Buy');
      expect(folderForTemplateRelPath('.system/templates/x.md')).toBe('');
    });

    test('a non-template path is not mistaken for one', () => {
      expect(folderForTemplateRelPath('Solution Design/Buy/x.md')).toBeNull();
      expect(isTemplateRelPath('Solution Design/Buy/x.md')).toBe(false);
      expect(isTemplateRelPath('Buy/.system/derived/x.pdf.md')).toBe(false);
      expect(isTemplateRelPath('Buy/.system/templates/x.md')).toBe(true);
    });

    test('only the ROOT template dir is space-scoped; a folder one is not', () => {
      // The distinction that decides which RBAC tier applies.
      expect(isSpaceScopedSystemPath('.system/templates/x.md')).toBe(true);
      expect(isSpaceScopedSystemPath('Buy/.system/templates/x.md')).toBe(false);
    });
  });

  describe('pickClosest — shadowing', () => {
    test('the nearest definition of a name wins and hides the ones above it', () => {
      const cascade = [
        { name: 'Code Repositories', distance: 0 },
        { name: 'Code Repositories', distance: 3 },
        { name: 'API Definition', distance: 3 },
      ];
      expect(pickClosest(cascade)).toEqual([
        { name: 'Code Repositories', distance: 0 },
        { name: 'API Definition', distance: 3 },
      ]);
    });

    test('shadowing is case-insensitive — the content roots include Windows checkouts', () => {
      const cascade = [
        { name: 'Report', distance: 0 },
        { name: 'report', distance: 2 },
      ];
      expect(pickClosest(cascade)).toEqual([{ name: 'Report', distance: 0 }]);
    });

    test('closest-first order is preserved, so the UI can label by distance', () => {
      const cascade = [
        { name: 'a', distance: 0 },
        { name: 'b', distance: 1 },
        { name: 'c', distance: 2 },
      ];
      expect(pickClosest(cascade).map(t => t.distance)).toEqual([0, 1, 2]);
    });

    test('unnamed entries are dropped rather than colliding on the empty key', () => {
      expect(pickClosest([{ name: '' }, { name: null }, { name: 'x' }]))
        .toEqual([{ name: 'x' }]);
      expect(pickClosest(null)).toEqual([]);
    });
  });
});

describe('spacePermissions — who may write which template tier', () => {
  const space = { id: 1, name: 'Engineering', visibility: 'public', permissions: 'read-write' };
  const member = { email: 'member@example.com', roles: [] };
  const admin = { email: 'admin@example.com', roles: ['admin'] };

  test('a space-root template still requires a space admin', () => {
    expect(templateWriteCheck(member, space, '.system/templates/x.md').allowed).toBe(false);
    expect(templateWriteCheck(admin, space, '.system/templates/x.md').allowed).toBe(true);
  });

  test('a folder template needs only the right to write that folder', () => {
    // The whole point of the tier: a team seeds templates in their own subtree
    // without needing space administration.
    expect(templateWriteCheck(member, space, 'Buy/.system/templates/x.md').allowed).toBe(true);
    expect(templateWriteCheck(member, space, 'A/B/C/.system/templates/x.md').allowed).toBe(true);
  });

  test('a read-only space refuses folder templates too', () => {
    const readOnly = { ...space, permissions: 'read-only' };
    expect(templateWriteCheck(member, readOnly, 'Buy/.system/templates/x.md').allowed).toBe(false);
  });

  test('personal templates remain owner-only', () => {
    expect(templateWriteCheck(member, space, '.system/useractivity/member/templates/x.md').allowed).toBe(true);
    expect(templateWriteCheck(member, space, '.system/useractivity/someone-else/templates/x.md').allowed).toBe(false);
  });

  test('an ordinary document write is untouched by the template gate', () => {
    expect(templateWriteCheck(member, space, 'Buy/notes.md').allowed).toBe(true);
  });

  test('backslash paths are normalised before the tier is decided', () => {
    // A Windows-shaped path must not slip past the space-root check.
    expect(templateWriteCheck(member, space, '.system\\templates\\x.md').allowed).toBe(false);
  });
});
