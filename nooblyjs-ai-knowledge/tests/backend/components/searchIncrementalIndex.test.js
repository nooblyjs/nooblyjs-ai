/**
 * @fileoverview Tests for the file-watcher → search-index incremental pipeline.
 *
 * Files written directly to disk (e.g. by workflows via the filing service)
 * never pass through the wiki document routes, so the watcher is their only
 * path into the search index. These tests cover:
 *  - the indexability predicate (must mirror FilingServiceWrapper's dot-entry
 *    filter so incremental and full-rebuild behaviour never drift), and
 *  - the SearchIndexer incremental methods (updateFileInSpace,
 *    removeFileFromIndexIncremental, removeFolderFromIndex) including the
 *    debounced disk persist.
 */

'use strict';

const SearchIndexer = require('../../../src/wiki/activities/searchIndexer');
const {
  isSearchIndexablePath,
  isIgnoredPath
} = require('../../../src/wiki/activities/fileWatcher');

const noopLogger = { info() {}, warn() {}, debug() {}, error() {} };

// _schedulePersist sets a timer on every incremental change; fake timers
// file-wide keep those inert unless a test advances the clock explicitly.
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

/**
 * Minimal stand-in for the core SearchTokenService: stores docs in a container
 * map the way the indexer's container-scanning code expects (storedFields),
 * and counts saveToDisk calls so the persist debounce can be asserted.
 */
class FakeTokenService {
  constructor() {
    this.containers = new Map([['default', { documents: new Map() }]]);
    this.saveCalls = 0;
  }
  async indexDocument(id, content, metadata = {}, containerName = 'default') {
    this.containers.get(containerName).documents.set(id, {
      storedFields: { ...metadata },
      text: content
    });
  }
  removeDocument(id, containerName = 'default') {
    this.containers.get(containerName).documents.delete(id);
  }
  async saveToDisk() {
    this.saveCalls++;
  }
}

function makeIndexer(contentByPath = {}) {
  const tokenService = new FakeTokenService();
  const wrapper = {
    async readDocument(spaceName, relPath) {
      if (Object.prototype.hasOwnProperty.call(contentByPath, relPath)) {
        return contentByPath[relPath];
      }
      throw new Error(`ENOENT: ${spaceName}/${relPath}`);
    }
  };
  const indexer = new SearchIndexer(noopLogger, {}, tokenService, wrapper, {
    appBaseDir: __dirname
  });
  return { indexer, tokenService };
}

describe('isSearchIndexablePath (watcher ↔ rebuild parity)', () => {
  test('accepts normal document paths', () => {
    expect(isSearchIndexablePath('Infrastructure/Networks/overview.md')).toBe(true);
    expect(isSearchIndexablePath('report.docx')).toBe(true);
  });

  test('accepts folder home files at any depth', () => {
    expect(isSearchIndexablePath('.home.md')).toBe(true);
    expect(isSearchIndexablePath('Infrastructure/Networks/.home.md')).toBe(true);
    expect(isSearchIndexablePath('Infrastructure\\Networks\\.home.md')).toBe(true);
  });

  test('accepts the .aicontext chat cache (rebuild indexes it)', () => {
    // buildFileTree's filter keeps exactly two dot-entries: `.home.md` and
    // `.aicontext`. Keep this in lockstep with filingServiceWrapper.
    expect(isSearchIndexablePath('Folder/.aicontext/summary.md')).toBe(true);
  });

  test('rejects the folder-local .system namespace (all artifacts live there)', () => {
    // derived / originals / context / file-order / file-types are ALL folder-local
    // under `<folder>/.system/`, so one dot-segment rule excludes every one of them.
    expect(isSearchIndexablePath('Folder/.system/derived/report.docx.md')).toBe(false);
    expect(isSearchIndexablePath('Folder/.system/originals/report.docx')).toBe(false);
    expect(isSearchIndexablePath('Folder/.system/context/report.md')).toBe(false);
    expect(isSearchIndexablePath('Folder/.system/context/_folder.md')).toBe(false);
    expect(isSearchIndexablePath('Folder/.system/file-order.json')).toBe(false);
    expect(isSearchIndexablePath('Folder/.system/file-types.json')).toBe(false);
    // Same at the space root, where `.system` also holds the space-scoped dirs.
    expect(isSearchIndexablePath('.system/derived/report.docx.md')).toBe(false);
    expect(isSearchIndexablePath('.system/templates/default.json')).toBe(false);
    expect(isSearchIndexablePath('.system/useractivity/user/visits.json')).toBe(false);
  });

  test('rejects other dot-segments the rebuild filters out', () => {
    // `.settings` and `.context` are the pre-migration locations, still excluded.
    expect(isSearchIndexablePath('.settings/file-types.json')).toBe(false);
    expect(isSearchIndexablePath('Folder/.settings/order.json')).toBe(false);
    expect(isSearchIndexablePath('Folder/.context/overview.md')).toBe(false);
    expect(isSearchIndexablePath('Folder/.originals/report.docx')).toBe(false);
  });

  test('rejects empty paths', () => {
    expect(isSearchIndexablePath('')).toBe(false);
    expect(isSearchIndexablePath(null)).toBe(false);
  });

  /**
   * The invariant that ties the watcher's two gates together, and the one a
   * shipped regression violated: every handler returns early on isIgnoredPath
   * BEFORE it reaches updateSearchIndex, so isSearchIndexablePath is only ever
   * consulted for paths the ignore gate already let through. Widening the ignore
   * gate therefore silently de-indexes files a full rebuild still keeps — the
   * predicate above kept answering `true` for `.home.md` while nothing asked it.
   *
   * `.home.md` is the case that matters: it is machine-written in bulk (one per
   * folder by the context build and the code processor), which makes it tempting
   * to ignore outright for churn, but it is a real user-visible document and the
   * watcher is its only route into the live index. Churn belongs in
   * isContextEligible, which excludes it by name — see contextTriggerEligibility.
   */
  test('nothing the rebuild indexes is blocked by the watcher ignore gate', () => {
    const indexable = [
      'Infrastructure/Networks/overview.md',
      'report.docx',
      '.home.md',
      'Infrastructure/Networks/.home.md',
      'Folder/.aicontext/summary.md'
    ];
    for (const rel of indexable) {
      expect(isSearchIndexablePath(rel)).toBe(true);
      // Absolute form, as chokidar delivers it to the handlers.
      expect(isIgnoredPath(`C:/content/space/${rel}`)).toBe(false);
      expect(isIgnoredPath(`/content/space/${rel}`)).toBe(false);
    }
  });

  test('the ignore gate still blocks the .system namespace and OS cruft', () => {
    expect(isIgnoredPath('/content/space/Folder/.system/context/_folder.md')).toBe(true);
    expect(isIgnoredPath('/content/space/Folder/.system/derived/report.pdf.md')).toBe(true);
    expect(isIgnoredPath('/content/space/.git/config')).toBe(true);
    expect(isIgnoredPath('/content/space/node_modules/pkg/index.js')).toBe(true);
    expect(isIgnoredPath('/content/space/Folder/.DS_Store')).toBe(true);
    expect(isIgnoredPath('/content/space/Folder/Thumbs.db')).toBe(true);
  });
});

describe('SearchIndexer.updateFileInSpace', () => {
  test('indexes the file under its normalized posix path with space metadata', async () => {
    const { indexer, tokenService } = makeIndexer({
      'Infrastructure/Networks/.home.md': '# Networks\n\nCore network segmentation.'
    });

    // Watcher paths can arrive with backslashes on Windows — the stored key
    // must match the forward-slash format the full rebuild uses.
    await indexer.updateFileInSpace('Infrastructure', 'Infrastructure\\Networks\\.home.md');

    const docs = tokenService.containers.get('default').documents;
    expect(docs.has('Infrastructure/Networks/.home.md')).toBe(true);

    const stored = docs.get('Infrastructure/Networks/.home.md').storedFields;
    expect(stored.spaceName).toBe('Infrastructure');
    expect(stored.docType).toBe('Home');
    expect(stored.isIndexed).toBe(true);
  });

  test('replaces stale chunk entries when a document shrinks', async () => {
    const { indexer, tokenService } = makeIndexer({
      'big.md': 'now small'
    });
    const docs = tokenService.containers.get('default').documents;

    // Simulate a previously chunked large document.
    docs.set('big.md#chunk-0', { storedFields: { parentPath: 'big.md' } });
    docs.set('big.md#chunk-1', { storedFields: { parentPath: 'big.md' } });

    await indexer.updateFileInSpace('Infrastructure', 'big.md');

    expect(docs.has('big.md')).toBe(true);
    expect(docs.has('big.md#chunk-0')).toBe(false);
    expect(docs.has('big.md#chunk-1')).toBe(false);
  });

  test('still indexes name/path when content cannot be read (metadata-only)', async () => {
    const { indexer, tokenService } = makeIndexer({}); // readDocument always throws

    await indexer.updateFileInSpace('Infrastructure', 'Networks/diagram.md');

    const docs = tokenService.containers.get('default').documents;
    expect(docs.has('Networks/diagram.md')).toBe(true);
    expect(docs.get('Networks/diagram.md').storedFields.isIndexed).toBe(false);
  });

  test('no-ops while a full rebuild is in flight', async () => {
    const { indexer, tokenService } = makeIndexer({ 'a.md': 'content' });
    indexer.isIndexing = true;

    await indexer.updateFileInSpace('Infrastructure', 'a.md');

    expect(tokenService.containers.get('default').documents.size).toBe(0);
  });

  test('no-ops without a filing wrapper', async () => {
    const tokenService = new FakeTokenService();
    const indexer = new SearchIndexer(noopLogger, {}, tokenService, null, {
      appBaseDir: __dirname
    });

    await indexer.updateFileInSpace('Infrastructure', 'a.md');

    expect(tokenService.containers.get('default').documents.size).toBe(0);
  });

  test('debounces disk persistence across a burst of updates', async () => {
    const { indexer, tokenService } = makeIndexer({
      'a.md': 'alpha',
      'b.md': 'bravo',
      'c.md': 'charlie'
    });

    await indexer.updateFileInSpace('Infrastructure', 'a.md');
    await indexer.updateFileInSpace('Infrastructure', 'b.md');
    await indexer.updateFileInSpace('Infrastructure', 'c.md');

    expect(tokenService.saveCalls).toBe(0);

    jest.advanceTimersByTime(5000);
    await Promise.resolve(); // let the async persist settle

    expect(tokenService.saveCalls).toBe(1);
  });
});

describe('SearchIndexer.removeFileFromIndexIncremental', () => {
  test('removes the document and its chunk entries, then schedules persist', async () => {
    const { indexer, tokenService } = makeIndexer();
    const docs = tokenService.containers.get('default').documents;
    docs.set('C/z.md', { storedFields: { path: 'C/z.md' } });
    docs.set('C/z.md#chunk-0', { storedFields: { parentPath: 'C/z.md' } });
    docs.set('other.md', { storedFields: { path: 'other.md' } });

    indexer.removeFileFromIndexIncremental('C\\z.md');

    expect(docs.has('C/z.md')).toBe(false);
    expect(docs.has('C/z.md#chunk-0')).toBe(false);
    expect(docs.has('other.md')).toBe(true);

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(tokenService.saveCalls).toBe(1);
  });
});

describe('SearchIndexer.removeFolderFromIndex', () => {
  test('removes only documents under the folder (segment-aware)', () => {
    const { indexer, tokenService } = makeIndexer();
    const docs = tokenService.containers.get('default').documents;
    docs.set('A/x.md', { storedFields: { path: 'A/x.md' } });
    docs.set('A/x.md#chunk-1', { storedFields: { parentPath: 'A/x.md', path: 'A/x.md' } });
    docs.set('A/sub/y.md', { storedFields: { path: 'A/sub/y.md' } });
    docs.set('A-archive/z.md', { storedFields: { path: 'A-archive/z.md' } });
    docs.set('B/y.md', { storedFields: { path: 'B/y.md' } });

    indexer.removeFolderFromIndex('A');

    expect(Array.from(docs.keys()).sort()).toEqual(['A-archive/z.md', 'B/y.md']);
  });

  test('ignores an empty folder path (never wipes the index)', () => {
    const { indexer, tokenService } = makeIndexer();
    const docs = tokenService.containers.get('default').documents;
    docs.set('A/x.md', { storedFields: { path: 'A/x.md' } });

    indexer.removeFolderFromIndex('');
    indexer.removeFolderFromIndex('/');

    expect(docs.size).toBe(1);
  });
});
