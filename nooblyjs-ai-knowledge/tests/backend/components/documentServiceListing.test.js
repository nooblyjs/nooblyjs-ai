'use strict';

/**
 * DocumentService listing — shared content roots and walk-time pruning.
 *
 * `listAll()` used to walk each space's content root separately and filter the
 * finished tree. Two spaces on ONE root (Retail and Engineering both sit on
 * `knowledge-content/engineering`, ~6,000 directories) therefore paid for the
 * same disk walk twice, and a curated space paid to list subtrees it would
 * immediately discard.
 *
 * It now groups spaces by content root, walks each root once, and passes a
 * `shouldDescend` predicate into the walk. That is a performance change with a
 * correctness surface: the documents each space ends up with must be IDENTICAL
 * to what the per-space walk produced. These tests pin that, using a fake
 * filing wrapper that records every directory it is asked to list — so the
 * saving is asserted, not assumed.
 */

const DocumentService = require('../../../src/wiki/components/documentService');

/**
 * A filing wrapper over an in-memory tree, honouring `shouldDescend` exactly as
 * FilingServiceWrapper.buildFileTree does, and recording each directory read.
 *
 * `tree` is a nested plain object: keys ending in '/' are folders.
 */
function makeFilingWrapper(rootsBySpaceName) {
  const listed = [];

  const build = (node, prefix, shouldDescend) => {
    const out = [];
    for (const [key, value] of Object.entries(node)) {
      const isFolder = key.endsWith('/');
      const name = isFolder ? key.slice(0, -1) : key;
      const itemPath = prefix ? `${prefix}/${name}` : name;
      if (isFolder) {
        if (shouldDescend && !shouldDescend(itemPath)) continue;
        listed.push(itemPath);
        out.push({ type: 'folder', name, path: itemPath, children: build(value, itemPath, shouldDescend) });
      } else {
        out.push({ type: 'document', name, title: name, path: itemPath, size: 10 });
      }
    }
    return out;
  };

  return {
    listed,
    async buildFileTree(spaceName, dirPath = '', options = {}) {
      const root = rootsBySpaceName[spaceName];
      if (!root) throw new Error(`No filing service for space "${spaceName}"`);
      listed.push(`${spaceName}:<root>`);
      return build(root, dirPath, typeof options.shouldDescend === 'function' ? options.shouldDescend : null);
    }
  };
}

const TREE = {
  'home.md': 1,
  'Solution Design/': {
    'Distribution/': {
      'design.md': 1,
      'Technology/': { 'secret.md': 1 }
    },
    'Other Team/': { 'theirs.md': 1 }
  },
  'Standards/': { 'principles.md': 1 },
  'Archive/': { 'old.md': 1 }
};

const ENGINEERING = {
  id: 1,
  name: 'Engineering Collaboration Space',
  configuration: { filing: { baseDir: '../knowledge-content/engineering' } }
};

const RETAIL = {
  id: 5,
  name: 'Retail Collaboration Space',
  configuration: {
    filing: { baseDir: '../knowledge-content/engineering' },
    allowedPaths: ['Solution Design/Distribution/*', 'Standards/*'],
    excludedPaths: ['Solution Design/Distribution/Technology/*']
  }
};

function makeService(spaces, rootsBySpaceName) {
  const filingServiceWrapper = makeFilingWrapper(rootsBySpaceName);
  const service = new DocumentService({
    dataManager: { read: async () => spaces },
    filingServiceWrapper,
    logger: { warn() {}, error() {}, info() {} }
  });
  return { service, filingServiceWrapper };
}

const paths = (docs) => docs.map(d => d.path).sort();

describe('a content root shared by two spaces is walked once', () => {
  test('both spaces still get exactly the documents they are entitled to', async () => {
    const { service } = makeService([ENGINEERING, RETAIL], {
      [ENGINEERING.name]: TREE,
      [RETAIL.name]: TREE
    });

    const all = await service.listAll();
    const engineering = paths(all.filter(d => d.spaceId === ENGINEERING.id));
    const retail = paths(all.filter(d => d.spaceId === RETAIL.id));

    // Unrestricted: everything on the root.
    expect(engineering).toEqual([
      'Archive/old.md',
      'Solution Design/Distribution/Technology/secret.md',
      'Solution Design/Distribution/design.md',
      'Solution Design/Other Team/theirs.md',
      'Standards/principles.md',
      'home.md'
    ]);

    // Curated: two allowed subtrees, one carve-out, plus the root-level file
    // (always visible — it is the space landing page).
    expect(retail).toEqual([
      'Solution Design/Distribution/design.md',
      'Standards/principles.md',
      'home.md'
    ]);
  });

  test('the tree is built once, not once per space', async () => {
    const { service, filingServiceWrapper } = makeService([ENGINEERING, RETAIL], {
      [ENGINEERING.name]: TREE,
      [RETAIL.name]: TREE
    });

    await service.listAll();

    const rootWalks = filingServiceWrapper.listed.filter(p => p.endsWith(':<root>'));
    expect(rootWalks).toHaveLength(1);
  });

  test('documents are stamped from their own space, not the one that was walked', async () => {
    const { service } = makeService([ENGINEERING, RETAIL], {
      // Only the space that is actually walked has a filing service; if the
      // implementation ever walked per space this would throw.
      [ENGINEERING.name]: TREE
    });

    const all = await service.listAll();
    const retail = all.filter(d => d.spaceId === RETAIL.id);

    expect(retail.length).toBeGreaterThan(0);
    for (const doc of retail) {
      expect(doc.spaceName).toBe(RETAIL.name);
    }
  });

  test('spaces on different roots are walked separately', async () => {
    const fintech = {
      id: 2,
      name: 'Fintech Collaboration Space',
      configuration: { filing: { baseDir: '../knowledge-content/fintech' } }
    };
    const { service, filingServiceWrapper } = makeService([ENGINEERING, RETAIL, fintech], {
      [ENGINEERING.name]: TREE,
      [fintech.name]: { 'notes.md': 1 }
    });

    const all = await service.listAll();
    const rootWalks = filingServiceWrapper.listed.filter(p => p.endsWith(':<root>'));

    expect(rootWalks).toHaveLength(2);
    expect(paths(all.filter(d => d.spaceId === fintech.id))).toEqual(['notes.md']);
  });

  test('a root spelled with different separators or case still groups', async () => {
    const twin = {
      id: 9,
      name: 'Twin Space',
      configuration: { filing: { baseDir: '..\\Knowledge-Content\\Engineering' } }
    };
    const { service, filingServiceWrapper } = makeService([ENGINEERING, twin], {
      [ENGINEERING.name]: TREE
    });

    await service.listAll();
    expect(filingServiceWrapper.listed.filter(p => p.endsWith(':<root>'))).toHaveLength(1);
  });
});

describe('curated spaces prune as they walk', () => {
  test('a lone curated space never lists what it cannot show', async () => {
    const { service, filingServiceWrapper } = makeService([RETAIL], {
      [RETAIL.name]: TREE
    });

    await service.listBySpace(RETAIL);
    const dirs = filingServiceWrapper.listed.filter(p => !p.endsWith(':<root>'));

    // Descends into the container and the two allowed subtrees...
    expect(dirs).toContain('Solution Design');
    expect(dirs).toContain('Solution Design/Distribution');
    expect(dirs).toContain('Standards');
    // ...and never enters the carve-out or the unrelated subtrees. Before this
    // change all four were listed in full and then discarded.
    expect(dirs).not.toContain('Solution Design/Distribution/Technology');
    expect(dirs).not.toContain('Solution Design/Other Team');
    expect(dirs).not.toContain('Archive');
  });

  test('an unrestricted space in the group disables pruning', async () => {
    const { service, filingServiceWrapper } = makeService([ENGINEERING, RETAIL], {
      [ENGINEERING.name]: TREE
    });

    await service.listAll();
    const dirs = filingServiceWrapper.listed;

    // The prune is the UNION of the group, so it can never hide something a
    // member needs — Engineering sees everything, so nothing is skipped.
    expect(dirs).toContain('Archive');
    expect(dirs).toContain('Solution Design/Distribution/Technology');
  });

  test('pruning does not change what a curated space returns', async () => {
    // The same assertion as the grouped case, but reached through the
    // single-space entry point — listBySpace and listAll must not disagree.
    const { service } = makeService([RETAIL], { [RETAIL.name]: TREE });

    expect(paths(await service.listBySpace(RETAIL))).toEqual([
      'Solution Design/Distribution/design.md',
      'Standards/principles.md',
      'home.md'
    ]);
  });
});

/**
 * The tests above stand a fake in for FilingServiceWrapper. This one exercises
 * the REAL walk, so the `shouldDescend` contract the fake mirrors is pinned at
 * the place it is actually implemented.
 */
describe('FilingServiceWrapper.buildFileTree honours shouldDescend', () => {
  const FilingServiceWrapper = require('../../../src/wiki/utils/filingServiceWrapper');

  /** A filing service over a flat path→isDir map, recording every list(). */
  function makeFiling(entries) {
    const listed = [];
    return {
      listed,
      async list(dirPath) {
        const dir = dirPath === '.' ? '' : dirPath;
        listed.push(dir);
        return Object.keys(entries)
          .filter((p) => {
            const parent = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
            return parent === dir;
          })
          .map((p) => ({
            name: p.slice(p.lastIndexOf('/') + 1),
            isDirectory: entries[p]
          }));
      }
    };
  }

  const ENTRIES = {
    'home.md': false,
    'Standards': true,
    'Standards/principles.md': false,
    'Archive': true,
    'Archive/old.md': false,
    'Archive/Deep': true,
    'Archive/Deep/deeper.md': false
  };

  function makeWrapper(filing) {
    const wrapper = new FilingServiceWrapper(null, null, filing, { warn() {}, error() {} });
    // Every space resolves to the one filing service under test.
    wrapper.getFilingServiceForSpace = async () => filing;
    return wrapper;
  }

  test('a pruned folder is not listed, and neither is anything below it', async () => {
    const filing = makeFiling(ENTRIES);
    const tree = await makeWrapper(filing).buildFileTree('S', '', {
      shouldDescend: (folderPath) => folderPath !== 'Archive'
    });

    expect(filing.listed).toEqual(['', 'Standards']);
    expect(filing.listed).not.toContain('Archive/Deep');
    // Pruned folders are absent from the tree, not present-but-empty.
    expect(tree.map(n => n.name).sort()).toEqual(['Standards', 'home.md']);
  });

  test('without the option the walk is exhaustive, exactly as before', async () => {
    const filing = makeFiling(ENTRIES);
    const tree = await makeWrapper(filing).buildFileTree('S', '');

    expect(filing.listed.sort()).toEqual(['', 'Archive', 'Archive/Deep', 'Standards']);
    expect(tree.map(n => n.name).sort()).toEqual(['Archive', 'Standards', 'home.md']);
  });
});

describe('failure modes', () => {
  test('a space whose root cannot be walked yields nothing and does not throw', async () => {
    const { service } = makeService([ENGINEERING], {});   // no filing service
    await expect(service.listAll()).resolves.toEqual([]);
  });

  test('a space with no configured root is never grouped with another', async () => {
    const a = { id: 11, name: 'A' };
    const b = { id: 12, name: 'B' };
    const { service, filingServiceWrapper } = makeService([a, b], {
      A: { 'a.md': 1 },
      B: { 'b.md': 1 }
    });

    const all = await service.listAll();
    expect(filingServiceWrapper.listed.filter(p => p.endsWith(':<root>'))).toHaveLength(2);
    expect(paths(all)).toEqual(['a.md', 'b.md']);
  });
});
