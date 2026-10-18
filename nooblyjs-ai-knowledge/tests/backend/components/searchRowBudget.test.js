/**
 * @fileoverview Tests that the search engine is asked for a ROW budget sized to
 * the caller's DOCUMENT budget.
 *
 * Long documents are indexed as several `<path>#chunk-N` sub-documents that
 * search() folds back into one result, so rows and documents are different
 * quantities. The indexer used to hand the provider nothing but a container
 * name, which left every query on the provider's own default row count — 50 for
 * SOLR — and 50 chunk rows collapse to roughly 9 documents. A 43,000-document
 * index therefore answered every query with a handful of results, whatever
 * `limit` the caller asked for, and built its facets from the same nine.
 *
 * These assert the two halves of that: the provider is told how many rows to
 * return, and the caller's document budget is still what bounds the output.
 */

'use strict';

const SearchIndexer = require('../../../src/wiki/activities/searchIndexer');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * A token service that records how it was called and answers with `count`
 * chunk rows spread over `perDoc` chunks each.
 */
function makeTokenService(count, perDoc = 1) {
  const calls = [];
  return {
    calls,
    async search(query, containerOrOptions) {
      calls.push({ query, arg: containerOrOptions });
      const rows = Number.isInteger(containerOrOptions?.maxResults)
        ? Math.min(count, containerOrOptions.maxResults)
        : Math.min(count, 50); // the provider's own default, as SOLR behaves
      const results = [];
      for (let i = 0; i < rows; i++) {
        const parent = `folder/doc-${Math.floor(i / perDoc)}.md`;
        results.push({
          key: `${parent}#chunk-${i % perDoc}`,
          parentPath: parent,
          path: parent,
          relativePath: parent,
          name: `doc-${Math.floor(i / perDoc)}.md`,
          type: 'markdown',
          spaceName: 'Engineering Space',
          score: 100 - i,
          terms: ['payroll']
        });
      }
      return results;
    }
  };
}

function makeIndexer(tokenService) {
  return new SearchIndexer(silentLogger, { getAllSpaces: () => [] }, tokenService, null, {
    appBaseDir: __dirname
  });
}

describe('search row budget', () => {
  test('passes an options object naming the container AND a row count', async () => {
    const tokenService = makeTokenService(500);
    const indexer = makeIndexer(tokenService);

    await indexer.search('payroll', { maxResults: 50 });

    expect(tokenService.calls).toHaveLength(1);
    const { arg } = tokenService.calls[0];
    expect(typeof arg).toBe('object');
    expect(arg.containerName).toBe('default');
    expect(arg.maxResults).toBeGreaterThan(50);
  });

  test('scales the row request above the document budget to absorb chunk fan-out', async () => {
    const tokenService = makeTokenService(5000);
    const indexer = makeIndexer(tokenService);

    await indexer.search('payroll', { maxResults: 100 });

    // A document occupies 5–7 rows on this corpus; asking for exactly the
    // document budget is what produced ~9 results from a 50-row answer.
    expect(tokenService.calls[0].arg.maxResults).toBeGreaterThanOrEqual(100 * 5);
  });

  test('caps the row request so a large limit cannot pull the whole index back', async () => {
    const tokenService = makeTokenService(50000);
    const indexer = makeIndexer(tokenService);

    // The wiki UI asks for 1000 results to build its facet universe.
    await indexer.search('payroll', { maxResults: 1000 });

    expect(tokenService.calls[0].arg.maxResults).toBeLessThanOrEqual(1000);
  });

  test('returns documents, not chunk rows — a chunked corpus still fills the budget', async () => {
    // 600 rows, 6 chunks per document → 100 distinct documents.
    const tokenService = makeTokenService(600, 6);
    const indexer = makeIndexer(tokenService);

    const results = await indexer.search('payroll', { maxResults: 100 });

    expect(results).toHaveLength(100);
    expect(new Set(results.map(r => r.path)).size).toBe(100);
    // …and never a chunk id.
    for (const r of results) expect(r.path).not.toMatch(/#chunk-/);
  });

  test('the document budget, not the row budget, bounds the output', async () => {
    const tokenService = makeTokenService(5000);
    const indexer = makeIndexer(tokenService);

    const results = await indexer.search('payroll', { maxResults: 25 });

    expect(results.length).toBeLessThanOrEqual(25);
  });

  test('without an explicit budget the caller still gets far more than the provider default', async () => {
    const tokenService = makeTokenService(5000);
    const indexer = makeIndexer(tokenService);

    // search()'s own default maxResults is 200.
    const results = await indexer.search('payroll');

    expect(results.length).toBeGreaterThan(50);
  });
});
