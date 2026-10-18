// Phase F23: the worker registry, projected from the `workers` stream. The log keeps hashes, never tokens.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashToken, registerWorker, revokeWorker, workersFrom } from '../../src/models/workers.js';
import { openStore } from '../../src/models/store/events.js';
import { testEnv } from '../helpers.js';

function withStore(fn) {
  const store = openStore({ env: testEnv() });
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

test('hashToken: a stable sha256, different for different tokens', () => {
  assert.match(hashToken('abc'), /^[0-9a-f]{64}$/);
  assert.equal(hashToken('abc'), hashToken('abc'));
  assert.notEqual(hashToken('abc'), hashToken('abd'));
});

test('registerWorker → workersFrom; the token itself is nowhere in the log', () => withStore((store) => {
  registerWorker(store, { workerId: 'worker-a', name: 'build-box', token: 'very-secret-token' });
  const [w] = workersFrom(store);
  assert.deepEqual({ id: w.id, name: w.name, revoked: w.revoked }, { id: 'worker-a', name: 'build-box', revoked: false });
  assert.equal(w.tokenHash, hashToken('very-secret-token'));
  assert.ok(w.registeredAt);
  assert.equal(JSON.stringify(store.read()).includes('very-secret-token'), false);
}));

test('a worker\'s name is cut to 60 characters, and defaults to its id', () => withStore((store) => {
  registerWorker(store, { workerId: 'worker-b', name: 'x'.repeat(200), token: 't1' });
  registerWorker(store, { workerId: 'worker-c', token: 't2' });
  const byId = Object.fromEntries(workersFrom(store).map((w) => [w.id, w]));
  assert.equal(byId['worker-b'].name.length, 60);
  assert.equal(byId['worker-c'].name, 'worker-c');
}));

test('revokeWorker: marks one worker, leaves the others; an unknown id is an error', () => withStore((store) => {
  registerWorker(store, { workerId: 'w1', name: 'one', token: 'a' });
  registerWorker(store, { workerId: 'w2', name: 'two', token: 'b' });
  revokeWorker(store, 'w1', 'sam');
  assert.deepEqual(workersFrom(store).map((w) => [w.id, w.revoked]), [['w1', true], ['w2', false]]);
  assert.equal(store.read({ stream: 'workers' }).at(-1).data.by, 'sam');
  assert.throws(() => revokeWorker(store, 'w9'), /No worker "w9"/);
}));
