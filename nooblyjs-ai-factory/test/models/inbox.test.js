// Phase F12: the inbox: entries are events, and the inbox table is their projection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerEntry, entriesFor, openEntries, openEntry } from '../../src/models/inbox.js';
import { openStore } from '../../src/models/store/events.js';
import { createFakeClock } from '../../src/utils/clock.js';
import { testEnv } from '../helpers.js';

function withStore(fn) {
  const clock = createFakeClock(Date.UTC(2026, 9, 9));
  const store = openStore({ env: testEnv(), clock });
  try {
    return fn(store, clock);
  } finally {
    store.close();
  }
}

test('openEntry → an open entry; openEntries lists them oldest first', () => withStore((store, clock) => {
  const first = openEntry(store, { runId: 'run-1', kind: 'approval', gate: 'spec', title: 'Approve the spec?' });
  clock.advance(1000);
  const second = openEntry(store, { runId: 'run-2', kind: 'question', title: 'Which folder?' });
  assert.match(first, /^ask/);
  assert.deepEqual(openEntries(store).map((e) => [e.id, e.status, e.kind]), [[first, 'open', 'approval'], [second, 'open', 'question']]);
  assert.equal(store.read({ stream: 'run:run-1' })[0].type, 'inbox.opened');
}));

test('answerEntry: records who decided what; the entry leaves the open list', () => withStore((store) => {
  const id = openEntry(store, { runId: 'run-1', kind: 'approval', gate: 'spec', title: 'Approve?' });
  const entry = answerEntry(store, id, 'approved', { by: 'sam' });
  assert.deepEqual([entry.status, entry.by], ['approved', 'sam']);
  assert.deepEqual(openEntries(store), []);
}));

test('answerEntry refuses: unknown ids, answering twice, empty answers, rejections without feedback', () => withStore((store) => {
  assert.throws(() => answerEntry(store, 'ask-nope', 'approved'), /No inbox entry/);
  const q = openEntry(store, { runId: 'run-1', kind: 'question', title: 'Which?' });
  assert.throws(() => answerEntry(store, q, 'answered', { answer: '   ' }), /needs some text/);
  const a = openEntry(store, { runId: 'run-1', kind: 'approval', gate: 'spec', title: 'Approve?' });
  assert.throws(() => answerEntry(store, a, 'rejected', {}), /needs --feedback/);
  answerEntry(store, a, 'rejected', { feedback: 'smaller, please' });
  assert.throws(() => answerEntry(store, a, 'approved'), /already rejected/);
}));

test('Phase F16: approving a scope request grants those paths to the run', () => withStore((store) => {
  const id = openEntry(store, { runId: 'run-7', kind: 'policy', gate: 'scope', title: 'More paths?', detail: { paths: ['docs/'], reason: 'the README' } });
  answerEntry(store, id, 'approved', { by: 'sam' });
  const granted = store.read({ stream: 'run:run-7' }).find((e) => e.type === 'scope.granted');
  assert.deepEqual(granted.data, { runId: 'run-7', paths: ['docs/'], reason: 'the README', by: 'sam' });
}));

test('entriesFor: one run\'s entries for one gate, newest first', () => withStore((store, clock) => {
  const old = openEntry(store, { runId: 'run-1', kind: 'approval', gate: 'spec', title: 'v1' });
  clock.advance(1000);
  const recent = openEntry(store, { runId: 'run-1', kind: 'approval', gate: 'spec', title: 'v2' });
  openEntry(store, { runId: 'run-1', kind: 'approval', gate: 'pr', title: 'merge?' });
  openEntry(store, { runId: 'run-2', kind: 'approval', gate: 'spec', title: 'other run' });
  assert.deepEqual(entriesFor(store, 'run-1', 'spec').map((e) => e.id), [recent, old]);
}));
