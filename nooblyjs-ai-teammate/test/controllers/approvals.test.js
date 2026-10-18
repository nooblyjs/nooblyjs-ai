// controllers/approvals.js: approving timesheet entries, and tasks waiting over an approval threshold.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const get = (url) => app.get(url);
const send = (method, url, body) => app.send(method, url, body);
const raw = (method, url, { headers = {}, body } = {}) =>
  fetch(app.url + url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('approving a timesheet entry updates billing', async () => {
  const before = await get('/api/v1/billing?period=month&offset=-1');
  const pending = before.body.review.entries.find((e) => e.status === 'pending');
  const ok = await send('POST', `/api/v1/teammates/${pending.teammateId}/timesheet/${pending.id}/approve`);
  assert.equal(ok.body.status, 'approved');
  const after = await get('/api/v1/billing?period=month&offset=-1');
  assert.equal(after.body.review.pendingCount, before.body.review.pendingCount - 1);
  assert.equal(after.body.range.label, 'September');
  assert.equal((await send('POST', `/api/v1/teammates/${pending.teammateId}/timesheet/ts_nope/approve`)).status, 404);
});

test('work estimated over the approval threshold waits for the owner', async () => {
  await app.send('PATCH', '/api/v1/teammates/wren-sato', { approvalThreshold: 1 });
  const { key } = (await app.send('POST', '/api/v1/admin/keys', { name: 'Scheduler', teammates: ['wren-sato'], rateLimit: 50 })).body;
  const { key: otherKey } = (await app.send('POST', '/api/v1/admin/keys', { name: 'Other', teammates: ['wren-sato'], rateLimit: 50 })).body;
  const bearer = { Authorization: `Bearer ${key}` };

  const waiting = await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'Brief on Initech', project: 'initech' } });
  assert.equal(waiting.status, 202);
  const w = await waiting.json();
  assert.equal(w.status, 'awaiting_approval');
  assert.ok(w.estimate.amount > 1);
  // Streaming callers get the same JSON answer.
  const streamed = await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: { ...bearer, Accept: 'text/event-stream' }, body: { task: 'Second brief' } });
  assert.equal(streamed.status, 202);
  const second = await streamed.json();

  const poll = async (id, k = key) => (await raw('GET', `/api/v1/teammates/wren-sato/tasks/${id}`, { headers: { Authorization: `Bearer ${k}` } })).json();
  assert.equal((await poll(w.workId)).status, 'awaiting_approval');
  assert.equal((await raw('GET', `/api/v1/teammates/wren-sato/tasks/${w.workId}`, { headers: { Authorization: `Bearer ${otherKey}` } })).status, 404);

  const pending = (await app.get('/api/v1/approvals?status=pending')).body.approvals;
  assert.deepEqual(pending.map((a) => a.id).sort(), [w.workId, second.workId].sort());
  assert.equal(pending.find((a) => a.id === w.workId).task, 'Brief on Initech');

  assert.equal((await app.send('POST', `/api/v1/approvals/${w.workId}/approve`)).status, 202);
  assert.equal((await app.send('POST', `/api/v1/approvals/${w.workId}/approve`)).body.error.code, 'approval_decided');
  await app.invocation.idle();
  const done = await poll(w.workId);
  assert.equal(done.status, 'completed');
  assert.ok(done.output.length > 0);
  assert.equal(done.approvedBy, 'Stevie');
  const work = (await app.get(`/api/v1/teammates/wren-sato/work/${w.workId}`)).body;
  assert.deepEqual([work.caller.name, work.project, work.approvedBy], ['Scheduler', 'initech', 'Stevie']);

  const declined = await app.send('POST', `/api/v1/approvals/${second.workId}/decline`, { reason: 'Not this week' });
  assert.equal(declined.body.status, 'declined');
  assert.deepEqual([(await poll(second.workId)).status, (await poll(second.workId)).reason], ['declined', 'Not this week']);
  assert.equal((await app.send('POST', `/api/v1/approvals/${second.workId}/approve`)).status, 409);

  // The owner is asked to confirm instead, and can go ahead.
  const owner = await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Owner brief' });
  assert.equal(owner.status, 409);
  assert.equal(owner.body.error.code, 'approval_required');
  assert.ok(owner.body.error.details.estimate.amount > 1);
  const confirmed = await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Owner brief', confirmCost: true });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.approvedBy, 'Stevie');
  // Keys can't confirm their own way past the threshold.
  const sneaky = await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'x', confirmCost: true } });
  assert.equal(sneaky.status, 202);

  // Without a threshold everything runs straight away.
  await app.send('PATCH', '/api/v1/teammates/wren-sato', { approvalThreshold: null });
  assert.equal((await raw('POST', '/api/v1/teammates/wren-sato/tasks', { headers: bearer, body: { task: 'y' } })).status, 200);
});
