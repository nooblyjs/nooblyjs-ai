'use strict';

/**
 * SearchIndexer — one indexing pass per CONTENT ROOT, not per space.
 *
 * Index entries are keyed by the space-relative path ALONE: see
 * `_indexFileIntoService`, which calls `tokenService.indexDocument(relativePath,
 * …)` and `this.index.files.set(relativePath, …)` with no space prefix. So when
 * several spaces share a content root they write the same keys and overwrite one
 * another — the finished index is whatever the LAST space wrote, and every
 * earlier pass was work that got discarded.
 *
 * That is not a small amount of work: it reads and tokenises every file, and for
 * PDFs/office documents it also generates derived sidecars. On a 30,000-file
 * root shared by four spaces it was ~120,000 file reads to produce 30,000
 * entries, saturating libuv's threadpool and starving the folder-tree walk.
 *
 * These tests pin the two things that make the fix safe: the number of PASSES
 * drops, and the resulting index is unchanged — same keys, same `spaceName`
 * stamped on them (the last space on each root still wins).
 */

const SearchIndexer = require('../../../src/wiki/activities/searchIndexer');

const ENGINEERING_ROOT = '../knowledge-content/engineering';

const SPACES = [
  { id: 1, name: 'Engineering', configuration: { filing: { baseDir: ENGINEERING_ROOT } } },
  { id: 2, name: 'Fintech', configuration: { filing: { baseDir: ENGINEERING_ROOT } } },
  { id: 3, name: 'People', configuration: { filing: { baseDir: ENGINEERING_ROOT } } },
  // Same root, spelled differently — must still group (Windows, mixed slashes).
  { id: 5, name: 'Retail', configuration: { filing: { baseDir: '..\\Knowledge-Content\\Engineering' } } },
  { id: 9, name: 'Fintech Real', configuration: { filing: { baseDir: '../knowledge-content/fintech' } } }
];

const FILES = {
  [ENGINEERING_ROOT.toLowerCase()]: ['home.md', 'Standards/principles.md'],
  '../knowledge-content/fintech': ['notes.md']
};

function makeIndexer() {
  // constructor(logger, spacesDataManager, tokenService, filingServiceWrapper, options)
  const indexer = new SearchIndexer(
    { info() {}, warn() {}, error() {}, debug() {} },
    { read: async () => SPACES, getAllSpaces: () => SPACES }
  );

  // Record which spaces were actually walked, and what landed in the index.
  const passes = [];
  const reads = [];

  indexer.setFilingServiceWrapper({
    async getAllFilesRecursive(spaceName) {
      passes.push(spaceName);
      const space = SPACES.find(s => s.name === spaceName);
      const key = String(space.configuration.filing.baseDir)
        .replace(/\\/g, '/').toLowerCase();
      return FILES[key] || FILES[key.replace(/^\.\.\/knowledge-content/, '../knowledge-content')] || [];
    },
    async readDocument(spaceName, filePath) {
      reads.push(`${spaceName}:${filePath}`);
      return `content of ${filePath}`;
    }
  });

  // Capture index writes instead of touching a real search provider.
  const indexed = new Map();
  indexer._indexFileIntoService = async (relativePath, content, fileInfo) => {
    indexed.set(relativePath, { spaceName: fileInfo.spaceName, content });
  };
  // Disk load must not short-circuit the build.
  indexer.tokenService = null;
  indexer._useFallback = false;
  indexer._loadIndexFromDisk = async () => false;
  indexer._saveIndexToDisk = async () => {};

  return { indexer, passes, reads, indexed };
}

describe('one indexing pass per content root', () => {
  test('four spaces on one root are walked once, not four times', async () => {
    const { indexer, passes } = makeIndexer();

    await indexer.buildIndex();

    // Five spaces, two distinct roots.
    expect(passes).toHaveLength(2);
    expect(new Set(passes).size).toBe(2);
  });

  test('the LAST space on a root is the one indexed, matching the old outcome', async () => {
    const { indexer, passes, indexed } = makeIndexer();

    await indexer.buildIndex();

    // Previously all four ran and the last one's `spaceName` survived on every
    // entry, because the keys collide. Indexing only the last preserves that
    // exactly — the index is byte-identical, the three discarded passes are not.
    expect(passes).toContain('Retail');
    expect(passes).not.toContain('Engineering');
    expect(indexed.get('home.md').spaceName).toBe('Retail');
    expect(indexed.get('Standards/principles.md').spaceName).toBe('Retail');
  });

  test('a space on its own root is still indexed', async () => {
    const { indexer, passes, indexed } = makeIndexer();

    await indexer.buildIndex();

    expect(passes).toContain('Fintech Real');
    expect(indexed.get('notes.md').spaceName).toBe('Fintech Real');
  });

  test('each file is read once per root, not once per space', async () => {
    const { indexer, reads } = makeIndexer();

    await indexer.buildIndex();

    // Two files on the shared root + one on its own = three reads total.
    // Before: three spaces × two files + one = seven.
    expect(reads).toHaveLength(3);
  });
});

describe('_contentRootKey', () => {
  const { indexer } = makeIndexer();

  test('normalises separators and case so one root groups as one', () => {
    expect(indexer._contentRootKey(SPACES[0])).toBe(indexer._contentRootKey(SPACES[3]));
  });

  test('different roots stay distinct', () => {
    expect(indexer._contentRootKey(SPACES[0])).not.toBe(indexer._contentRootKey(SPACES[4]));
  });

  test('a space with no configured root is never grouped with another', () => {
    const a = indexer._contentRootKey({ id: 11 });
    const b = indexer._contentRootKey({ id: 12 });
    expect(a).not.toBe(b);
  });

  test('a trailing slash does not create a second root', () => {
    expect(indexer._contentRootKey({ id: 1, configuration: { filing: { baseDir: `${ENGINEERING_ROOT}/` } } }))
      .toBe(indexer._contentRootKey(SPACES[0]));
  });
});
