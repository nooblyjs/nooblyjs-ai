/**
 * @fileoverview Cache Middleware Tests
 * Tests for generic caching decorator and cache invalidation patterns
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const { withCache, invalidateCache } = require('../../../src/shared/middleware/cacheMiddleware');

describe('Cache Middleware', () => {
  let cacheService;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    // Mock cache service
    cacheService = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      keys: jest.fn(() => [])
    };

    // Mock request
    mockReq = {
      path: '/api/workflows/list',
      query: {},
      app: {
        get: jest.fn()
      }
    };

    // Mock response
    mockRes = {
      statusCode: 200,
      set: jest.fn(),
      json: jest.fn(function(data) {
        this.statusCode = 200;
        return data;
      }),
      on: jest.fn()
    };
  });

  describe('withCache - Cache Hit Scenarios', () => {
    test('should return cached value on cache hit', async () => {
      const cachedData = { success: true, data: [] };
      cacheService.get.mockReturnValue(cachedData);

      const handler = jest.fn();
      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      await cachedHandler(mockReq, mockRes);

      // Should return cached data without calling handler
      expect(mockRes.json).toHaveBeenCalledWith(cachedData);
      expect(mockRes.set).toHaveBeenCalledWith('X-Cache', 'HIT');
      expect(handler).not.toHaveBeenCalled();
    });

    test('should set cache hit header correctly', async () => {
      const cachedData = { success: true, data: [] };
      cacheService.get.mockReturnValue(cachedData);

      const handler = jest.fn();
      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      await cachedHandler(mockReq, mockRes);

      expect(mockRes.set).toHaveBeenCalledWith('X-Cache', 'HIT');
    });
  });

  describe('withCache - Cache Miss Scenarios', () => {
    test('should call handler on cache miss', async () => {
      cacheService.get.mockReturnValue(null);

      const handler = jest.fn((req, res) => {
        res.json({ success: true, data: ['item1'] });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      await cachedHandler(mockReq, mockRes);

      expect(handler).toHaveBeenCalled();
      expect(handler.mock.calls[0][0]).toEqual(mockReq);
    });

    test('should set cache miss header on miss', async () => {
      cacheService.get.mockReturnValue(null);

      const handler = jest.fn((req, res) => {
        res.json({ success: true, data: ['item1'] });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      await cachedHandler(mockReq, mockRes);

      expect(mockRes.set).toHaveBeenCalledWith('X-Cache', 'MISS');
    });

    test('should cache response on successful handler execution', async () => {
      cacheService.get.mockReturnValue(null);

      const responseData = { success: true, data: ['item1'] };
      const handler = jest.fn((req, res) => {
        res.json(responseData);
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'workflows',
        ttl: 300
      });

      await cachedHandler(mockReq, mockRes);

      // Verify cache.set was called with correct TTL
      expect(cacheService.set).toHaveBeenCalled();
      const setCall = cacheService.set.mock.calls[0];
      expect(setCall[1]).toEqual(responseData);
      expect(setCall[2].ttl).toBe(300);
    });
  });

  describe('withCache - Cache Expiration', () => {
    test('should respect TTL option', async () => {
      cacheService.get.mockReturnValue(null);

      const handler = jest.fn((req, res) => {
        res.json({ success: true, data: ['item1'] });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 600
      });

      await cachedHandler(mockReq, mockRes);

      const setCall = cacheService.set.mock.calls[0];
      expect(setCall[2].ttl).toBe(600);
    });
  });

  describe('withCache - Multiple Cache Keys', () => {
    test('should generate different keys for different query params', async () => {
      cacheService.get.mockReturnValue(null);

      const handler = jest.fn((req, res) => {
        res.json({ success: true, data: ['item1'] });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'workflows',
        ttl: 300
      });

      // First request with filter
      mockReq.query = { status: 'active' };
      await cachedHandler(mockReq, mockRes);

      const firstKey = cacheService.set.mock.calls[0][0];

      // Reset mocks
      cacheService.set.mockClear();
      cacheService.get.mockClear();

      // Second request with different filter
      mockReq.query = { status: 'inactive' };
      cacheService.get.mockReturnValue(null);
      await cachedHandler(mockReq, mockRes);

      const secondKey = cacheService.set.mock.calls[0][0];

      // Keys should be different
      expect(firstKey).not.toEqual(secondKey);
    });
  });

  describe('withCache - Concurrent Requests', () => {
    test('should handle multiple concurrent requests for same key', async () => {
      let cacheGetCallCount = 0;
      cacheService.get.mockImplementation(() => {
        cacheGetCallCount++;
        return null; // Cache miss for all requests
      });

      const handler = jest.fn((req, res) => {
        res.json({ success: true, data: ['item1'] });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      // Simulate 3 concurrent requests with same key
      mockReq.query = {};
      const promises = [
        cachedHandler(mockReq, mockRes),
        cachedHandler(mockReq, mockRes),
        cachedHandler(mockReq, mockRes)
      ];

      await Promise.all(promises);

      // All requests should call the handler
      expect(handler).toHaveBeenCalledTimes(3);
      // Note: In a real concurrent scenario with proper cache synchronization,
      // we might want to fetch once and return same result to all
    });
  });

  describe('withCache - Error Handling', () => {
    test('should handle cache errors gracefully', async () => {
      cacheService.get.mockImplementation(() => {
        throw new Error('Cache read error');
      });

      const handler = jest.fn((req, res) => {
        res.json({ success: true, data: ['item1'] });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      // Should not throw, should call handler
      await cachedHandler(mockReq, mockRes);
      expect(handler).toHaveBeenCalled();
    });

    test('should handle cache write errors gracefully', async () => {
      cacheService.get.mockReturnValue(null);
      cacheService.set.mockImplementation(() => {
        throw new Error('Cache write error');
      });

      const originalJson = mockRes.json;
      let jsonWasCalled = false;

      const handler = jest.fn((req, res) => {
        // Keep track of whether json was called
        const wrappedJson = res.json;
        res.json = function(data) {
          jsonWasCalled = true;
          return wrappedJson.call(this, data);
        };
        res.json({ success: true, data: ['item1'] });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      mockReq.app.get.mockReturnValue({ error: jest.fn() });

      // Should not throw, should return response
      await cachedHandler(mockReq, mockRes);
      expect(jsonWasCalled).toBe(true);
    });
  });

  describe('withCache - Only Cache Successful Responses', () => {
    test('should not cache error responses', async () => {
      cacheService.get.mockReturnValue(null);

      const handler = jest.fn((req, res) => {
        res.statusCode = 500;
        res.json({ success: false, error: 'Server error' });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      await cachedHandler(mockReq, mockRes);

      // Should not cache error response
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    test('should not cache unsuccessful responses', async () => {
      cacheService.get.mockReturnValue(null);

      const handler = jest.fn((req, res) => {
        res.json({ success: false, error: 'Bad request' });
      });

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      await cachedHandler(mockReq, mockRes);

      // Should not cache
      expect(cacheService.set).not.toHaveBeenCalled();
    });
  });

  describe('invalidateCache', () => {
    test('should delete cache entries matching pattern', async () => {
      const keys = ['workflows:dashboard', 'workflows:list', 'users:active'];
      cacheService.keys.mockReturnValue(keys);

      const middleware = invalidateCache(cacheService, 'workflows:');

      await middleware(mockReq, mockRes, jest.fn());

      // Should delete workflows:dashboard and workflows:list
      expect(cacheService.delete).toHaveBeenCalledTimes(2);
    });

    test('should handle multiple patterns', async () => {
      const keys = [
        'workflows:dashboard',
        'workflows:list',
        'executions:recent',
        'schedules:active'
      ];
      cacheService.keys.mockReturnValue(keys);

      const middleware = invalidateCache(cacheService, ['workflows:', 'executions:']);

      await middleware(mockReq, mockRes, jest.fn());

      // Should delete 3 keys matching the patterns
      expect(cacheService.delete).toHaveBeenCalledTimes(3);
    });

    test('should call next middleware', async () => {
      const next = jest.fn();
      const middleware = invalidateCache(cacheService, 'workflows:');

      await middleware(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
    });

    test('should handle errors gracefully', async () => {
      cacheService.keys.mockImplementation(() => {
        throw new Error('Cache read error');
      });

      mockReq.app.get.mockReturnValue({ error: jest.fn() });

      const next = jest.fn();
      const middleware = invalidateCache(cacheService, 'workflows:');

      // Should not throw
      await middleware(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('withCache - Cache Bypass Flag', () => {
    test('should skip cache when __nocache query param is set', async () => {
      cacheService.get.mockReturnValue({ cached: true });

      const handler = jest.fn((req, res) => {
        res.json({ success: true, data: [] });
      });

      mockReq.query = { __nocache: 'true' };

      const cachedHandler = withCache(cacheService, handler, {
        keyPrefix: 'test',
        ttl: 300
      });

      await cachedHandler(mockReq, mockRes);

      // Should call handler even though cache has value
      expect(handler).toHaveBeenCalled();
    });
  });
});
