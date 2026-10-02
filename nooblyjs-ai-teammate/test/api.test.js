import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startApp } from './helpers.js';

let app;
let base;
let dataDir;

before(async () => {
  app = await startApp();
  ({ base, dataDir } = app);
});
after(() => app.close());

const get = (url) => app.get(url);
const send = (method, url, body) => app.send(method, url, body);
const authed = (headers = {}) => ({ ...headers, Cookie: app.session.cookie, 'X-CSRF-Token': app.session.csrf });

test('roster totals are derived from seeded timesheets and match the design', async () => {
  const { body } = await get('/api/teammates');
  assert.equal(body.teammates.length, 8);
  assert.equal(body.summary.onTask, 4);
  assert.deepEqual(body.summary.billed30d, { amount: 6814, hours: 312, teammates: 8 });
  assert.deepEqual(body.teammates.map((t) => t.name.split(' ')[0]), ['Ada', 'Milo', 'Juno', 'Otis', 'Sable', 'Pip', 'Rook', 'Wren']);
  const ada = body.teammates.find((t) => t.id === 'ada-quill');
  assert.deepEqual(ada.billed30d, { hours: 42, amount: 2016 });
});

test('profile exposes cost breakdown and this week timesheet', async () => {
  const { body } = await get('/api/teammates/ada-quill');
  assert.deepEqual(body.costBreakdown, { compute: 31, tools: 5, margin: 12, rate: 48 });
  assert.equal(body.timesheet.entries.length, 4);
  assert.equal(body.timesheet.totals.amount, 696);
  assert.equal(body.timesheet.totals.hours, 14.5);
  assert.equal(body.weekly.at(-1).label, 'wk 40');
  assert.equal((await get('/api/teammates/nobody')).status, 404);
  assert.equal((await get('/api/teammates/..%2F..%2Fetc')).status, 404);
});

test('hire validates input, then creates an available teammate', async () => {
  const bad = await send('POST', '/api/teammates', { name: '', model: 'gpt', rate: -1 });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.name && bad.body.error.details.model && bad.body.error.details.rate);

  const ok = await send('POST', '/api/teammates', {
    name: 'Nova', role: 'Customer Success Associate', model: 'sonnet', rate: 16, monthlyCap: 1500,
    costCentre: 'Support', memoryMode: 'personal', skills: ['ticket-triage', 'email-drafting', 'not-a-skill'],
    avatar: { type: 'generated', bg: '#CDE7E4', deep: '#1E5E63', hair: 'crop' },
  });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.id, 'nova');
  assert.equal(ok.body.status, 'available');
  assert.deepEqual(ok.body.skills.map((s) => s.id), ['ticket-triage', 'email-drafting']);
  const file = await fs.readFile(path.join(dataDir, 'teammates', 'nova', 'TEAMMATE.md'), 'utf8');
  assert.match(file, /You are Nova, a Customer Success Associate/);
});

test('assigning work logs a pending timesheet entry, writes memory and a work item', async () => {
  const res = await send('POST', '/api/teammates/wren-sato/tasks', { task: 'Brief on Acme Corp' });
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'mock');
  assert.equal(res.body.hours, 0.1);
  assert.equal(res.body.amount, 1.8);
  assert.equal(res.body.entry.status, 'pending');
  assert.equal(res.body.memoriesAdded.length, 1);

  const work = await get(`/api/teammates/wren-sato/work/${res.body.workId}`);
  assert.equal(work.body.request, 'Brief on Acme Corp');
  assert.match(work.body.response, /mock response/);

  const profile = await get('/api/teammates/wren-sato');
  assert.equal(profile.body.status, 'available');
  assert.ok(profile.body.timesheet.entries.some((e) => e.workId === res.body.workId));
});

test('tasks stream as server-sent events', async () => {
  const res = await fetch(`${base}/api/teammates/pip-okafor/tasks`, {
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
  assert.equal((await send('POST', '/api/teammates/sable-reyes/tasks', { task: 'x' })).status, 409);
  assert.equal((await send('POST', '/api/teammates/rook-vale/tasks', { task: 'x' })).status, 409);
  await send('PATCH', '/api/teammates/ada-quill', { monthlyCap: 100 });
  const capped = await send('POST', '/api/teammates/ada-quill/tasks', { task: 'x' });
  assert.equal(capped.status, 402);
  assert.equal(capped.body.error.code, 'monthly_cap_reached');
  assert.equal((await send('POST', '/api/teammates/ada-quill/tasks', { task: '' })).status, 400);
});

test('approving a timesheet entry updates billing', async () => {
  const before = await get('/api/billing?period=month&offset=-1');
  const pending = before.body.review.entries.find((e) => e.status === 'pending');
  const ok = await send('POST', `/api/teammates/${pending.teammateId}/timesheet/${pending.id}/approve`);
  assert.equal(ok.body.status, 'approved');
  const after = await get('/api/billing?period=month&offset=-1');
  assert.equal(after.body.review.pendingCount, before.body.review.pendingCount - 1);
  assert.equal(after.body.range.label, 'September');
  assert.equal((await send('POST', `/api/teammates/${pending.teammateId}/timesheet/ts_nope/approve`)).status, 404);
});

test('CSV export neutralises spreadsheet formulas', async () => {
  await send('POST', '/api/teammates/milo-brightwater/tasks', { task: '=HYPERLINK("http://x")' });
  const res = await fetch(`${base}/api/billing/export.csv?period=month`, { headers: authed() });
  const csv = await res.text();
  assert.match(res.headers.get('content-disposition'), /timesheets-2026-10-01-to-2026-10-31\.csv/);
  assert.match(csv, /"'=HYPERLINK/);
});

test('memory review, delete and reset', async () => {
  const { body } = await get('/api/teammates/milo-brightwater/memory');
  assert.ok(body.items.length >= 3);
  assert.equal((await send('DELETE', `/api/teammates/milo-brightwater/memory/${body.items[0].id}`)).status, 204);
  assert.equal((await get('/api/teammates/milo-brightwater/memory')).body.items.length, body.items.length - 1);
  assert.equal((await send('DELETE', '/api/teammates/milo-brightwater/memory')).status, 204);
  assert.equal((await get('/api/teammates/milo-brightwater/memory')).body.items.length, 0);
});

test('skills can be added from the library or created', async () => {
  const res = await send('POST', '/api/teammates/pip-okafor/skills', { name: 'Travel booking', description: 'Books trips', level: 2 });
  assert.ok(res.body.skills.some((s) => s.id === 'travel-booking' && s.level === 2));
  const removed = await send('DELETE', '/api/teammates/pip-okafor/skills/travel-booking');
  assert.ok(!removed.body.skills.some((s) => s.id === 'travel-booking'));
});

test('uploads accept real images only', async () => {
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`;
  assert.equal((await send('POST', '/api/uploads', { dataUrl: svg })).status, 400);
  const fakePng = `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`;
  assert.equal((await send('POST', '/api/uploads', { dataUrl: fakePng })).status, 400);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fe0def46b80000000049454e44ae426082', 'hex');
  const ok = await send('POST', '/api/uploads', { dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(ok.status, 201);
  const img = await fetch(base + ok.body.url, { headers: authed() });
  assert.equal(img.headers.get('content-type'), 'image/png');
});
