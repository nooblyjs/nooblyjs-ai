'use strict';

/**
 * Onboarding suggested folders.
 *
 * These were a hardcoded list, and by 2026-08-03 every entry in it was doubly
 * dead: each named `spaceName: "Engineering Collaboration Space"` (renamed away)
 * and a `Technology/...` path that stopped existing when the folders were
 * consolidated. The real content root holds Solution Design, Standards,
 * Application Design, Business Processes, Infrastructure Design and Product
 * Management — nothing under `Technology/`. So every chip produced a pin that
 * pointed nowhere and, because of the stale space stamp, displayed nowhere.
 *
 * Nothing caught it, because a hardcoded list cannot notice that the content
 * moved. They are now derived from the live tree. These tests pin the two
 * properties that matters: suggestions track the tree, and they carry no space
 * stamp (a bookmark belongs to a path — see wiki/components/userArtifacts.js).
 *
 * The module is a browser ES module, so it is evaluated in a `vm` with the
 * `export` keywords stripped — the same approach the other frontend-facing
 * suites here use.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const MODULE = path.resolve(
  __dirname,
  '../../../src/web/wiki/public/js/modules/onboardingSuggested.js'
);

function load() {
  const source = fs.readFileSync(MODULE, 'utf8').replace(/^export\s+/gm, '');
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: 'onboardingSuggested.js' });
  return vm.runInContext(
    '({ suggestedFoldersFrom, suggestedFolderId, iconForFolder })',
    ctx
  );
}

const { suggestedFoldersFrom, suggestedFolderId, iconForFolder } = load();

/** The real top level of knowledge-content/engineering. */
const TREE = [
  { type: 'folder', name: 'Application Design', path: 'Application Design', truncated: true },
  { type: 'folder', name: 'Business Processes', path: 'Business Processes', truncated: true },
  { type: 'document', name: 'Engineering.md', path: 'Engineering.md' },
  { type: 'folder', name: 'Infrastructure Design', path: 'Infrastructure Design', truncated: true },
  { type: 'folder', name: 'Product Management', path: 'Product Management', truncated: true },
  { type: 'folder', name: 'Solution Design', path: 'Solution Design', truncated: true },
  { type: 'folder', name: 'Standards', path: 'Standards', truncated: true },
  { type: 'folder', name: '.system', path: '.system', children: [] }
];

describe('suggestions come from the tree', () => {
  test('top-level folders, in tree order', () => {
    const out = suggestedFoldersFrom(TREE);

    expect(out.map(f => f.name)).toEqual([
      'Application Design',
      'Business Processes',
      'Infrastructure Design',
      'Product Management',
      'Solution Design',
      'Standards'
    ]);
    // Tree order is the space's own `.system/file-order.json` cascade, so
    // whatever an admin put first is suggested first — never re-sorted here.
    expect(out[0].path).toBe('Application Design');
  });

  test('documents and dot-folders are not suggested', () => {
    const names = suggestedFoldersFrom(TREE).map(f => f.name);
    expect(names).not.toContain('Engineering.md');
    expect(names).not.toContain('.system');
  });

  test('NO space stamp — a bookmark belongs to a path', () => {
    for (const folder of suggestedFoldersFrom(TREE)) {
      expect(folder).not.toHaveProperty('spaceName');
      expect(Object.keys(folder).sort()).toEqual(['icon', 'name', 'path']);
    }
  });

  test('the id matches the wizard/pin key, so nothing is re-pinned', () => {
    // Must stay in step with folderKey() in onboardingController and pinKey()
    // in pinController; a mismatch means "already pinned" never matches.
    expect(suggestedFolderId({ path: 'Solution Design' })).toBe('folder::Solution Design');
  });
});

describe('empty and truncated folders', () => {
  test('a truncated folder counts as having content', () => {
    // The tree is lazy — `truncated` means "not listed yet", NOT empty. Treating
    // it as empty would suggest nothing at all on a large space.
    const out = suggestedFoldersFrom([
      { type: 'folder', name: 'Big', path: 'Big', truncated: true, children: [] }
    ]);
    expect(out.map(f => f.name)).toEqual(['Big']);
  });

  test('folders with content are preferred over empty ones', () => {
    const out = suggestedFoldersFrom([
      { type: 'folder', name: 'Empty', path: 'Empty', children: [] },
      { type: 'folder', name: 'Full', path: 'Full', children: [{ type: 'document', name: 'a.md' }] }
    ]);
    expect(out.map(f => f.name)).toEqual(['Full']);
  });

  test('a folder holding only dotfiles reads as empty', () => {
    const out = suggestedFoldersFrom([
      { type: 'folder', name: 'Hidden', path: 'Hidden', children: [{ type: 'document', name: '.home.md' }] },
      { type: 'folder', name: 'Real', path: 'Real', children: [{ type: 'document', name: 'a.md' }] }
    ]);
    expect(out.map(f => f.name)).toEqual(['Real']);
  });

  test('an all-empty space still suggests something', () => {
    // Better a bookmark to an empty folder than a step with nothing on it.
    const out = suggestedFoldersFrom([
      { type: 'folder', name: 'A', path: 'A', children: [] },
      { type: 'folder', name: 'B', path: 'B', children: [] }
    ]);
    expect(out.map(f => f.name)).toEqual(['A', 'B']);
  });

  test('the count is capped', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      type: 'folder', name: `F${i}`, path: `F${i}`, truncated: true
    }));
    expect(suggestedFoldersFrom(many).length).toBeLessThanOrEqual(8);
    expect(suggestedFoldersFrom(many, 3)).toHaveLength(3);
  });

  test('no tree yet is not an error', () => {
    // The wizard can open before the nav tree lands.
    expect(suggestedFoldersFrom(null)).toEqual([]);
    expect(suggestedFoldersFrom(undefined)).toEqual([]);
    expect(suggestedFoldersFrom([])).toEqual([]);
  });
});

describe('icons', () => {
  test('recognised folder names get a themed icon', () => {
    expect(iconForFolder('Solution Design')).toBe('bi-diagram-3');
    expect(iconForFolder('Business Processes')).toBe('bi-signpost-split');
    expect(iconForFolder('Standards')).toBe('bi-shield-check');
  });

  test('anything unrecognised degrades to a plain folder', () => {
    // The hint list never has to be complete — a renamed folder loses its icon,
    // not its place in the list.
    expect(iconForFolder('Zzz Whatever')).toBe('bi-folder2');
    expect(iconForFolder('')).toBe('bi-folder2');
    expect(iconForFolder(undefined)).toBe('bi-folder2');
  });
});
