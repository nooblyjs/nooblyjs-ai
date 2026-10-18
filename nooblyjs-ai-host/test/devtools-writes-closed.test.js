// Phase 13 in the real app (roadmap Phase 13 test script): NooblyJS sends NOTHING to Jira or Bitbucket until it is allowed to.
// Jira and Bitbucket are production systems: here they are the fake in test/fixtures/atlassian.js.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eventually, today } from './helpers.js';
import { start, post, patch, issuePosts, REPOS } from './fixtures/devtools-app.js';

let closed;
before(async () => { closed = await start(); });
after(async () => { await closed?.app.stop(); });

test('a fresh NooblyJS records writes and sends none: an approved handoff is six recorded issues and no request but GET', async () => {
  const fresh = await closed.writes();
  assert.equal(fresh.enabled, false);
  assert.deepEqual([fresh.systems.jira.mode, fresh.systems.bitbucket.mode, fresh.systems.jira.sending], ['record', 'record', false]);
  assert.deepEqual(fresh.kinds.map((k) => k.kind).sort(), ['bitbucket.open-pr', 'bitbucket.push-branch', 'bitbucket.update-pr', 'jira.comment', 'jira.create-issue', 'jira.transition']);
  await closed.approveHandoff();
  const w = await closed.writes();
  assert.equal(w.outbox.counts.recorded, 6);
  assert.ok(w.outbox.entries.every((e) => e.state === 'recorded' && /DEVTOOLS_WRITES is not set/.test(e.reason) && e.itemId === 'PRD-028'));
  assert.equal(closed.fetch.writes().length, 0, 'nothing but reads left NooblyJS');
  const work = await closed.work();
  assert.equal(work.workItems.length, 6);
  assert.ok(work.workItems.every((x) => x.issue === null && x.issueWrite.state === 'recorded'));
  const audit = (await today(closed.app.store, 'audit')).filter((a) => a.action === 'devtools.write_recorded');
  assert.equal(audit.length, 6);
});

test('refuses: only an Owner changes whether NooblyJS writes, and switching a system to Send does not open the deployment\'s lock', async () => {
  for (const c of [closed.priya, closed.viewer]) {
    assert.equal((await patch(c, '/api/v1/devtools/writes/mode', { system: 'jira', mode: 'send' })).status, 403);
    assert.equal((await patch(c, '/api/v1/devtools/writes/rules', { kind: 'jira.create-issue', rule: 'off' })).status, 403);
  }
  const [entry] = (await closed.writes()).outbox.entries;
  assert.equal((await post(closed.priya, `/api/v1/devtools/writes/${entry.id}/send`)).status, 403);
  assert.equal((await post(closed.priya, `/api/v1/devtools/writes/${entry.id}/discard`)).status, 403);
  assert.equal((await post(closed.viewer, '/api/v1/devtools/sync')).status, 403, 'a Viewer may not ask for a sync');
  // The Owner switches Jira to Send. It is audited, and still nothing is sent: DEVTOOLS_WRITES is not set.
  const res = await patch(closed.stevie, '/api/v1/devtools/writes/mode', { system: 'jira', mode: 'send' });
  assert.equal(res.status, 200);
  const status = await res.json();
  assert.deepEqual([status.systems.jira.mode, status.systems.jira.sending], ['send', false]);
  assert.match(status.systems.jira.why, /DEVTOOLS_WRITES is not set/);
  const send = await post(closed.stevie, `/api/v1/devtools/writes/${entry.id}/send`);
  assert.equal(send.status, 409);
  assert.match((await send.json()).error.message, /Nothing was sent/);
  assert.equal(closed.fetch.writes().length, 0);
  const audit = await today(closed.app.store, 'audit');
  assert.ok(audit.some((a) => a.action === 'devtools.write_mode_changed' && a.actor === 'stevie' && a.after === 'send'));
  assert.ok(audit.some((a) => a.status === 403 || a.action === 'access.refused'), 'the refusals are audited');
  // There is no route that takes a write to send: a made-up one is not found.
  assert.equal((await post(closed.stevie, '/api/v1/devtools/writes', { kind: 'bitbucket.open-pr', payload: {} })).status, 404);
  assert.equal((await patch(closed.stevie, '/api/v1/devtools/writes/mode', { system: 'jira', mode: 'record' })).status, 200);
});
