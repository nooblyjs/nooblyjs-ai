// Live updates: Teammates has no event stream of its own. What changes goes to NooblyJS's event stream (host.events),
// and the pages hear it through the frame (ctx.sse).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('a task tells NooblyJS the teammate is busy, that time was logged, and that they are free again', async () => {
  const from = app.host.eventLog.length;
  await app.send('POST', '/api/v1/teammates/pip-okafor/tasks', { task: 'Book the offsite' });
  const sent = app.host.eventLog.slice(from).filter((e) => e.type.startsWith('teammates.'));
  const changes = sent.filter((e) => e.type === 'teammates.teammate_changed').map((e) => e.payload.live);
  assert.deepEqual(changes[0], { id: 'pip-okafor', status: 'task', currentTask: 'Book the offsite' });
  assert.equal(changes.at(-1).status, 'available');
  assert.equal(sent.find((e) => e.type === 'teammates.timesheet_changed').payload.live.teammateId, 'pip-okafor');
  assert.ok(sent.some((e) => e.type === 'teammates.work_changed'));
});

test('the app serves no stream of its own', async () => {
  assert.equal((await app.get('/api/v1/events')).status, 404);
});
