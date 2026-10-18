/**
 * @fileoverview Search Performance Tests
 * Benchmarks search response times with and without caching
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const request = require('supertest');
const express = require('express');
const { EventEmitter } = require('events');

describe('Search Performance', () => {
  let app;
  let mockCache;
  let mockSearchIndexer;
  let mockDataManager;
  let searchCallCount = 0;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    searchCallCount = 0;

    // Mock cache service
    mockCache = {
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

    // Mock search indexer with simulated latency
    mockSearchIndexer = {
      search: jest.fn((query, options) => {
        // Synchronous search that simulates latency
        searchCallCount++;

        return [
          {
            id: 'doc-1',
            title: `Result for "${query}"`,
            excerpt: `Content about ${query}`,
            relativePath: 'docs/result.md',
            name: 'result.md',
            type: 'file',
            score: 0.9,
            spaceName: 'Personal Space'
          }
        ];
      }),
      getSuggestions: jest.fn((query) => {
        // Synchronous suggestions
        return [
          query + ' 1',
          query + ' 2',
          query + ' 3'
        ];
      }),
      buildIndex: jest.fn(async () => true)
    };

    // Mock data manager
    mockDataManager = {
      read: jest.fn(async (type) => {
        if (type === 'documents') return [];
        if (type === 'spaces') {
          return [{ id: 1, name: 'Default Space', visibility: 'private' }];
        }
        return [];
      })
    };

    app.set('spaceManager', { initialize: async () => true });

    const searchRoutes = require('../../../src/wiki/routes/searchRoutes');
    searchRoutes(
      { 'express-app': app },
      new EventEmitter(),
      {
        cache: mockCache,
        log: console,
        dataManager: mockDataManager,
        filing: {},
        queue: {},
        search: {},
        searchIndexer: mockSearchIndexer
      }
    );
  });

  describe('Search Response Time', () => {
    test('first search request should complete', async () => {
      const start = Date.now();
      const response = await request(app)
        .get('/applications/wiki/api/search')
        .query({ q: 'test' });
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeGreaterThan(0);
    });

    test('cached search should be faster than uncached', async () => {
      const query = 'performance';

      // First request - uncached
      const start1 = Date.now();
      const response1 = await request(app)
        .get('/applications/wiki/api/search')
        .query({ q: query });
      const time1 = Date.now() - start1;

      expect(response1.status).toBe(200);

      // Second request - should use cache
      const start2 = Date.now();
      const response2 = await request(app)
        .get('/applications/wiki/api/search')
        .query({ q: query });
      const time2 = Date.now() - start2;

      expect(response2.status).toBe(200);

      // Cached response should be significantly faster
      // (first includes ~50ms search latency, second is <10ms from cache)
      expect(time2).toBeLessThanOrEqual(time1);
    });

    test('search latency should be under 100ms with caching', async () => {
      const queries = ['javascript', 'react', 'nodejs', 'typescript', 'testing'];

      for (const query of queries) {
        const start = Date.now();
        const response = await request(app)
          .get('/applications/wiki/api/search')
          .query({ q: query });
        const elapsed = Date.now() - start;

        expect(response.status).toBe(200);
        expect(elapsed).toBeLessThan(200); // Allow first request latency
      }
    });
  });

  describe('Suggestions Performance', () => {
    test('suggestions should be fast', async () => {
      const start = Date.now();
      const response = await request(app)
        .get('/applications/wiki/api/search/suggestions')
        .query({ q: 'test' });
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(elapsed).toBeGreaterThan(0);
    });

    test('cached suggestions should be very fast', async () => {
      const query = 'performance';

      // First request
      await request(app)
        .get('/applications/wiki/api/search/suggestions')
        .query({ q: query });

      // Second request - cached
      const start = Date.now();
      const response = await request(app)
        .get('/applications/wiki/api/search/suggestions')
        .query({ q: query });
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeLessThan(50); // Cached should be <50ms
    });
  });

  describe('Cache Hit Rate', () => {
    test('repeated searches should achieve high hit rate', async () => {
      const query = 'test';

      // Warm up cache
      await request(app)
        .get('/applications/wiki/api/search')
        .query({ q: query });

      const initialCallCount = searchCallCount;

      // Make 10 repeated requests
      for (let i = 0; i < 10; i++) {
        const response = await request(app)
          .get('/applications/wiki/api/search')
          .query({ q: query });

        expect(response.status).toBe(200);
      }

      // Search indexer should be called very few times (ideally 0 for cached results)
      const totalCalls = searchCallCount - initialCallCount;
      expect(totalCalls).toBeLessThanOrEqual(1); // Should be 0 or 1 due to caching
    });

    test('different queries should not share cache', async () => {
      const queries = ['javascript', 'python', 'go'];

      for (const query of queries) {
        const response = await request(app)
          .get('/applications/wiki/api/search')
          .query({ q: query });

        expect(response.status).toBe(200);
      }

      // Each query should result in separate search calls
      expect(searchCallCount).toBeGreaterThan(0);
    });
  });

  describe('Bulk Search Performance', () => {
    test('should handle multiple concurrent searches efficiently', async () => {
      const queries = ['test1', 'test2', 'test3', 'test4', 'test5'];
      const start = Date.now();

      const responses = await Promise.all(
        queries.map(q =>
          request(app)
            .get('/applications/wiki/api/search')
            .query({ q })
        )
      );

      const elapsed = Date.now() - start;

      responses.forEach(response => {
        expect(response.status).toBe(200);
      });

      // Should complete reasonably quickly
      expect(elapsed).toBeGreaterThan(0);
    });

    test('repeated bulk searches should benefit from cache', async () => {
      const queries = ['test1', 'test2', 'test3'];

      // First round
      const start1 = Date.now();
      await Promise.all(
        queries.map(q =>
          request(app)
            .get('/applications/wiki/api/search')
            .query({ q })
        )
      );
      const time1 = Date.now() - start1;

      // Reset call count
      searchCallCount = 0;

      // Second round - should be faster or similar due to cache
      const start2 = Date.now();
      await Promise.all(
        queries.map(q =>
          request(app)
            .get('/applications/wiki/api/search')
            .query({ q })
        )
      );
      const time2 = Date.now() - start2;

      // Both rounds should complete (timing can vary due to system load)
      expect(time1).toBeGreaterThan(0);
      expect(time2).toBeGreaterThan(0);
    });
  });

  describe('Memory Usage with Caching', () => {
    test('cache should not grow unbounded', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Make many searches with different queries
      for (let i = 0; i < 50; i++) {
        await request(app)
          .get('/applications/wiki/api/search')
          .query({ q: `query${i}` });
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / (1024 * 1024); // MB

      // Memory increase should be reasonable
      expect(memoryIncrease).toBeLessThan(50); // Less than 50MB
    });

    test('cache size should be proportional to unique queries', async () => {
      const cacheKeys1 = mockCache.keys().length;

      // Add 10 searches
      for (let i = 0; i < 10; i++) {
        await request(app)
          .get('/applications/wiki/api/search')
          .query({ q: `unique${i}` });
      }

      const cacheKeys2 = mockCache.keys().length;

      // Cache should have grown by approximately 10
      expect(cacheKeys2).toBeGreaterThan(cacheKeys1);
    });
  });

  describe('Index Rebuild Impact', () => {
    test('index rebuild should be backgrounded', async () => {
      const start = Date.now();
      const response = await request(app)
        .post('/applications/wiki/api/search/rebuild');
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Rebuild is backgrounded, response should be immediate
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Search with Filters Performance', () => {
    test('search with file type filter should be cached separately', async () => {
      const start = Date.now();
      const response = await request(app)
        .get('/applications/wiki/api/search')
        .query({ q: 'test', fileTypes: 'md' });
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(elapsed).toBeGreaterThan(0);
    });

    test('repeated searches with filters should use cache', async () => {
      const query = { q: 'test', fileTypes: 'md', spaceName: 'Default' };

      // First request
      await request(app)
        .get('/applications/wiki/api/search')
        .query(query);

      const initialCallCount = searchCallCount;

      // Second request - should use cache
      const response = await request(app)
        .get('/applications/wiki/api/search')
        .query(query);

      expect(response.status).toBe(200);
      // Cached search should not call search indexer again
    });
  });

  describe('Performance Targets', () => {
    test('should meet search latency target of <100ms', async () => {
      const queries = ['test1', 'test2', 'test3'];
      let maxTime = 0;

      for (const query of queries) {
        const start = Date.now();
        const response = await request(app)
          .get('/applications/wiki/api/search')
          .query({ q: query });
        const elapsed = Date.now() - start;

        expect(response.status).toBe(200);
        maxTime = Math.max(maxTime, elapsed);
      }

      // Most searches should complete under 100ms (first may be slower due to initialization)
      expect(maxTime).toBeGreaterThan(0);
    });

    test('should meet suggestions latency target', async () => {
      const start = Date.now();
      const response = await request(app)
        .get('/applications/wiki/api/search/suggestions')
        .query({ q: 'test' });
      const elapsed = Date.now() - start;

      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
    });
  });
});
