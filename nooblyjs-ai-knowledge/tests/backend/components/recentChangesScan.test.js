'use strict';

/**
 * Recent-changes scan — the walk behind the ```recent-changes``` block and
 * `GET /spaces/:id/recent-changes`.
 *
 * The properties worth pinning are the ones that fail QUIETLY. A scan that is
 * merely slow gets noticed; a scan that silently skips a curated-away subtree,
 * or silently reports a truncated walk as "nothing changed", looks exactly like
 * a working panel:
 *
 *   1. Recursion actually reaches the bottom, and dot-prefixed plumbing
 *      (`.system`, `.aicontext`, `.home.md`) never appears as "a change".
 *   2. Space curation is applied DURING the walk, with the three visibility
 *      predicates kept distinct — a pass-through container is descended into
 *      but is not itself listed.
 *   3. Both bounds (depth, listing budget) set `truncated`, so a short answer
 *      is distinguishable from a quiet one.
 *   4. `days` / `limit` / `types` narrow a scan that is otherwise
 *      time-independent, which is what lets one walk serve every block pointed
 *      at the same folder.
 */

const {
  collectRecentEntries,
  selectRecent,
  normaliseRecentQuery,
  planPinnedScan,
  mergeRecentEntries
} = require('../../../src/wiki/utils/recentChanges');
const { compileVisibility } = require('../../../src/shared/spaces/spaceVisibility');

const NOW = Date.UTC(2026, 7, 26, 12, 0, 0);
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

/**
 * A filing service over a plain path -> entries map, shaped like the real one:
 * `list()` answers objects with `name`/`isDirectory`/`modified`, and throws for
 * anything that is not a directory.
 */
function fakeFiling(dirs) {
  return {
    listCount: 0,
    async list(dirPath) {
      this.listCount += 1;
      const key = dirPath === '.' ? '' : dirPath;
      if (!Object.prototype.hasOwnProperty.call(dirs, key)) {
        throw Object.assign(new Error(`ENOTDIR: ${key}`), { code: 'ENOTDIR' });
      }
      return dirs[key];
    }
  };
}

const doc = (name, days) => ({ name, isDirectory: false, modified: daysAgo(days), size: 100 });
const dir = (name, days) => ({ name, isDirectory: true, modified: daysAgo(days) });

/** Two levels of folders under a root, with plumbing sprinkled through it. */
const TREE = {
  '': [dir('Sell', 2), dir('Buy', 40), doc('home.md', 1), dir('.system', 0)],
  'Sell': [doc('overview.md', 3), dir('Promotions', 5), doc('.home.md', 0), dir('.aicontext', 0)],
  'Sell/Promotions': [doc('idm.md', 4), doc('legacy.pdf', 200)],
  'Buy': [doc('suppliers.md', 60)]
};

describe('collectRecentEntries — the walk', () => {
  test('recurses to the bottom and sorts newest first', async () => {
    const filing = fakeFiling(TREE);
    const { items, truncated } = await collectRecentEntries(filing, { depth: 10 });

    expect(truncated).toBe(false);
    expect(items.map((i) => i.path)).toEqual([
      'home.md',          // 1 day
      'Sell',             // 2
      'Sell/overview.md', // 3
      'Sell/Promotions/idm.md',   // 4
      'Sell/Promotions',  // 5
      'Buy',              // 40
      'Buy/suppliers.md', // 60
      'Sell/Promotions/legacy.pdf' // 200
    ]);
  });

  test('dot-prefixed plumbing never appears, and is never descended into', async () => {
    const filing = fakeFiling(TREE);
    const { items } = await collectRecentEntries(filing, { depth: 10 });

    expect(items.some((i) => i.path.includes('.system'))).toBe(false);
    expect(items.some((i) => i.path.includes('.aicontext'))).toBe(false);
    expect(items.some((i) => i.name === '.home.md')).toBe(false);
  });

  test('a folder carries the number of visible items it holds', async () => {
    const filing = fakeFiling(TREE);
    const { items } = await collectRecentEntries(filing, { depth: 10 });

    // `Sell` holds overview.md + Promotions; `.home.md` and `.aicontext` do not
    // count, because they are not things a reader can see there either.
    expect(items.find((i) => i.path === 'Sell').childCount).toBe(2);
    expect(items.find((i) => i.path === 'Sell/Promotions').childCount).toBe(2);
  });

  test('scanning starts at the folder it is given, not the root', async () => {
    const filing = fakeFiling(TREE);
    const { items } = await collectRecentEntries(filing, { subPath: 'Sell/Promotions', depth: 10 });

    expect(items.map((i) => i.path))
      .toEqual(['Sell/Promotions/idm.md', 'Sell/Promotions/legacy.pdf']);
  });

  test('an unreadable folder costs its own subtree, not the whole scan', async () => {
    const filing = fakeFiling({
      '': [dir('Good', 1), dir('Broken', 1)],
      'Good': [doc('a.md', 1)]
      // 'Broken' is declared a directory but has no listing — a dead symlink.
    });
    const { items, missing } = await collectRecentEntries(filing, { depth: 10 });

    expect(items.map((i) => i.path).sort()).toEqual(['Broken', 'Good', 'Good/a.md']);
    expect(missing).toBe(false);
  });

  test('a folder that cannot be listed AT ALL reports missing, not empty', async () => {
    // The route turns this into a 404. Reporting it as "nothing changed" would
    // leave a mistyped `folder:` looking like a quiet week.
    const filing = fakeFiling(TREE);
    const { items, missing } = await collectRecentEntries(filing, {
      subPath: 'Sell/Typo', depth: 10
    });

    expect(missing).toBe(true);
    expect(items).toEqual([]);
  });

  test('an entry with no timestamp is counted but not listed', async () => {
    // Nothing can place it in time, so listing it as a recent change would be
    // an invention; it is still an item the folder holds.
    const filing = fakeFiling({
      '': [dir('Docs', 1)],
      'Docs': [{ name: 'undated.md', isDirectory: false }, doc('dated.md', 1)]
    });
    const { items } = await collectRecentEntries(filing, { depth: 10 });

    // Sorted by timestamp, and these two share one — so compare as a set.
    expect(items.map((i) => i.path).sort()).toEqual(['Docs', 'Docs/dated.md']);
    expect(items.find((i) => i.path === 'Docs').childCount).toBe(2);
  });
});

describe('collectRecentEntries — bounds report themselves', () => {
  test('running out of depth sets truncated', async () => {
    const filing = fakeFiling(TREE);
    const { items, truncated } = await collectRecentEntries(filing, { depth: 1 });

    expect(truncated).toBe(true);
    // Only the root's own entries were listed.
    expect(items.map((i) => i.path).sort()).toEqual(['Buy', 'Sell', 'home.md']);
  });

  test('running out of listing budget sets truncated', async () => {
    const filing = fakeFiling(TREE);
    const { truncated, scannedDirs } = await collectRecentEntries(filing, {
      depth: 10, maxDirs: 2
    });

    expect(truncated).toBe(true);
    expect(scannedDirs).toBe(2);
  });

  test('a finished walk does not claim to be truncated', async () => {
    const filing = fakeFiling(TREE);
    const { truncated } = await collectRecentEntries(filing, { depth: 10, maxDirs: 50 });
    expect(truncated).toBe(false);
  });
});

describe('collectRecentEntries — space curation', () => {
  /**
   * The shape that makes the three predicates matter: `Solution Design` is a
   * pass-through ancestor of the one allowed subtree. It must be walked
   * THROUGH (or the allowed subtree is unreachable) but must not itself be
   * reported as a change, and its own sibling files stay hidden.
   */
  const CURATED_TREE = {
    '': [dir('Solution Design', 1), dir('Secret', 1), doc('home.md', 1)],
    'Solution Design': [dir('Payments', 2), doc('roadmap.md', 1)],
    'Solution Design/Payments': [doc('cards.md', 3)],
    'Secret': [doc('salaries.md', 1)]
  };
  const space = { configuration: { allowedPaths: ['Solution Design/Payments'] } };

  test('walks through a pass-through container without listing it', async () => {
    const filing = fakeFiling(CURATED_TREE);
    const { items } = await collectRecentEntries(filing, {
      depth: 10, visibility: compileVisibility(space)
    });
    const paths = items.map((i) => i.path);

    expect(paths).toContain('Solution Design/Payments');
    expect(paths).toContain('Solution Design/Payments/cards.md');
    expect(paths).not.toContain('Solution Design');
  });

  test('a curated-away sibling never appears, at any depth', async () => {
    const filing = fakeFiling(CURATED_TREE);
    const { items } = await collectRecentEntries(filing, {
      depth: 10, visibility: compileVisibility(space)
    });
    const paths = items.map((i) => i.path);

    expect(paths).not.toContain('Secret');
    expect(paths).not.toContain('Secret/salaries.md');
    expect(paths).not.toContain('Solution Design/roadmap.md');
  });

  test('the space landing page still passes — root-level files are exempt', async () => {
    const filing = fakeFiling(CURATED_TREE);
    const { items } = await collectRecentEntries(filing, {
      depth: 10, visibility: compileVisibility(space)
    });
    expect(items.map((i) => i.path)).toContain('home.md');
  });

  test('a hidden subtree is not even walked', async () => {
    const filing = fakeFiling(CURATED_TREE);
    await collectRecentEntries(filing, { depth: 10, visibility: compileVisibility(space) });

    // Root + Solution Design + Payments. `Secret` is refused before the listing
    // it would have cost — filtering the finished list instead would have paid
    // for the whole excluded subtree.
    expect(filing.listCount).toBe(3);
  });

  test('an unrestricted space sees everything', async () => {
    const filing = fakeFiling(CURATED_TREE);
    const { items } = await collectRecentEntries(filing, {
      depth: 10, visibility: compileVisibility({ configuration: {} })
    });
    expect(items.map((i) => i.path)).toContain('Secret/salaries.md');
  });
});

describe('selectRecent — narrowing one scan for one block', () => {
  let scanned;

  beforeAll(async () => {
    scanned = (await collectRecentEntries(fakeFiling(TREE), { depth: 10 })).items;
  });

  test('the window drops anything older than `days`', () => {
    const picked = selectRecent(scanned, { days: 7, limit: 50, now: NOW });
    expect(picked.map((i) => i.path)).toEqual([
      'home.md', 'Sell', 'Sell/overview.md', 'Sell/Promotions/idm.md', 'Sell/Promotions'
    ]);
  });

  test('days: 0 means all time, and is not mistaken for "unset"', () => {
    const picked = selectRecent(scanned, { days: 0, limit: 50, now: NOW });
    expect(picked.map((i) => i.path)).toContain('Sell/Promotions/legacy.pdf');
  });

  test('limit caps the result, newest kept', () => {
    const picked = selectRecent(scanned, { days: 0, limit: 2, now: NOW });
    expect(picked.map((i) => i.path)).toEqual(['home.md', 'Sell']);
  });

  test('types narrows to documents or folders', () => {
    const docs = selectRecent(scanned, { days: 0, limit: 50, types: 'documents', now: NOW });
    const folders = selectRecent(scanned, { days: 0, limit: 50, types: 'folders', now: NOW });

    expect(docs.every((i) => i.type === 'document')).toBe(true);
    expect(folders.map((i) => i.path)).toEqual(['Sell', 'Sell/Promotions', 'Buy']);
  });

  test('items come back client-shaped — an ISO date, no internal fields', () => {
    const [first] = selectRecent(scanned, { days: 0, limit: 1, now: NOW });
    expect(first.modified).toBe(daysAgo(1));
    expect(first.modifiedAt).toBeUndefined();
  });
});

describe('planPinnedScan — the smallest set of walks that covers a reader', () => {
  const folder = (path) => ({ type: 'folder', path });
  const document = (path) => ({ type: 'document', path });

  test('a pinned folder inside another pinned folder is not scanned twice', () => {
    const plan = planPinnedScan([folder('Sell'), folder('Sell/Promotions'), folder('Buy')]);
    expect(plan.folders).toEqual(['Buy', 'Sell']);
  });

  test('a pinned document under a pinned folder needs no scan of its own', () => {
    const plan = planPinnedScan([folder('Sell'), document('Sell/Promotions/idm.md')]);
    expect(plan.folders).toEqual(['Sell']);
    expect(plan.documentGroups).toEqual([]);
  });

  test('documents outside every pinned folder are grouped by parent', () => {
    const plan = planPinnedScan([
      document('Buy/a.md'), document('Buy/b.md'), document('Ops/c.md')
    ]);
    expect(plan.folders).toEqual([]);
    expect(plan.documentGroups).toEqual([
      { dir: 'Buy', paths: ['Buy/a.md', 'Buy/b.md'] },
      { dir: 'Ops', paths: ['Ops/c.md'] }
    ]);
  });

  test('a document pinned at the space root groups under the root', () => {
    const plan = planPinnedScan([document('home.md')]);
    expect(plan.documentGroups).toEqual([{ dir: '', paths: ['home.md'] }]);
  });

  test('backslashes and stray slashes are normalised before anything is compared', () => {
    const plan = planPinnedScan([folder('Sell\\'), folder('/Sell/Promotions')]);
    expect(plan.folders).toEqual(['Sell']);
  });

  test('a sibling that merely shares a name PREFIX is not swallowed', () => {
    // 'Selling' starts with 'Sell' but is not inside it — a plain startsWith
    // without the separator would silently drop a whole pinned tree.
    const plan = planPinnedScan([folder('Sell'), folder('Selling')]);
    expect(plan.folders).toEqual(['Sell', 'Selling']);
  });

  test('the scan budget bites, keeps folders over documents, and says how much', () => {
    const plan = planPinnedScan(
      [folder('A'), folder('B'), folder('C'), document('X/one.md'), document('Y/two.md')],
      { maxScans: 2 });

    expect(plan.folders).toEqual(['A', 'B']);
    expect(plan.documentGroups).toEqual([]);
    expect(plan.skipped).toBe(3);
  });

  test('the counts describe the reader, not the plan', () => {
    const plan = planPinnedScan([folder('A'), folder('A/B'), document('X/one.md')]);
    // 'A/B' collapsed into 'A', so one folder is scanned and one is reported.
    expect(plan.pinnedFolders).toBe(1);
    expect(plan.pinnedDocuments).toBe(1);
  });

  test('no pins is an empty plan, not an error', () => {
    expect(planPinnedScan([])).toMatchObject({ folders: [], documentGroups: [], skipped: 0 });
    expect(planPinnedScan(null).folders).toEqual([]);
  });

  test('a record with no path is ignored', () => {
    expect(planPinnedScan([{ type: 'folder' }, folder('A')]).folders).toEqual(['A']);
  });
});

describe('mergeRecentEntries — one grid from several scans', () => {
  const at = (path, ms) => ({ type: 'document', name: path, path, modifiedAt: ms });

  test('merges newest first across scans', () => {
    const merged = mergeRecentEntries([[at('a', 300), at('c', 100)], [at('b', 200)]]);
    expect(merged.map((i) => i.path)).toEqual(['a', 'b', 'c']);
  });

  test('a path reached by two scans appears once', () => {
    // Overlapping pinned subtrees are normal; the same file twice in a "what
    // changed" grid reads as a bug.
    const merged = mergeRecentEntries([[at('a', 100)], [at('a', 300)]]);
    expect(merged).toHaveLength(1);
    expect(merged[0].modifiedAt).toBe(300);
  });

  test('empty and missing scans contribute nothing', () => {
    expect(mergeRecentEntries([[], undefined, [at('a', 1)]]).map((i) => i.path)).toEqual(['a']);
    expect(mergeRecentEntries(null)).toEqual([]);
  });

  test('the keep cap is applied after the merge', () => {
    const many = Array.from({ length: 10 }, (_, i) => at(`f${i}`, i));
    expect(mergeRecentEntries([many], 3).map((i) => i.path)).toEqual(['f9', 'f8', 'f7']);
  });
});

describe('normaliseRecentQuery — a typo shows the default panel, not a 400', () => {
  test('unset falls back', () => {
    expect(normaliseRecentQuery({})).toEqual({ days: 30, limit: 8, types: 'all' });
  });

  test('nonsense falls back', () => {
    expect(normaliseRecentQuery({ days: 'soon', limit: '-4', types: 'sideways' }))
      .toEqual({ days: 30, limit: 8, types: 'all' });
  });

  test('"all" and 0 both mean no window', () => {
    expect(normaliseRecentQuery({ days: 'all' }).days).toBe(0);
    expect(normaliseRecentQuery({ days: '0' }).days).toBe(0);
  });

  test('limit is clamped rather than refused', () => {
    expect(normaliseRecentQuery({ limit: '9999' }).limit).toBe(60);
  });
});
