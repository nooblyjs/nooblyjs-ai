// Phase F23: the worker API's handlers, with a stand-in dispatcher.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkersController } from '../../src/controllers/workers.js';
import { hashToken, workersFrom } from '../../src/models/workers.js';
import { openStore } from '../../src/models/store/events.js';
import { testEnv } from '../helpers.js';

/** A dispatcher that records what it was asked. */
function fakeDispatcher() {
  const calls = [];
  const record = (name, out) => (...args) => (calls.push([name, ...args]), out);
  return { calls, lease: record('lease', { stepId: 's1' }), heartbeat: record('heartbeat', { ok: true }), events: record('events', true), complete: record('complete', true), fail: record('fail', true) };
}

function withController(fn) {
  const store = openStore({ env: testEnv() });
  const dispatcher = fakeDispatcher();
  try {
    return fn(createWorkersController({ store, dispatcher: /** @type {any} */ (dispatcher) }), { store, dispatcher });
  } finally {
    store.close();
  }
}

const worker = { role: 'worker', workerId: 'worker-1', name: 'box' };

test('register: needs the enrollment token; gives a fresh token and logs only its hash', () => withController((c, { store }) => {
  assert.throws(() => c.register({ principal: worker, body: { name: 'x' } }), (e) => e.status === 403);
  const { json } = c.register({ principal: { role: 'enroll' }, body: { name: 'gpu-box' } });
  assert.match(json.workerId, /^worker/);
  assert.ok(json.token.length >= 32);
  const [w] = workersFrom(store);
  assert.deepEqual([w.id, w.name, w.tokenHash], [json.workerId, 'gpu-box', hashToken(json.token)]);
  assert.equal(JSON.stringify(store.read()).includes(json.token), false);
}));

test('every other call needs a worker token, and passes the worker id to the dispatcher', () => withController((c, { dispatcher }) => {
  for (const name of ['lease', 'heartbeat', 'events', 'complete', 'fail']) {
    assert.throws(() => c[name]({ principal: { role: 'enroll' }, body: {} }), (e) => e.status === 403, `${name} refuses the enrollment token`);
  }
  assert.deepEqual(c.lease({ principal: worker }).json, { job: { stepId: 's1' } });
  assert.deepEqual(c.heartbeat({ principal: worker, body: { stepId: 's1' } }).json, { ok: true });
  c.complete({ principal: worker, body: { stepId: 's1', result: { ok: 1 } } });
  assert.deepEqual(dispatcher.calls, [['lease', 'worker-1'], ['heartbeat', 'worker-1', 's1'], ['complete', 'worker-1', 's1', { ok: 1 }]]);
}));

test('bad bodies get safe defaults: events must be a list, a result an object, a reason a string', () => withController((c, { dispatcher }) => {
  c.events({ principal: worker, body: { stepId: 's1', events: 'not a list' } });
  c.complete({ principal: worker, body: { stepId: 's1' } });
  c.fail({ principal: worker, body: { stepId: 's1' } });
  assert.deepEqual(dispatcher.calls, [['events', 'worker-1', 's1', []], ['complete', 'worker-1', 's1', {}], ['fail', 'worker-1', 's1', 'unknown']]);
}));
