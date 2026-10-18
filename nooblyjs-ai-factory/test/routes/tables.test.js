// The ROUTE TABLES: every documented endpoint is there, and each reaches a handler.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apiRoutes } from '../../src/routes/api.js';
import { workerApi } from '../../src/routes/workers.js';
import { openStore } from '../../src/models/store/events.js';
import { testEnv } from '../helpers.js';

const keys = (table) => table.map(([method, pattern]) => `${method} ${pattern}`);

test('the dashboard API: every endpoint, each with a handler, and extras added at the end', () => {
  const env = testEnv();
  const store = openStore({ env });
  try {
    const extra = () => ({ json: {} });
    const table = apiRoutes({ store, env, extra: [['GET', '/api/extra', extra]] });
    assert.deepEqual(keys(table), [
      'GET /api/status', 'GET /api/runs', 'GET /api/runs/:id', 'GET /api/runs/:id/artifacts/:sha', 'GET /api/metrics', 'GET /api/campaigns',
      'GET /api/inbox', 'POST /api/inbox/:id', 'POST /api/runs/:id/:action', 'POST /api/stop-all', 'POST /api/resume-all', 'GET /api/events', 'GET /api/extra',
    ]);
    for (const [, pattern, handler] of table) assert.equal(typeof handler, 'function', pattern);
    assert.equal(table.at(-1)[2], extra);
    assert.equal(new Set(keys(table)).size, table.length, 'no endpoint twice');
  } finally {
    store.close();
  }
});

test('the worker API: six POST routes and an authorize function; no enrollment token, no API', () => {
  const store = openStore({ env: testEnv() });
  try {
    const api = workerApi({ store, dispatcher: /** @type {any} */ ({}), enrollToken: 'join' });
    assert.deepEqual(keys(api.routes), ['POST /worker/register', 'POST /worker/lease', 'POST /worker/heartbeat', 'POST /worker/events', 'POST /worker/complete', 'POST /worker/fail']);
    assert.deepEqual(api.authorize('join'), { role: 'enroll' });
    assert.throws(() => workerApi({ store, dispatcher: /** @type {any} */ ({}), enrollToken: '' }), /enrollment token/);
  } finally {
    store.close();
  }
});
