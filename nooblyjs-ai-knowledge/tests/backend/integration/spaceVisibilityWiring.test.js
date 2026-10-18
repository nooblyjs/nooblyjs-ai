/**
 * @fileoverview Proves the visibility filter is actually WIRED, not just
 * implemented. The pure rules are covered by components/spaceVisibility.test.js;
 * these tests check the seams where a curated space's hidden content would
 * otherwise escape:
 *
 *   - DocumentService.listBySpace -> feeds /api/documents, recent, popular,
 *     document counts and the search fallback.
 *   - The search route's result filter.
 *
 * The route handlers themselves need a full Express + filing stack to exercise,
 * so the search assertion reproduces the filter's contract against the same
 * compiled matcher the route uses.
 */

'use strict';

const DocumentService = require('../../../src/wiki/components/documentService');
const { compileVisibility } = require('../../../src/shared/spaces/spaceVisibility');
const { summarizeFromSearch } = require('../../../src/wiki/components/searchSummarizer');

const RETAIL = {
  id: 5,
  name: 'Retail Collaboration Space',
  configuration: {
    allowedPaths: ['Solution Design/Distribution/*', 'Standards/*'],
    excludedPaths: ['Solution Design/Distribution/Technology/*']
  }
};

const ENGINEERING = {
  id: 1,
  name: 'Engineering Collaboration Space',
  configuration: {}
};

const folder = (name, path, children = []) => ({ type: 'folder', name, path, children });
const doc = (name, path) => ({ type: 'document', name, path, size: 10 });

/** One content root, shared by both spaces — the real arrangement. */
const SHARED_TREE = [
  folder('Business Processes', 'Business Processes', [
    doc('ARIS.md', 'Business Processes/ARIS.md')
  ]),
  folder('Solution Design', 'Solution Design', [
    folder('Distribution', 'Solution Design/Distribution', [
      doc('Sell.md', 'Solution Design/Distribution/Sell.md'),
      folder('Technology', 'Solution Design/Distribution/Technology', [
        doc('Secret.md', 'Solution Design/Distribution/Technology/Secret.md')
      ])
    ])
  ]),
  folder('Standards', 'Standards', [doc('TOGAF.md', 'Standards/TOGAF.md')]),
  doc('home.md', 'home.md')
];

function makeService(spaces) {
  return new DocumentService({
    filingServiceWrapper: {
      // Same tree whatever the space name — that IS the shared content root.
      buildFileTree: async () => JSON.parse(JSON.stringify(SHARED_TREE))
    },
    dataManager: { read: async () => spaces },
    logger: { warn() {}, info() {}, error() {} }
  });
}

describe('DocumentService honours per-space path visibility', () => {
  test('a curated space lists only what it exposes', async () => {
    const service = makeService([RETAIL]);
    const docs = await service.listBySpace(RETAIL);
    expect(docs.map(d => d.path).sort()).toEqual([
      'Solution Design/Distribution/Sell.md',
      'Standards/TOGAF.md',
      'home.md'
    ]);
  });

  test('the carve-out never reaches the list', async () => {
    const service = makeService([RETAIL]);
    const docs = await service.listBySpace(RETAIL);
    expect(docs.map(d => d.path))
      .not.toContain('Solution Design/Distribution/Technology/Secret.md');
    expect(docs.map(d => d.path)).not.toContain('Business Processes/ARIS.md');
  });

  test('an unrestricted space over the SAME root still sees everything', async () => {
    const service = makeService([ENGINEERING]);
    const docs = await service.listBySpace(ENGINEERING);
    expect(docs.map(d => d.path).sort()).toEqual([
      'Business Processes/ARIS.md',
      'Solution Design/Distribution/Sell.md',
      'Solution Design/Distribution/Technology/Secret.md',
      'Standards/TOGAF.md',
      'home.md'
    ]);
  });

  test('document COUNTS reflect the filter, not the raw disk', async () => {
    const service = makeService([RETAIL, ENGINEERING]);
    await expect(service.countBySpaceId(5)).resolves.toBe(3);
    await expect(service.countBySpaceId(1)).resolves.toBe(5);
  });

  test('get() cannot resolve a hidden document', async () => {
    const service = makeService([RETAIL]);
    await expect(
      service.get(5, 'Solution Design/Distribution/Technology/Secret.md')
    ).resolves.toBeNull();
    await expect(service.get(5, 'Standards/TOGAF.md')).resolves.not.toBeNull();
  });

  test('listAll keeps each space to its own rules', async () => {
    const service = makeService([RETAIL, ENGINEERING]);
    const all = await service.listAll();
    const retail = all.filter(d => d.spaceId === 5).map(d => d.path);
    const engineering = all.filter(d => d.spaceId === 1).map(d => d.path);

    expect(retail).not.toContain('Business Processes/ARIS.md');
    expect(engineering).toContain('Business Processes/ARIS.md');
  });
});

describe('search result filtering', () => {
  /** Mirrors the predicate in searchRoutes' searchHandler. */
  function filterHits(hits, spaces) {
    const cache = new Map();
    const visibilityFor = (spaceName) => {
      if (!cache.has(spaceName)) {
        const space = spaces.find(s => s.name === spaceName);
        cache.set(spaceName, space ? compileVisibility(space) : null);
      }
      return cache.get(spaceName);
    };
    return hits.filter(hit => {
      const visibility = visibilityFor(hit.spaceName);
      if (!visibility || !visibility.restricted) return true;
      return visibility.isFileVisible(hit.relativePath || hit.path);
    });
  }

  const hits = [
    { spaceName: RETAIL.name, relativePath: 'Standards/TOGAF.md' },
    { spaceName: RETAIL.name, relativePath: 'Business Processes/ARIS.md' },
    { spaceName: RETAIL.name, relativePath: 'Solution Design/Distribution/Technology/Secret.md' },
    { spaceName: ENGINEERING.name, relativePath: 'Business Processes/ARIS.md' }
  ];

  test('drops hits the owning space hides, keeps other spaces intact', () => {
    const kept = filterHits(hits, [RETAIL, ENGINEERING]);
    expect(kept).toEqual([
      { spaceName: RETAIL.name, relativePath: 'Standards/TOGAF.md' },
      { spaceName: ENGINEERING.name, relativePath: 'Business Processes/ARIS.md' }
    ]);
  });

  test('a hit for an unknown space is left alone rather than dropped', () => {
    const kept = filterHits(
      [{ spaceName: 'Retired Space', relativePath: 'anything.md' }],
      [RETAIL]
    );
    expect(kept).toHaveLength(1);
  });
});

describe('AI chat grounding cannot read hidden documents', () => {
  const silentLogger = { info() {}, warn() {}, error() {} };

  /** Throws if anything tries to read a document — the point of the test. */
  const forbiddenReader = {
    readDocument: () => { throw new Error('read a hidden document'); }
  };

  test('a hidden hit is dropped before it can be read or summarised', async () => {
    const summaries = await summarizeFromSearch('anything', {
      searchIndexer: {
        search: async () => [{
          spaceName: RETAIL.name,
          relativePath: 'Solution Design/Distribution/Technology/Secret.md',
          title: 'Secret',
          score: 0.9
        }]
      },
      filingServiceWrapper: forbiddenReader,
      aiClient: {},
      logger: silentLogger,
      spaces: [RETAIL]
    });

    expect(summaries).toEqual([]);
  });

  test('a visible hit in the same space is NOT dropped', async () => {
    const readDocument = jest.fn().mockResolvedValue(null);
    await summarizeFromSearch('anything', {
      searchIndexer: {
        search: async () => [{
          spaceName: RETAIL.name,
          relativePath: 'Standards/TOGAF.md',
          title: 'TOGAF',
          score: 0.9
        }]
      },
      filingServiceWrapper: { readDocument },
      aiClient: { generate: async () => '' },
      logger: silentLogger,
      spaces: [RETAIL]
    });

    // Reaching the reader at all proves the filter let it through — the
    // hidden-document test above asserts the exact opposite via the same seam.
    expect(readDocument).toHaveBeenCalled();
  });

  test('with no space records loaded, grounding is left unfiltered', async () => {
    // Degrading to "hide everything" would silently blank chat for every space
    // whenever the records failed to load, so the filter is advisory here.
    const readDocument = jest.fn().mockResolvedValue(null);
    await summarizeFromSearch('anything', {
      searchIndexer: {
        search: async () => [{
          spaceName: RETAIL.name,
          relativePath: 'Business Processes/ARIS.md',
          title: 'ARIS',
          score: 0.9
        }]
      },
      filingServiceWrapper: { readDocument },
      aiClient: { generate: async () => '' },
      logger: silentLogger,
      spaces: []
    });

    expect(readDocument).toHaveBeenCalled();
  });
});
