// controllers/teammates.js: the roster, profiles, hiring, editing, the persona, and retiring.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startApp } from '../helpers.js';

let dataDir;
let app;
before(async () => {
  app = await startApp();
  dataDir = app.dataDir;
});
after(() => app.close());

const get = (url) => app.get(url);
const send = (method, url, body) => app.send(method, url, body);
const call = (method, url, body) => app.send(method, url, body);

test('roster totals are derived from seeded timesheets and match the design', async () => {
  const { body } = await get('/api/v1/teammates');
  // The mockup's eight ($6,814 over 312 hours, four on a task) plus Rhea Voss: 18 hours at $52, and on a task; plus
  // Ines Tau (NooblyJS Phase 26): 6 hours at $38, available.
  assert.equal(body.teammates.length, 10);
  assert.equal(body.summary.onTask, 5);
  assert.deepEqual(body.summary.billed30d, { amount: 6814 + 936 + 228, hours: 312 + 18 + 6, teammates: 10 });
  assert.deepEqual(body.teammates.map((t) => t.name.split(' ')[0]), ['Ada', 'Milo', 'Juno', 'Otis', 'Sable', 'Pip', 'Rook', 'Wren', 'Rhea', 'Ines']);
  const ada = body.teammates.find((t) => t.id === 'ada-quill');
  assert.deepEqual(ada.billed30d, { hours: 42, amount: 2016 });
});

test('profile exposes cost breakdown and this week timesheet', async () => {
  const { body } = await get('/api/v1/teammates/ada-quill');
  assert.deepEqual(body.costBreakdown, { compute: 31, tools: 5, margin: 12, rate: 48 });
  assert.equal(body.timesheet.entries.length, 4);
  assert.equal(body.timesheet.totals.amount, 696);
  assert.equal(body.timesheet.totals.hours, 14.5);
  assert.equal(body.weekly.at(-1).label, 'wk 40');
  assert.equal((await get('/api/v1/teammates/nobody')).status, 404);
  assert.equal((await get('/api/v1/teammates/..%2F..%2Fetc')).status, 404);
});

test('hire validates input, then creates an available teammate', async () => {
  const bad = await send('POST', '/api/v1/teammates', { name: '', model: 'gpt', rate: -1 });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.name && bad.body.error.details.model && bad.body.error.details.rate);

  const ok = await send('POST', '/api/v1/teammates', {
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

test('editing a profile updates fields and can clear the approval threshold', async () => {
  const res = await call('PATCH', '/api/v1/teammates/ada-quill', {
    name: 'Ada Quill', role: 'Principal Research Analyst', about: 'New about.', traits: ['Tone: warm'],
    approvalThreshold: null, memoryMode: 'team', status: 'off',
    avatar: { type: 'generated', bg: '#D6E4FA', deep: '#1F4A8A', hair: 'bob' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'Principal Research Analyst');
  assert.equal(res.body.approvalThreshold, undefined);
  assert.equal(res.body.status, 'off');
  assert.equal(res.body.currentTask, 'Off shift');
  assert.deepEqual(res.body.traits, ['Tone: warm']);
  const bad = await call('PATCH', '/api/v1/teammates/ada-quill', { name: '', avatar: { type: 'generated', bg: 'red' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.name && bad.body.error.details.avatar);
});

test('persona can be edited and reset to the generated default', async () => {
  await call('PATCH', '/api/v1/teammates/wren-sato', { instructions: '# Custom\n\nBe brief.' });
  assert.equal((await call('GET', '/api/v1/teammates/wren-sato')).body.instructions, '# Custom\n\nBe brief.');
  const reset = await call('POST', '/api/v1/teammates/wren-sato/persona/reset');
  assert.match(reset.body.instructions, /^You are Wren Sato, a Sales Researcher on Stevie's team/);
});

test('retiring hides a teammate from the roster but keeps billing history', async () => {
  const before = await call('GET', '/api/v1/billing?period=month&offset=-1');
  const { total } = (await call('GET', '/api/v1/teammates')).body.summary;
  const r = await call('POST', '/api/v1/teammates/rook-vale/retire');
  assert.ok(r.body.retiredAt);
  const roster = await call('GET', '/api/v1/teammates');
  assert.ok(!roster.body.teammates.some((t) => t.id === 'rook-vale'));
  assert.equal(roster.body.summary.total, total - 1);
  const after = await call('GET', '/api/v1/billing?period=month&offset=-1');
  assert.equal(after.body.totals.amount, before.body.totals.amount);
  assert.ok(after.body.byTeammate.some((t) => t.id === 'rook-vale'));

  assert.equal((await call('POST', '/api/v1/teammates/rook-vale/tasks', { task: 'x' })).status, 410);
  assert.equal((await call('PATCH', '/api/v1/teammates/rook-vale', { rate: 70 })).status, 409);
  const profile = await call('GET', '/api/v1/teammates/rook-vale');
  assert.equal(profile.status, 200);
  assert.ok(profile.body.retiredLabel);

  const back = await call('POST', '/api/v1/teammates/rook-vale/reinstate');
  assert.equal(back.body.status, 'available');
  assert.equal(back.body.retiredAt, undefined);
  assert.ok((await call('GET', '/api/v1/teammates')).body.teammates.some((t) => t.id === 'rook-vale'));
});
