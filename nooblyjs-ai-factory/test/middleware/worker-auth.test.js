// Phase F23: who is calling the worker API: the enrollment token, a registered worker, or nobody.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireEnroll, requireWorker, workerAuthorizer } from '../../src/middleware/worker-auth.js';
import { registerWorker, revokeWorker } from '../../src/models/workers.js';
import { openStore } from '../../src/models/store/events.js';
import { testEnv } from '../helpers.js';

test('workerAuthorizer: no enrollment token, no worker API', () => {
  assert.throws(() => workerAuthorizer({ store: openStore({ env: testEnv() }), enrollToken: '' }), /enrollment token/);
});

test('workerAuthorizer: enroll, worker, revoked, unknown', () => {
  const store = openStore({ env: testEnv() });
  try {
    const authorize = workerAuthorizer({ store, enrollToken: 'join-me' });
    assert.deepEqual(authorize('join-me'), { role: 'enroll' });
    assert.equal(authorize('guess'), null);
    assert.equal(authorize(null), null);

    registerWorker(store, { workerId: 'worker-1', name: 'box', token: 'w1-token' });
    assert.deepEqual(authorize('w1-token'), { role: 'worker', workerId: 'worker-1', name: 'box' });

    revokeWorker(store, 'worker-1', 'test');
    assert.equal(authorize('w1-token'), null, 'a revoked worker is nobody');
  } finally {
    store.close();
  }
});

test('requireWorker / requireEnroll: a 403 for the wrong kind of caller', () => {
  assert.equal(requireWorker({ role: 'worker', workerId: 'w9' }), 'w9');
  assert.throws(() => requireWorker({ role: 'enroll' }), (e) => e.status === 403);
  assert.throws(() => requireWorker(null), (e) => e.status === 403);
  assert.doesNotThrow(() => requireEnroll({ role: 'enroll' }));
  assert.throws(() => requireEnroll({ role: 'worker', workerId: 'w9' }), (e) => e.status === 403 && /enrollment token/.test(e.message));
});
