// Phase F17: the dashboard API's handlers, called directly (test/routes/api.test.js drives them over HTTP).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApiController, requeueFrom, stationOf, summarise } from '../../src/controllers/api.js';
import { openEntry } from '../../src/models/inbox.js';
import { openStore } from '../../src/models/store/events.js';
import { isStopped } from '../../src/services/scheduler/kill-switch.js';
import { testEnv } from '../helpers.js';

function withApi(fn) {
  const env = testEnv();
  const store = openStore({ env });
  try {
    return fn(createApiController({ store, env }), store);
  } finally {
    store.close();
  }
}

test('stationOf: the running station, else the last one to finish, else none', () => {
  assert.equal(stationOf({ steps: { triage: { status: 'done', endedAt: '1' }, build: { status: 'running' } } }), 'build');
  assert.equal(stationOf({ steps: { verify: { status: 'done', endedAt: '2026-01-02' }, build: { status: 'done', endedAt: '2026-01-01' } } }), 'verify');
  assert.equal(stationOf({ steps: {} }), null);
  assert.equal(stationOf({}), null);
});

test('summarise: only the parts a person reads, with long text cut', () => {
  assert.equal(summarise(null), null);
  const out = summarise({ outcome: 'ok', passed: false, gates: [{ name: 'test', status: 'failed', output: 'huge' }], findings: [{ severity: 'major', title: 'x', body: 'long' }], scope: { ok: false, violations: ['a', 'b'] }, text: 'y'.repeat(1000), noise: 1 });
  assert.deepEqual(out.gates, [{ name: 'test', status: 'failed', command: null, summary: null }]);
  assert.deepEqual(out.findings, [{ severity: 'major', title: 'x', file: null }]);
  assert.deepEqual(out.scope, { ok: false, violations: 2 });
  assert.equal(out.text.length, 400);
  assert.equal('noise' in out, false);
  assert.equal(out.passed, false);
});

test('status on an empty factory: nothing running, the default line, not stopped', () => withApi((api) => {
  const { json } = api.status();
  assert.equal(json.stopped, false);
  assert.deepEqual([json.running, json.queued, json.parked, json.inbox, json.counts], [[], [], [], 0, {}]);
  assert.ok(json.line.some((s) => s.id === 'build'));
  assert.equal(json.seq, 0);
}));

test('a missing run is a 404, for reading it and for acting on it', () => withApi((api) => {
  for (const call of [() => api.getRun({ params: { id: 'run-x' } }), () => api.runAction({ params: { id: 'run-x', action: 'cancel' } }), () => api.getArtifact({ params: { id: 'run-x', sha: 'ab' } })]) {
    assert.throws(call, (e) => e.status === 404 && /No run "run-x"/.test(e.message));
  }
}));

test('stop-all and resume-all flip the kill switch', () => withApi((api, store) => {
  assert.deepEqual(api.stopAll().json, { stopped: true });
  assert.equal(isStopped(store), true);
  assert.deepEqual(api.resumeAll().json, { stopped: false });
  assert.equal(isStopped(store), false);
}));

test('the inbox: listed, and answered with a valid decision only', () => withApi((api, store) => {
  const id = openEntry(store, { runId: 'run-1', kind: 'question', title: 'Which folder?' });
  assert.deepEqual(api.inbox().json.entries.map((e) => e.id), [id]);
  assert.throws(() => api.answerInbox({ params: { id }, body: { decision: 'maybe' } }), /decision must be/);
  const { json } = api.answerInbox({ params: { id }, body: { answer: 'src/' } });
  assert.deepEqual([json.entry.status, json.entry.answer, json.resumed], ['answered', 'src/', false]);
  assert.deepEqual(api.inbox().json.entries, []);
}));

test('requeueFrom: only a finished run; rewinds to the first unfinished station, or the one asked for', () => withApi((_api, store) => {
  const stations = [{ id: 'triage' }, { id: 'build' }, { id: 'verify' }];
  assert.throws(() => requeueFrom(store, { id: 'r1', status: 'running' }, undefined, stations), /only a finished run/);
  assert.throws(() => requeueFrom(store, { id: 'r1', status: 'failed', steps: {} }, 'paint', stations), /No station "paint"/);

  requeueFrom(store, { id: 'r1', status: 'failed', steps: { triage: { status: 'done' }, build: { status: 'failed' } } }, undefined, stations);
  const [rewound, requeued] = store.read({ stream: 'run:r1' });
  assert.deepEqual([rewound.type, rewound.data.from, rewound.data.reset], ['run.rewound', 'build', ['build', 'verify']]);
  assert.deepEqual([requeued.type, requeued.data.reason], ['run.requeued', 'retry from build (dashboard)']);

  requeueFrom(store, { id: 'r2', status: 'done', steps: { triage: { status: 'done' }, build: { status: 'done' }, verify: { status: 'done' } } }, undefined, stations);
  assert.equal(store.read({ stream: 'run:r2' })[0].data.from, 'verify', 'all done → the last station');
}));

test('runs and campaigns on an empty factory are empty lists; metrics answer for the period', () => withApi((api) => {
  assert.deepEqual(api.listRuns({ query: {} }).json, { runs: [] });
  assert.deepEqual(api.campaigns().json, { campaigns: [] });
  assert.ok(api.metrics({ query: { since: '30d' } }).json);
}));
