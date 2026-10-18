// controllers/schedules.js: a scheduled task that delegates, as it shows on the timeline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

const hooks = [];
const fakeFetch = async (url, init = {}) => {
  hooks.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
  return new Response('', { status: 200 });
};

let app;
before(async () => {
  app = await startApp({ fetch: fakeFetch });
  await app.send('POST', '/api/v1/webhooks', { name: 'Everything', url: 'https://hooks.example.com/all', events: ['task.completed', 'task.failed', 'approval.requested', 'action.requested', 'teammate.message'] });
});
after(() => app.close());

test('a scheduled Architect task delegates to the Documentor; the timeline links both with their costs', async () => {
  const hire = (name, role, model, rate) => app.send('POST', '/api/v1/teammates', { name, role, model, rate, monthlyCap: 2000, costCentre: 'Platform' });
  const archie = (await hire('Archie Stone', 'Architect', 'opus', 50)).body;
  const dot = (await hire('Dot Lin', 'Documentor', 'haiku', 6)).body;
  assert.equal((await app.send('PATCH', `/api/v1/teammates/${archie.id}`, { delegatesTo: [archie.id] })).body.error.details.delegatesTo, 'Choose other active teammates');
  await app.send('PATCH', `/api/v1/teammates/${archie.id}`, { delegatesTo: [dot.id] });
  await app.send('PATCH', `/api/v1/teammates/${dot.id}`, { delegatesTo: [archie.id] }); // a loop the guard must stop

  const bad = await app.send('POST', '/api/v1/schedules', { teammateId: archie.id, name: '', task: '', cadence: { days: [9], time: '25:00' } });
  assert.deepEqual(Object.keys(bad.body.error.details).sort(), ['days', 'name', 'task', 'time']);
  const sch = await app.send('POST', '/api/v1/schedules', {
    teammateId: archie.id, name: 'Weekly architecture review', project: 'payments',
    task: 'As the Architect, review the payments design and ask the Documentor to write it up', cadence: { days: [1, 2, 3, 4, 5, 6, 7], time: '08:00' },
  });
  assert.equal(sch.status, 201);
  assert.equal(sch.body.cadenceLabel, 'Every day at 08:00');
  assert.ok(Date.parse(sch.body.nextRunAt) > Date.now());

  hooks.length = 0;
  assert.deepEqual(await app.scheduler.tick(Date.parse(sch.body.nextRunAt) - 1000), [], 'not due yet');
  assert.deepEqual(await app.scheduler.tick(Date.parse(sch.body.nextRunAt) + 1000), [sch.body.id]);
  assert.deepEqual(await app.scheduler.tick(Date.parse(sch.body.nextRunAt) + 2000), [], 'claimed: runs once');
  await app.invocation.idle();

  const after = (await app.get(`/api/v1/schedules?teammate=${archie.id}`)).body.schedules[0];
  assert.equal(after.lastStatus, 'completed');
  assert.equal(Date.parse(after.nextRunAt) - Date.parse(sch.body.nextRunAt), 86400000, 'next run moves to tomorrow');

  const timeline = (await app.get(`/api/v1/timeline?teammate=${archie.id}`)).body;
  const parent = timeline.items.find((i) => i.workId === after.lastWorkId);
  const child = timeline.items.find((i) => i.delegatedFrom?.workId === parent.workId);
  assert.ok(parent && child, 'both appear, even when filtering by the Architect');
  assert.deepEqual([parent.schedule.name, parent.caller.type, parent.delegations[0].teammate.id], ['Weekly architecture review', 'schedule', dot.id]);
  assert.equal(child.teammate.id, dot.id);
  assert.deepEqual([child.delegatedFrom.teammate.id, child.caller.type, child.caller.name], [archie.id, 'teammate', 'Archie Stone']);
  assert.ok(parent.amount > 0 && child.amount > 0);
  assert.equal(parent.delegations[0].amount, child.amount);
  assert.equal(parent.totalAmount, Math.round((parent.amount + child.amount) * 100) / 100);
  // Dot tried to hand it back to Archie; the loop guard refused and Dot did the work.
  assert.deepEqual([child.tools[0].name, child.tools[0].status], ['delegate', 'error']);

  // Both teammates logged their own time, linked to each other through the work items.
  const archieWork = (await app.get(`/api/v1/teammates/${archie.id}/work/${parent.workId}`)).body;
  assert.equal(archieWork.delegations[0].workId, child.workId);
  const dotEntry = (await app.get(`/api/v1/teammates/${dot.id}`)).body.timesheet.entries.find((e) => e.workId === child.workId);
  assert.deepEqual([dotEntry.callerType, dotEntry.caller, dotEntry.costCentre], ['teammate', 'Archie Stone', 'Platform']);

  const completed = hooks.filter((h) => h.body.event === 'task.completed').map((h) => h.body.data);
  assert.deepEqual(completed.map((d) => d.teammate).sort(), [archie.id, dot.id].sort());
  assert.equal(completed.find((d) => d.teammate === archie.id).schedule.id, sch.body.id);

  // Paused schedules don't run; "Run now" does, and a paused teammate makes it fail visibly.
  await app.send('PATCH', `/api/v1/schedules/${sch.body.id}`, { enabled: false });
  assert.deepEqual(await app.scheduler.tick(Date.now() + 30 * 86400000), []);
  await app.send('PATCH', `/api/v1/teammates/${archie.id}`, { status: 'paused' });
  assert.equal((await app.send('POST', `/api/v1/schedules/${sch.body.id}/run`)).status, 409);
  assert.equal((await app.send('DELETE', `/api/v1/schedules/${sch.body.id}`)).status, 204);
});

// The timeline (controllers/teammates.js) over the work above: the delegation and its tool calls.
test('timeline shows work across the team, waiting approvals and upcoming runs', async () => {
  for (const task of ['Draft a launch email', 'Summarise the Q4 competitor scan']) await app.send('POST', '/api/v1/teammates/ada-quill/tasks', { task });
  const t = (await app.get('/api/v1/timeline?days=7')).body;
  assert.equal(t.days, 7);
  assert.ok(t.items.length > 3);
  assert.ok(t.items.every((i, n) => n === 0 || t.items[n - 1].startedAt >= i.startedAt), 'newest first');
  assert.equal(t.totals.tasks, t.items.length);
  assert.ok(t.totals.delegations >= 1 && t.totals.toolCalls >= 1);
  assert.equal((await app.get('/api/v1/timeline?teammate=nobody')).status, 404);
});
