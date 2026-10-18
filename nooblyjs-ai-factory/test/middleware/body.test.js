// Phase F15/F17: request bodies, with a size cap.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { readJson, readRaw } from '../../src/middleware/body.js';

/** A request-like stream that delivers `chunks`. */
const request = (...chunks) => /** @type {any} */ (Readable.from(chunks.map((c) => Buffer.from(c))));

test('readRaw: the bytes, joined', async () => {
  assert.equal((await readRaw(request('ab', 'cd'), { max: 10 })).toString(), 'abcd');
  assert.equal((await readRaw(request(), { max: 10 })).length, 0);
});

test('readRaw: past the cap → 413, and the request is destroyed', async () => {
  const req = request('12345', '67890', 'x');
  await assert.rejects(readRaw(req, { max: 10 }), (e) => e.status === 413 && /too large/.test(e.message));
  assert.equal(req.destroyed, true);
});

test('readJson: an object; an empty body is {}', async () => {
  assert.deepEqual(await readJson(request('{"decision":"approved"}')), { decision: 'approved' });
  assert.deepEqual(await readJson(request()), {});
});

test('readJson: not JSON → a 400 that says so', async () => {
  await assert.rejects(readJson(request('decision=approved')), (e) => e.status === 400 && /must be JSON/.test(e.message));
});

test('readJson: the default cap is 100 KB', async () => {
  await assert.rejects(readJson(request(`"${'x'.repeat(100_001)}"`)), (e) => e.status === 413);
  assert.equal((await readJson(request(`"${'x'.repeat(1000)}"`))).length, 1000);
});
