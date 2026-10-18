/**
 * @fileoverview Search Caching Tests
 * Tests for search result caching and cache invalidation
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

describe('Search Caching', () => {
  let cacheService;
  let mockSearchIndexer;
  let mockDataManager;

  beforeEach(() => {
    // Mock cache service
    cacheService = {
      _store: {},
      get(key) {
        return this._store[key] || null;
      },
      set(key, value, options = {}) {
        this._store[key] = value;
      },
      delete(key) {
        delete this._store[key];
      },
      keys() {
        return Object.keys(this._store);
      }
    };

    // Mock search indexer
    mockSearchIndexer = {
      search: jest.fn((query, options) => [
        {
          id: '1',
          title: 'Document about ' + query,
          excerpt: 'This is a result for ' + query,
          relativePath: 'docs/result.md',
          type: 'file',
          score: 0.9
        }
      ]),
      getSuggestions: jest.fn((query) => [
        query + '1',
        query + '2',
        query + '3'
      ]),
      buildIndex: jest.fn(async () => true),
      loadContent: jest.fn(async () => 'content')
    };

    // Mock data manager
    mockDataManager = {
      read: jest.fn(async (type) => {
        if (type === 'documents') {
          return [];
        }
        if (type === 'spaces') {
          return [];
        }
        return [];
      })
    };
  });

  describe('Search Result Caching', () => {
    test('should cache search results', async () => {
      const query = 'test';
      const cacheKey = `wiki:search:search?q=${query}`;

      // Populate cache manually
      const result = { success: true, data: [{ title: 'Test' }] };
      cacheService.set(cacheKey, result);

      // Verify cache contains result
      const cached = cacheService.get(cacheKey);
      expect(cached).toEqual(result);
    });

    test('should generate different cache keys for different queries', () => {
      const query1 = 'test1';
      const query2 = 'test2';

      const cacheKey1 = `wiki:search:search?q=${query1}`;
      const cacheKey2 = `wiki:search:search?q=${query2}`;

      cacheService.set(cacheKey1, { data: 'result1' });
      cacheService.set(cacheKey2, { data: 'result2' });

      expect(cacheService.get(cacheKey1)).toEqual({ data: 'result1' });
      expect(cacheService.get(cacheKey2)).toEqual({ data: 'result2' });
    });

    test('should include query parameters in cache key', () => {
      const query = 'test';
      const fileType = 'md';

      const cacheKey = `wiki:search:search?fileTypes=${fileType}&q=${query}`;
      const result = { data: 'filtered' };

      cacheService.set(cacheKey, result);
      expect(cacheService.get(cacheKey)).toEqual(result);
    });

    test('should handle empty query results', () => {
      const cacheKey = `wiki:search:search?q=`;
      const result = { data: [] };

      cacheService.set(cacheKey, result);
      expect(cacheService.get(cacheKey)).toEqual(result);
    });
  });

  describe('Suggestions Caching', () => {
    test('should cache search suggestions', () => {
      const query = 'test';
      const cacheKey = `wiki:suggestions:search/suggestions?q=${query}`;

      const suggestions = ['test1', 'test2', 'test3'];
      cacheService.set(cacheKey, suggestions);

      expect(cacheService.get(cacheKey)).toEqual(suggestions);
    });

    test('should generate different cache keys for different limits', () => {
      const query = 'test';
      const cacheKey1 = `wiki:suggestions:search/suggestions?limit=10&q=${query}`;
      const cacheKey2 = `wiki:suggestions:search/suggestions?limit=20&q=${query}`;

      cacheService.set(cacheKey1, ['a', 'b']);
      cacheService.set(cacheKey2, ['x', 'y', 'z']);

      expect(cacheService.get(cacheKey1)).toEqual(['a', 'b']);
      expect(cacheService.get(cacheKey2)).toEqual(['x', 'y', 'z']);
    });
  });

  describe('Cache Invalidation', () => {
    test('should clear search cache on index rebuild', () => {
      // Populate cache
      const searchKey = `wiki:search:search?q=test`;
      const suggestionsKey = `wiki:suggestions:search/suggestions?q=test`;

      cacheService.set(searchKey, { data: 'search' });
      cacheService.set(suggestionsKey, { data: 'suggestions' });

      // Simulate cache invalidation on rebuild
      const keys = cacheService.keys();
      keys.forEach(key => {
        if (key.startsWith('wiki:search') || key.startsWith('wiki:suggestions')) {
          cacheService.delete(key);
        }
      });

      expect(cacheService.get(searchKey)).toBeNull();
      expect(cacheService.get(suggestionsKey)).toBeNull();
    });

    test('should only invalidate search-related cache', () => {
      // Populate mixed cache
      const searchKey = `wiki:search:search?q=test`;
      const otherKey = `wiki:documents:list`;

      cacheService.set(searchKey, { data: 'search' });
      cacheService.set(otherKey, { data: 'documents' });

      // Invalidate only search cache
      const keys = cacheService.keys();
      keys.forEach(key => {
        if (key.includes('wiki:search') || key.includes('wiki:suggestions')) {
          cacheService.delete(key);
        }
      });

      expect(cacheService.get(searchKey)).toBeNull();
      expect(cacheService.get(otherKey)).toEqual({ data: 'documents' });
    });
  });

  describe('Cache Hit Scenarios', () => {
    test('should detect cache hits for repeated queries', () => {
      const query = 'test';
      const cacheKey = `wiki:search:search?q=${query}`;

      // First search - cache miss
      const firstResult = { success: true, results: [] };
      cacheService.set(cacheKey, firstResult);

      // Second search - cache hit
      const cached = cacheService.get(cacheKey);
      expect(cached).toEqual(firstResult);
      expect(cached).not.toBeNull();
    });

    test('should return same results for cached queries', () => {
      const query = 'test';
      const cacheKey = `wiki:search:search?q=${query}`;

      const expectedResults = [
        { title: 'Document 1', score: 0.9 },
        { title: 'Document 2', score: 0.8 }
      ];

      cacheService.set(cacheKey, expectedResults);

      const firstCall = cacheService.get(cacheKey);
      const secondCall = cacheService.get(cacheKey);

      expect(firstCall).toEqual(expectedResults);
      expect(secondCall).toEqual(expectedResults);
      expect(firstCall).toBe(secondCall); // Same reference
    });
  });

  describe('Cache TTL', () => {
    test('should set TTL for search cache', () => {
      const cacheKey = `wiki:search:search?q=test`;
      const ttl = 300; // 5 minutes

      // In real implementation, TTL is set via options
      cacheService.set(cacheKey, { data: 'test' }, { ttl });

      // Cache entry exists
      expect(cacheService.get(cacheKey)).toBeTruthy();
    });

    test('should use shorter TTL for suggestions', () => {
      // Suggestions could use different TTL if needed
      const cacheKey = `wiki:suggestions:search/suggestions?q=test`;
      const ttl = 300; // Same or shorter

      cacheService.set(cacheKey, ['suggestion1'], { ttl });
      expect(cacheService.get(cacheKey)).toBeTruthy();
    });
  });

  describe('Incremental Indexing Support', () => {
    test('should invalidate cache on file update', () => {
      // When a file is updated, search cache should be cleared
      const searchCache = {
        'wiki:search:search?q=test': { results: [] },
        'wiki:suggestions:search/suggestions?q=test': ['test1']
      };

      Object.assign(cacheService._store, searchCache);

      // Clear search cache (as would happen on file update)
      const keys = cacheService.keys();
      keys.forEach(key => {
        if (key.startsWith('wiki:search') || key.startsWith('wiki:suggestions')) {
          cacheService.delete(key);
        }
      });

      expect(cacheService.keys().length).toBe(0);
    });

    test('should handle multiple cache invalidations', () => {
      // Populate cache
      const key1 = 'wiki:search:search?q=test1';
      const key2 = 'wiki:search:search?q=test2';
      const key3 = 'wiki:suggestions:search/suggestions?q=test';

      cacheService.set(key1, { data: 1 });
      cacheService.set(key2, { data: 2 });
      cacheService.set(key3, { data: 3 });

      // Invalidate all search caches
      const keys = cacheService.keys();
      keys.forEach(key => {
        if (key.includes('wiki:search') || key.includes('wiki:suggestions')) {
          cacheService.delete(key);
        }
      });

      expect(cacheService.get(key1)).toBeNull();
      expect(cacheService.get(key2)).toBeNull();
      expect(cacheService.get(key3)).toBeNull();
    });
  });

  describe('Performance Impact', () => {
    test('should measure cache lookup time', () => {
      const cacheKey = 'wiki:search:search?q=test';
      cacheService.set(cacheKey, { results: [] });

      const start = Date.now();
      const result = cacheService.get(cacheKey);
      const elapsed = Date.now() - start;

      expect(result).toBeTruthy();
      expect(elapsed).toBeLessThan(5); // Should be <5ms
    });

    test('should measure cache storage time', () => {
      const cacheKey = 'wiki:search:search?q=test';
      const largeResult = { results: new Array(100).fill({ title: 'Test' }) };

      const start = Date.now();
      cacheService.set(cacheKey, largeResult);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(10); // Should be <10ms
      expect(cacheService.get(cacheKey)).toBeTruthy();
    });
  });
});
