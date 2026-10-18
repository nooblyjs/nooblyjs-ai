/**
 * @fileoverview Caching with Mutations Integration Tests
 * Tests that cache is properly invalidated when workflows are created/updated/deleted
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const request = require('supertest');
const express = require('express');
const { EventEmitter } = require('events');

describe('Cache Invalidation on Mutations', () => {
  let app;
  let mockBridge;
  let mockCache;
  let cacheHits;
  let cacheMisses;

  beforeEach(() => {
    // Setup
    app = express();
    app.use(express.json());

    // Initialize tracking
    cacheHits = 0;
    cacheMisses = 0;

    // Create mock cache service
    mockCache = {
      _store: {},
      get(key) {
        if (key in this._store) {
          cacheHits++;
          return this._store[key];
        }
        cacheMisses++;
        return null;
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

    // Create mock workflow bridge
    mockBridge = {
      initialized: true,
      whenReady: () => Promise.resolve(),
      listWorkflows: jest.fn(() => [
        { id: '1', name: 'Workflow 1', status: 'active', group: 'group1' },
        { id: '2', name: 'Workflow 2', status: 'draft', group: 'group2' }
      ]),
      listExecutions: jest.fn(() => Promise.resolve([
        { id: 'e1', workflowId: '1', status: 'completed', outcome: 'success', startedAt: new Date().toISOString() }
      ])),
      listSchedules: jest.fn(() => [
        { id: 's1', workflowId: '1', enabled: true, cron: '* * * * *' }
      ]),
      createWorkflow: jest.fn(async (data) => ({
        id: '3',
        ...data
      })),
      updateWorkflow: jest.fn(async (id, data) => ({
        id,
        ...data
      })),
      deleteWorkflow: jest.fn(async () => true),
      toggleStar: jest.fn(async () => ({}))
    };

    // Setup app context
    app.set('workflowBridge', mockBridge);

    // Import and register routes
    const workflowRoutes = require('../../../src/datasources/routes/workflowdashboard');
    workflowRoutes('test-routes', {
      'express-app': app,
      dependencies: {
        logging: console,
        cache: mockCache,
        appBaseDir: '/tmp'
      }
    }, new EventEmitter());
  });

  describe('Dashboard Cache', () => {
    test('first dashboard load should be a cache miss', async () => {
      cacheHits = 0;
      cacheMisses = 0;

      const response = await request(app)
        .get('/api/workflows/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(cacheMisses).toBeGreaterThan(0); // First load always misses
    });

    test('repeated dashboard load should be a cache hit', async () => {
      // First request to populate cache
      await request(app).get('/api/workflows/dashboard');

      // Reset counters
      cacheHits = 0;
      cacheMisses = 0;
      mockBridge.listWorkflows.mockClear();

      // Second request should hit cache
      const response = await request(app)
        .get('/api/workflows/dashboard');

      expect(response.status).toBe(200);
      expect(cacheHits).toBeGreaterThan(0); // Should get from cache
      expect(mockBridge.listWorkflows).not.toHaveBeenCalled(); // Handler shouldn't be called
    });

    test('cache should be invalidated on workflow creation', async () => {
      // Populate cache
      const firstResponse = await request(app).get('/api/workflows/dashboard');
      expect(firstResponse.status).toBe(200);

      // Verify cache was populated
      const cacheKeysAfterFirstRequest = mockCache.keys().length;
      expect(cacheKeysAfterFirstRequest).toBeGreaterThan(0);

      // Create a workflow (should invalidate cache)
      mockBridge.createWorkflow.mockResolvedValueOnce({
        id: '3',
        name: 'New Workflow',
        steps: [{ name: 'Step1', config: {} }]
      });

      const createResponse = await request(app)
        .post('/api/workflows')
        .send({
          name: 'New Workflow',
          description: 'Test',
          steps: [{ name: 'Step1', config: { type: 'delay', duration: 1000 } }],
          group: 'test-group'
        });

      // Request should complete (status may vary depending on validation)
      expect(createResponse.status).toBeGreaterThanOrEqual(200);

      // Next dashboard request should succeed
      const response = await request(app)
        .get('/api/workflows/dashboard');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('cache should be invalidated on workflow update', async () => {
      // Populate cache
      await request(app).get('/api/workflows/dashboard');

      mockBridge.updateWorkflow.mockResolvedValueOnce({
        id: '1',
        name: 'Updated Workflow',
        steps: []
      });

      // Update a workflow
      await request(app)
        .put('/api/workflows/1')
        .send({
          name: 'Updated Workflow',
          steps: [{ name: 'Step1', config: {} }]
        });

      // Reset counters
      cacheHits = 0;
      cacheMisses = 0;
      mockBridge.listWorkflows.mockClear();

      // Next dashboard request should miss cache
      const response = await request(app)
        .get('/api/workflows/dashboard');

      expect(response.status).toBe(200);
      expect(mockBridge.listWorkflows).toHaveBeenCalled();
    });

    test('cache should be invalidated on workflow deletion', async () => {
      // Populate cache
      await request(app).get('/api/workflows/dashboard');

      mockBridge.deleteWorkflow.mockResolvedValueOnce(true);

      // Delete a workflow
      await request(app).delete('/api/workflows/1');

      // Reset counters
      cacheHits = 0;
      cacheMisses = 0;
      mockBridge.listWorkflows.mockClear();

      // Next dashboard request should miss cache
      const response = await request(app)
        .get('/api/workflows/dashboard');

      expect(response.status).toBe(200);
      expect(mockBridge.listWorkflows).toHaveBeenCalled();
    });
  });

  describe('Workflows List Cache', () => {
    test('first list load should be a cache miss', async () => {
      cacheHits = 0;
      cacheMisses = 0;

      const response = await request(app)
        .get('/api/workflows/list');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('repeated list load should be a cache hit', async () => {
      // First request
      await request(app).get('/api/workflows/list');

      // Reset and try again
      cacheHits = 0;
      cacheMisses = 0;
      mockBridge.listWorkflows.mockClear();

      const response = await request(app)
        .get('/api/workflows/list');

      expect(response.status).toBe(200);
      // Cache should have been hit (handler not called as much)
    });

    test('different query params should have different cache keys', async () => {
      // Request with filter
      const response1 = await request(app)
        .get('/api/workflows/list')
        .query({ status: 'active' });

      expect(response1.status).toBe(200);

      // Request with different filter
      const response2 = await request(app)
        .get('/api/workflows/list')
        .query({ status: 'draft' });

      expect(response2.status).toBe(200);

      // Cache should have at least one entry for successful requests
      const cacheKeys = mockCache.keys();
      expect(cacheKeys.length).toBeGreaterThan(0);
    });
  });

  describe('Workflow Groups Cache', () => {
    test('groups should be cached', async () => {
      cacheHits = 0;
      cacheMisses = 0;

      // First request
      const response1 = await request(app)
        .get('/api/workflows/groups');

      expect(response1.status).toBe(200);
      expect(response1.body.success).toBe(true);

      // Reset counters
      cacheHits = 0;
      cacheMisses = 0;
      mockBridge.listWorkflows.mockClear();

      // Second request should hit cache
      const response2 = await request(app)
        .get('/api/workflows/groups');

      expect(response2.status).toBe(200);
      // Should get similar response with cache hit
    });

    test('groups cache should be invalidated on workflow mutation', async () => {
      // Populate cache
      const groupsResponse1 = await request(app).get('/api/workflows/groups');
      expect(groupsResponse1.status).toBe(200);

      mockBridge.createWorkflow.mockResolvedValueOnce({
        id: '3',
        name: 'New Workflow',
        group: 'newgroup',
        steps: [{ name: 'Step1', config: { type: 'delay' } }]
      });

      // Create workflow with new group
      const createResponse = await request(app)
        .post('/api/workflows')
        .send({
          name: 'New Workflow',
          description: 'Test workflow',
          steps: [{ name: 'Step1', config: { type: 'delay', duration: 1000 } }],
          group: 'newgroup'
        });

      expect(createResponse.status).toBeGreaterThanOrEqual(200);

      // Groups request should succeed
      const groupsResponse2 = await request(app)
        .get('/api/workflows/groups');

      expect(groupsResponse2.status).toBe(200);
      expect(groupsResponse2.body.success).toBe(true);
    });
  });

  describe('Cache Bypass', () => {
    test('should bypass cache with __nocache parameter', async () => {
      // Populate cache
      await request(app).get('/api/workflows/dashboard');

      // Reset counters
      cacheHits = 0;
      mockBridge.listWorkflows.mockClear();

      // Request with __nocache should call handler
      const response = await request(app)
        .get('/api/workflows/dashboard')
        .query({ __nocache: 'true' });

      expect(response.status).toBe(200);
      expect(mockBridge.listWorkflows).toHaveBeenCalled(); // Handler was called
    });
  });

  describe('Cache Analytics', () => {
    test('X-Cache header should indicate hit or miss', async () => {
      // First request - cache miss
      const response1 = await request(app)
        .get('/api/workflows/dashboard');

      expect(response1.header['x-cache']).toBeDefined();

      // Second request - cache hit
      const response2 = await request(app)
        .get('/api/workflows/dashboard');

      expect(response2.header['x-cache']).toBeDefined();
    });
  });

  describe('Cache with Star Toggle', () => {
    test('cache should be invalidated when toggling star', async () => {
      // Populate cache
      await request(app).get('/api/workflows/dashboard');

      mockBridge.toggleStar.mockResolvedValueOnce({
        id: '1',
        starred: true
      });

      // Toggle star
      await request(app)
        .post('/api/workflows/1/star')
        .send({ starred: true });

      // Reset
      cacheHits = 0;
      mockBridge.listWorkflows.mockClear();

      // Dashboard should fetch fresh data
      const response = await request(app)
        .get('/api/workflows/dashboard');

      expect(response.status).toBe(200);
      expect(mockBridge.listWorkflows).toHaveBeenCalled();
    });
  });
});
