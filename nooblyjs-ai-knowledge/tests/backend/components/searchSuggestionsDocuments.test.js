/**
 * @fileoverview Tests for document-shaped search suggestions.
 *
 * The pane block's source picker resolves a suggestion back to a real document,
 * so every item it receives must carry a SPACE-RELATIVE path and a space name.
 * Two things used to make that impossible:
 *
 *  - an unscoped request took the core token service's suggest() fast path,
 *    which answers with bare index TERMS ("idm-promo") and drops path/spaceName
 *    from the document entries it does return;
 *  - the container scan preferred the stored ABSOLUTE path over relativePath,
 *    which also defeated the folder-scope filter (an absolute path is never
 *    "under" a space-relative prefix).
 *
 * `documentsOnly` fixes the first, the relativePath preference the second.
 */

'use strict';

const SearchIndexer = require('../../../src/wiki/activities/searchIndexer');

const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/**
 * Minimal stand-in for the core SearchTokenService: just the container shape
 * getSuggestions() scans, plus a suggest() that behaves like the real one
 * (title/type only, no path — and bare token strings).
 */
function fakeTokenService(docs, tokens = []) {
  const documents = new Map();
  docs.forEach((storedFields, i) => {
    documents.set(storedFields.relativePath || `doc-${i}`, { storedFields });
  });
  return {
    containers: new Map([['default', { documents, tokens: new Map(tokens.map(t => [t, []])) }]]),
    suggest: (query) => {
      const q = query.toLowerCase();
      const out = docs
        .filter(d => (d.name || '').toLowerCase().includes(q))
        .map(d => ({ title: d.name, type: 'document' }));
      return out.concat(tokens.filter(t => t.startsWith(q)));
    }
  };
}

const DOCS = [
  {
    name: 'IDM Overview.md',
    title: 'IDM Overview.md',
    relativePath: 'Solution Design/Identity/IDM Overview.md',
    path: 'C:\\content\\engineering\\Solution Design\\Identity\\IDM Overview.md',
    spaceName: 'Engineering',
    type: 'markdown'
  },
  {
    name: 'Roadmap.md',
    title: 'Roadmap.md',
    relativePath: 'Solution Design\\Identity\\Roadmap.md',
    path: 'C:\\content\\engineering\\Solution Design\\Identity\\Roadmap.md',
    spaceName: 'Engineering',
    type: 'markdown'
  },
  {
    name: 'IDM Handbook.pdf',
    title: 'IDM Handbook.pdf',
    relativePath: 'Reference/IDM Handbook.pdf',
    path: 'C:\\content\\engineering\\Reference\\IDM Handbook.pdf',
    spaceName: 'Engineering',
    type: 'pdf'
  },
  {
    name: 'IDM Notes.md',
    title: 'IDM Notes.md',
    relativePath: 'Notes/IDM Notes.md',
    path: 'C:\\content\\retail\\Notes\\IDM Notes.md',
    spaceName: 'Retail',
    type: 'markdown'
  }
];

function indexerWith(docs = DOCS, tokens = ['idm-promo']) {
  return new SearchIndexer(silentLogger, { read: async () => [] }, fakeTokenService(docs, tokens));
}

describe('getSuggestions — default (term) behaviour', () => {
  test('an unscoped request still delegates to the core fast path', () => {
    const results = indexerWith().getSuggestions('idm', { maxSuggestions: 8 });
    // Which is exactly why it is no use to a document picker: bare terms, and
    // document entries with no path.
    expect(results).toContain('idm-promo');
    expect(results.some(r => typeof r === 'object' && r.path)).toBe(false);
  });
});

describe('getSuggestions — documentsOnly', () => {
  test('returns only path-bearing documents, never bare terms', () => {
    const results = indexerWith().getSuggestions('idm', { maxSuggestions: 8, documentsOnly: true });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r && typeof r === 'object')).toBe(true);
    expect(results.every(r => !!r.path && !!r.spaceName)).toBe(true);
    expect(results).not.toContain('idm-promo');
  });

  test('paths are space-relative and POSIX, not the stored absolute path', () => {
    const results = indexerWith().getSuggestions('roadmap', { maxSuggestions: 8, documentsOnly: true });

    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('Solution Design/Identity/Roadmap.md');
    expect(results[0].path).not.toMatch(/^[A-Za-z]:/);
    expect(results[0].path).not.toContain('\\');
  });

  test('spans spaces when none is specified — a pane may embed a foreign document', () => {
    const spaces = indexerWith()
      .getSuggestions('idm', { maxSuggestions: 8, documentsOnly: true })
      .map(r => r.spaceName);

    expect(new Set(spaces)).toEqual(new Set(['Engineering', 'Retail']));
  });

  test('fileTypes narrows to embeddable documents', () => {
    const results = indexerWith().getSuggestions('idm', {
      maxSuggestions: 8,
      documentsOnly: true,
      fileTypes: ['markdown']
    });

    expect(results.map(r => r.title)).not.toContain('IDM Handbook.pdf');
    expect(results.every(r => r.type === 'markdown')).toBe(true);
  });

  test('name matches outrank folder-path matches', () => {
    const results = indexerWith().getSuggestions('identity', {
      maxSuggestions: 8,
      documentsOnly: true,
      matchPaths: true
    });

    // Nothing is *named* "identity" — these are all folder hits.
    expect(results.map(r => r.title).sort()).toEqual(['IDM Overview.md', 'Roadmap.md']);
  });

  test('matchPaths finds a document by the folder it lives in', () => {
    const results = indexerWith().getSuggestions('solution design road', {
      maxSuggestions: 8,
      documentsOnly: true,
      matchPaths: true
    });

    expect(results.map(r => r.path)).toEqual(['Solution Design/Identity/Roadmap.md']);
  });

  test('matchPaths tolerates separator and case differences', () => {
    const results = indexerWith().getSuggestions('solution-design/identity', {
      maxSuggestions: 8,
      documentsOnly: true,
      matchPaths: true
    });

    expect(results).toHaveLength(2);
  });

  test('without matchPaths a folder-only hit does not match', () => {
    const results = indexerWith().getSuggestions('identity', { maxSuggestions: 8, documentsOnly: true });
    expect(results).toHaveLength(0);
  });

  test('folder scope compares against the relative path', () => {
    const results = indexerWith().getSuggestions('idm', {
      maxSuggestions: 8,
      documentsOnly: true,
      pathPrefix: 'Solution Design'
    });

    expect(results.map(r => r.path)).toEqual(['Solution Design/Identity/IDM Overview.md']);
  });

  test('space filter still applies', () => {
    const results = indexerWith().getSuggestions('idm', {
      maxSuggestions: 8,
      documentsOnly: true,
      spaceNames: ['Retail']
    });

    expect(results.map(r => r.spaceName)).toEqual(['Retail']);
  });

  test('chunked sub-documents collapse to one suggestion', () => {
    const chunked = [
      { ...DOCS[0] },
      { ...DOCS[0], parentPath: DOCS[0].relativePath, chunkIndex: 1 },
      { ...DOCS[0], parentPath: DOCS[0].relativePath, chunkIndex: 2 }
    ];
    // Distinct container keys, same document.
    const service = fakeTokenService([], []);
    const documents = service.containers.get('default').documents;
    chunked.forEach((storedFields, i) => documents.set(`chunk-${i}`, { storedFields }));
    const indexer = new SearchIndexer(silentLogger, { read: async () => [] }, service);

    const results = indexer.getSuggestions('idm', { maxSuggestions: 8, documentsOnly: true });
    expect(results).toHaveLength(1);
  });
});

describe('getSuggestions — fallback index (no token service)', () => {
  function fallbackIndexer() {
    const indexer = new SearchIndexer(silentLogger, { read: async () => [] }, null);
    DOCS.forEach(d => indexer.index.files.set(d.relativePath, { ...d }));
    indexer.index.tokens.set('idm-promo', new Set(['x']));
    return indexer;
  }

  test('documentsOnly suppresses token strings here too', () => {
    const results = fallbackIndexer().getSuggestions('idm', { maxSuggestions: 8, documentsOnly: true });

    expect(results.every(r => r && typeof r === 'object')).toBe(true);
    expect(results.every(r => !!r.path)).toBe(true);
    expect(results).not.toContain('idm-promo');
  });

  test('returns the relative path, not the absolute one', () => {
    const results = fallbackIndexer().getSuggestions('roadmap', { maxSuggestions: 8, documentsOnly: true });

    expect(results[0].path).toBe('Solution Design/Identity/Roadmap.md');
  });
});
