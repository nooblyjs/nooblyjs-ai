// controllers/tasks.js: calling a teammate with a task (JSON and SSE), refusals, threads, skills and citations.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let base;
let app;
before(async () => {
  app = await startApp();
  base = app.url; // the app's root, e.g. http://127.0.0.1:port/teammates
});
after(() => app.close());

const get = (url) => app.get(url);
const send = (method, url, body) => app.send(method, url, body);
const authed = (headers = {}) => ({ ...headers, Cookie: app.session.cookie, 'X-CSRF-Token': app.session.csrf });

test('assigning work logs a pending timesheet entry, writes memory and a work item', async () => {
  const res = await send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Brief on Acme Corp' });
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'mock');
  assert.equal(res.body.hours, 0.1);
  assert.equal(res.body.amount, 1.8);
  assert.equal(res.body.entry.status, 'pending');
  assert.equal(res.body.memoriesAdded.length, 1);

  const work = await get(`/api/v1/teammates/wren-sato/work/${res.body.workId}`);
  assert.equal(work.body.request, 'Brief on Acme Corp');
  assert.match(work.body.response, /mock response/);

  const profile = await get('/api/v1/teammates/wren-sato');
  assert.equal(profile.body.status, 'available');
  assert.ok(profile.body.timesheet.entries.some((e) => e.workId === res.body.workId));
});

test('tasks stream as server-sent events', async () => {
  const res = await fetch(`${base}/api/v1/teammates/pip-okafor/tasks`, {
    method: 'POST',
    headers: authed({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
    body: JSON.stringify({ task: 'Book the offsite' }),
  });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const text = await res.text();
  const events = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
  assert.equal(events[0], 'start');
  assert.ok(events.includes('delta'));
  assert.equal(events.at(-1), 'done');
});

test('paused, off-shift and capped teammates refuse work', async () => {
  assert.equal((await send('POST', '/api/v1/teammates/sable-reyes/tasks', { task: 'x' })).status, 409);
  assert.equal((await send('POST', '/api/v1/teammates/rook-vale/tasks', { task: 'x' })).status, 409);
  await send('PATCH', '/api/v1/teammates/ada-quill', { monthlyCap: 100 });
  const capped = await send('POST', '/api/v1/teammates/ada-quill/tasks', { task: 'x' });
  assert.equal(capped.status, 402);
  assert.equal(capped.body.error.code, 'monthly_cap_reached');
  assert.equal((await send('POST', '/api/v1/teammates/ada-quill/tasks', { task: '' })).status, 400);
});

test('an answer cites an uploaded document and the work item lists the documents and memories used', async () => {
  const doc = await app.send('POST', '/api/v1/teammates/wren-sato/knowledge', {
    title: 'Globex account notes',
    content: '# Globex\n\nGlobex renews in March. Their buyer is Dana Ruiz, who prefers short briefs.\n\n# Unrelated\n\nThe office plants need water on Fridays.',
  });
  const res = await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'Prepare a brief for the Globex renewal' });
  assert.equal(res.status, 200);
  assert.match(res.body.output, /\[Globex account notes\]/);
  assert.deepEqual(res.body.knowledgeUsed.map((k) => [k.docId, k.heading]), [[doc.body.id, 'Globex']]);
  assert.ok(res.body.memoryUsed.length >= 1);

  const work = await app.get(`/api/v1/teammates/wren-sato/work/${res.body.workId}`);
  assert.equal(work.body.knowledgeUsed[0].title, 'Globex account notes');
  assert.ok(work.body.memoryUsed.some((m) => /opening line/.test(m.text)));
  assert.match(work.body.thread, /^thr_/);
});

test('follow-ups continue a thread with its history and project', async () => {
  const first = await app.send('POST', '/api/v1/teammates/otis-fern/tasks', { task: 'Dedupe the CRM export', project: 'acme' });
  const follow = await app.send('POST', '/api/v1/teammates/otis-fern/tasks', { task: 'Now do the same for leads', thread: first.body.thread });
  assert.equal(follow.status, 200);
  assert.equal(follow.body.thread, first.body.thread);
  assert.equal(follow.body.project, 'acme');
  assert.match(follow.body.output, /Following up on our earlier conversation \(1 earlier turn\)/);
  const third = await app.send('POST', '/api/v1/teammates/otis-fern/tasks', { task: 'And contacts?', thread: first.body.thread });
  assert.match(third.body.output, /2 earlier turns/);

  assert.equal((await app.send('POST', '/api/v1/teammates/otis-fern/tasks', { task: 'x', thread: 'thr_nope_000000' })).status, 404);
  assert.equal((await app.send('POST', '/api/v1/teammates/otis-fern/tasks', { task: 'x', thread: '../etc' })).status, 400);
  assert.equal((await app.send('POST', '/api/v1/teammates/otis-fern/tasks', { task: 'x', thread: first.body.thread, project: 'globex' })).status, 400);
  assert.equal((await app.send('POST', '/api/v1/teammates/wren-sato/tasks', { task: 'x', thread: first.body.thread })).status, 404);
});

test('skills are chosen per task, or forced with the skill parameter', async () => {
  const hired = await app.send('POST', '/api/v1/teammates', {
    name: 'Sam Many', role: 'Generalist', model: 'haiku', rate: 4, monthlyCap: 500,
    skills: ['ticket-triage', 'refund-policy', 'tone-matching', 'sql', 'scheduling', 'brand-voice'],
  });
  assert.equal(hired.status, 201);
  const auto = await app.send('POST', `/api/v1/teammates/${hired.body.id}/tasks`, { input: 'Write a query in SQL for churned users' });
  assert.deepEqual(auto.body.skillsUsed, ['sql']);
  const forced = await app.send('POST', `/api/v1/teammates/${hired.body.id}/tasks`, { task: 'Anything', skill: 'scheduling' });
  assert.deepEqual(forced.body.skillsUsed, ['scheduling']);
  assert.equal((await app.send('POST', `/api/v1/teammates/${hired.body.id}/tasks`, { task: 'x', skill: 'react' })).status, 400);
});
