// Phase F17: the dashboard's bearer token: where a request may carry it, and comparing it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { singleToken, tokenFrom, tokenOk } from '../../src/middleware/auth.js';

const req = (method, headers = {}) => /** @type {any} */ ({ method, headers });
const url = (q = '') => new URL(`http://localhost/api/status${q}`);

test('tokenOk: only the exact token passes (different length, empty and missing fail)', () => {
  assert.equal(tokenOk('s3cret', 's3cret'), true);
  assert.equal(tokenOk('s3cret', 's3creT'), false);
  assert.equal(tokenOk('s3cret', 's3cret!'), false);
  assert.equal(tokenOk('s3cret', ''), false);
  assert.equal(tokenOk('s3cret', null), false);
  assert.equal(tokenOk('s3cret', undefined), false);
});

test('tokenFrom: Authorization: Bearer, then X-Factory-Token', () => {
  assert.equal(tokenFrom(req('GET', { authorization: 'Bearer abc' }), url()), 'abc');
  assert.equal(tokenFrom(req('POST', { 'x-factory-token': 'xyz' }), url()), 'xyz');
  assert.equal(tokenFrom(req('GET', { authorization: 'Basic abc', 'x-factory-token': 'xyz' }), url()), 'xyz', 'a proxy\'s own Authorization is not the factory token');
  assert.equal(tokenFrom(req('GET', { authorization: 'Bearer abc' }), url('?token=other')), 'abc', 'the header wins over the query');
});

test('tokenFrom: ?token= works for a GET (EventSource) but never for a POST', () => {
  assert.equal(tokenFrom(req('GET'), url('?token=q1')), 'q1');
  assert.equal(tokenFrom(req('POST'), url('?token=q1')), null);
  assert.equal(tokenFrom(req('GET'), url()), null);
});

test('singleToken: the operator for the right token, nobody otherwise', () => {
  const authorize = singleToken('t0k');
  assert.deepEqual(authorize('t0k'), { role: 'operator' });
  assert.equal(authorize('nope'), null);
  assert.equal(authorize(null), null);
});
