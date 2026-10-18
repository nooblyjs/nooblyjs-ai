// Phase F26: the route table on Express. The same handlers the node:http router serves, with
// the host's middleware in front and NooblyJS's error shape behind.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { toExpressRouter } from '../../src/services/to-express.js';

async function serve(routes, options = {}) {
  const app = express();
  app.use(express.json());
  app.use('/x/api/v1', toExpressRouter(routes, { express, ...options }));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}/x/api/v1`;
  return {
    call: async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: body && { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
      return [res.status, await res.json()];
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('a row becomes a route: params, query, body and principal reach the handler, its json comes back', async () => {
  const seen = [];
  const t = await serve([
    ['GET', '/api/runs/:id', ({ params, query }) => ({ json: { id: params.id, limit: query.limit } })],
    ['POST', '/api/runs/:id/:action', (ctx) => (seen.push([ctx.params, ctx.body, ctx.principal]), { status: 201, json: { ok: true } })],
  ], { principal: () => ({ role: 'operator', by: 'Lerato M. (NooblyJS)' }) });
  try {
    assert.deepEqual(await t.call('GET', '/runs/run%201?limit=5'), [200, { id: 'run 1', limit: '5' }]);
    assert.deepEqual(await t.call('POST', '/runs/r1/retry', { from: 'build' }), [201, { ok: true }]);
    assert.deepEqual(JSON.parse(JSON.stringify(seen)), [[{ id: 'r1', action: 'retry' }, { from: 'build' }, { role: 'operator', by: 'Lerato M. (NooblyJS)' }]]);
  } finally {
    await t.close();
  }
});

test('a thrown error is NooblyJS\'s error shape: its status, or 400; an unknown route is a 404', async () => {
  const t = await serve([
    ['GET', '/api/missing', () => { throw Object.assign(new Error('No run "x".'), { status: 404 }); }],
    ['GET', '/api/bad', () => { throw new Error('decision must be approved.'); }],
    ['GET', '/api/busy', async () => { throw Object.assign(new Error('Already answered.'), { status: 409 }); }],
  ]);
  try {
    assert.deepEqual(await t.call('GET', '/missing'), [404, { error: { code: 'not_found', message: 'No run "x".' } }]);
    assert.deepEqual(await t.call('GET', '/bad'), [400, { error: { code: 'bad_request', message: 'decision must be approved.' } }]);
    assert.deepEqual(await t.call('GET', '/busy'), [409, { error: { code: 'conflict', message: 'Already answered.' } }]);
    assert.deepEqual(await t.call('GET', '/nope'), [404, { error: { code: 'not_found', message: 'No route GET /x/api/v1/nope' } }]);
  } finally {
    await t.close();
  }
});

test('`before` puts the host\'s middleware in front of one route, and can refuse it', async () => {
  const refuse = (req, res) => res.status(403).json({ error: { code: 'forbidden', message: 'no' } });
  const t = await serve([
    ['GET', '/api/open', () => ({ json: { open: true } })],
    ['POST', '/api/stop-all', () => ({ json: { stopped: true } })],
  ], { before: (method) => (method === 'POST' ? [refuse] : []) });
  try {
    assert.deepEqual(await t.call('GET', '/open'), [200, { open: true }]);
    assert.deepEqual(await t.call('POST', '/stop-all'), [403, { error: { code: 'forbidden', message: 'no' } }]);
  } finally {
    await t.close();
  }
});

test('a pattern outside the prefix is a mistake, caught when the router is built', () => {
  assert.throws(() => toExpressRouter([['POST', '/worker/lease', () => ({})]], { express }), /not under \/api\//);
});
