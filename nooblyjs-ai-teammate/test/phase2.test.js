import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

let app;
let base;

before(async () => {
  app = await startApp();
  base = app.base;
});
after(() => app.close());

const call = (method, url, body) => app.send(method, url, body);

test('editing a profile updates fields and can clear the approval threshold', async () => {
  const res = await call('PATCH', '/api/teammates/ada-quill', {
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
  const bad = await call('PATCH', '/api/teammates/ada-quill', { name: '', avatar: { type: 'generated', bg: 'red' } });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.error.details.name && bad.body.error.details.avatar);
});

test('persona can be edited and reset to the generated default', async () => {
  await call('PATCH', '/api/teammates/wren-sato', { instructions: '# Custom\n\nBe brief.' });
  assert.equal((await call('GET', '/api/teammates/wren-sato')).body.instructions, '# Custom\n\nBe brief.');
  const reset = await call('POST', '/api/teammates/wren-sato/persona/reset');
  assert.match(reset.body.instructions, /^You are Wren Sato, a Sales Researcher on Stevie's team/);
});

test('skill level and shared library skill can be edited', async () => {
  const lvl = await call('PATCH', '/api/teammates/wren-sato/skills/lead-enrichment', { level: 3 });
  assert.equal(lvl.body.skills.find((s) => s.id === 'lead-enrichment').level, 3);
  assert.equal((await call('PATCH', '/api/teammates/wren-sato/skills/lead-enrichment', { level: 7 })).status, 400);
  assert.equal((await call('PATCH', '/api/teammates/wren-sato/skills/react', { level: 2 })).status, 404);

  const skill = await call('GET', '/api/skills/code-review');
  assert.deepEqual(skill.body.usedBy.map((u) => u.id), ['rook-vale']);
  const updated = await call('PATCH', '/api/skills/code-review', { description: 'Reviews diffs carefully', instructions: 'Check tests first.' });
  assert.equal(updated.body.instructions, 'Check tests first.');
  const rook = await call('GET', '/api/teammates/rook-vale');
  assert.equal(rook.body.skills.find((s) => s.id === 'code-review').description, 'Reviews diffs carefully');
});

test('retiring hides a teammate from the roster but keeps billing history', async () => {
  const before = await call('GET', '/api/billing?period=month&offset=-1');
  const r = await call('POST', '/api/teammates/rook-vale/retire');
  assert.ok(r.body.retiredAt);
  const roster = await call('GET', '/api/teammates');
  assert.ok(!roster.body.teammates.some((t) => t.id === 'rook-vale'));
  assert.equal(roster.body.summary.total, 7);
  const after = await call('GET', '/api/billing?period=month&offset=-1');
  assert.equal(after.body.totals.amount, before.body.totals.amount);
  assert.ok(after.body.byTeammate.some((t) => t.id === 'rook-vale'));

  assert.equal((await call('POST', '/api/teammates/rook-vale/tasks', { task: 'x' })).status, 410);
  assert.equal((await call('PATCH', '/api/teammates/rook-vale', { rate: 70 })).status, 409);
  const profile = await call('GET', '/api/teammates/rook-vale');
  assert.equal(profile.status, 200);
  assert.ok(profile.body.retiredLabel);

  const back = await call('POST', '/api/teammates/rook-vale/reinstate');
  assert.equal(back.body.status, 'available');
  assert.equal(back.body.retiredAt, undefined);
  assert.ok((await call('GET', '/api/teammates')).body.teammates.some((t) => t.id === 'rook-vale'));
});

test('live events stream teammate status and new timesheet entries', async () => {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/events`, { signal: controller.signal, headers: { Cookie: app.session.cookie } });
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  const done = (async () => {
    while (!/event: timesheet/.test(text) || !/"status":"available"/.test(text)) {
      const { value, done: end } = await reader.read();
      if (end) break;
      text += value;
    }
  })();
  await new Promise((r) => setTimeout(r, 50));
  await call('POST', '/api/teammates/pip-okafor/tasks', { task: 'Book the offsite' });
  await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
  controller.abort();
  assert.match(text, /event: teammate\ndata: \{"id":"pip-okafor","status":"task","currentTask":"Book the offsite"\}/);
  assert.match(text, /event: timesheet\ndata: \{"teammateId":"pip-okafor"/);
  assert.match(text, /"id":"pip-okafor","status":"available"/);
});
