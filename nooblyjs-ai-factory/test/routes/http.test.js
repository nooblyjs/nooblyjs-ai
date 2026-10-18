// Phase F17: the HTTP router: matching, tokens, bodies, static files and errors, over a real socket.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { compile, createHttpServer } from '../../src/routes/http.js';
import { tmpDir } from '../helpers.js';

test('compile: named params, decoded; anything else does not match', () => {
  const match = compile('/api/runs/:id/artifacts/:sha');
  assert.deepEqual(match('/api/runs/run-1/artifacts/ab%20c'), { id: 'run-1', sha: 'ab c' });
  assert.equal(match('/api/runs/run-1'), null);
  assert.equal(match('/api/runs/run-1/artifacts/ab/extra'), null);
  assert.deepEqual(compile('/api/status')('/api/status'), {});
});

test('a server needs a token or an authorize function', () => {
  assert.throws(() => createHttpServer({ routes: [] }), /needs a token/);
});

async function serve(options) {
  const server = createHttpServer(options);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
  const call = async (method, p, { token, body, raw } = {}) => {
    const res = await fetch(base + p, { method, headers: { ...(token && { authorization: `Bearer ${token}` }) }, body: raw ?? (body && JSON.stringify(body)) });
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type'), body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  };
  return { call, close: () => new Promise((resolve) => server.close(resolve)) };
}

const routes = [
  ['GET', '/api/echo/:word', ({ params, query, principal }) => ({ json: { word: params.word, query, role: principal.role } })],
  ['POST', '/api/echo', ({ body }) => ({ status: 201, json: { got: body } })],
  ['GET', '/api/missing', () => { throw Object.assign(new Error('not here'), { status: 404 }); }],
  ['GET', '/api/broken', () => { throw new Error('bad input'); }],
];

test('routes: params, query, the principal, status codes and JSON bodies', async () => {
  const s = await serve({ routes, token: 'tok' });
  try {
    assert.deepEqual((await s.call('GET', '/api/echo/hi?x=1', { token: 'tok' })).body, { word: 'hi', query: { x: '1' }, role: 'operator' });
    assert.deepEqual(await s.call('POST', '/api/echo', { token: 'tok', body: { a: 1 } }), { status: 201, type: 'application/json; charset=utf-8', body: { got: { a: 1 } } });
    assert.deepEqual((await s.call('GET', '/api/nope', { token: 'tok' })).body, { error: 'No route GET /api/nope' });
    assert.equal((await s.call('DELETE', '/api/echo', { token: 'tok' })).status, 404, 'the method must match too');
  } finally {
    await s.close();
  }
});

test('errors: a status the handler chose, else 400; bad JSON and big bodies are refused', async () => {
  const s = await serve({ routes, token: 'tok' });
  try {
    assert.deepEqual(await s.call('GET', '/api/missing', { token: 'tok' }).then((r) => [r.status, r.body.error]), [404, 'not here']);
    assert.deepEqual(await s.call('GET', '/api/broken', { token: 'tok' }).then((r) => [r.status, r.body.error]), [400, 'bad input']);
    assert.equal((await s.call('POST', '/api/echo', { token: 'tok', raw: 'nope' })).status, 400);
    const big = await s.call('POST', '/api/echo', { token: 'tok', raw: JSON.stringify('x'.repeat(200_000)) }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
  } finally {
    await s.close();
  }
});

test('tokens: none or wrong → 401; a custom authorize decides who the caller is', async () => {
  const s = await serve({ routes, authorize: (given) => (given === 'w' ? { role: 'worker' } : null) });
  try {
    assert.equal((await s.call('GET', '/api/echo/hi')).status, 401);
    assert.equal((await s.call('GET', '/api/echo/hi', { token: 'tok' })).status, 401);
    assert.equal((await s.call('GET', '/api/echo/hi', { token: 'w' })).body.role, 'worker');
    assert.equal((await s.call('GET', '/worker/anything')).status, 401, '/worker/ routes need a token too');
  } finally {
    await s.close();
  }
});

test('everything outside /api/ and /worker/ is a static file, with no token', async () => {
  const dir = tmpDir('factory-site-');
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>factory</h1>');
  const s = await serve({ routes, token: 'tok', staticDir: dir });
  try {
    assert.deepEqual(await s.call('GET', '/').then((r) => [r.status, r.body]), [200, '<h1>factory</h1>']);
    assert.equal((await s.call('GET', '/nope.js')).status, 404);
  } finally {
    await s.close();
  }
});
