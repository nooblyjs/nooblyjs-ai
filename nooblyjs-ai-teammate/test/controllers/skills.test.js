// controllers/skills.js and the skill routes on a teammate: adding, levels and the shared library.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

const send = (method, url, body) => app.send(method, url, body);
const call = (method, url, body) => app.send(method, url, body);

test('skills can be added from the library or created', async () => {
  const res = await send('POST', '/api/v1/teammates/pip-okafor/skills', { name: 'Travel booking', description: 'Books trips', level: 2 });
  assert.ok(res.body.skills.some((s) => s.id === 'travel-booking' && s.level === 2));
  const removed = await send('DELETE', '/api/v1/teammates/pip-okafor/skills/travel-booking');
  assert.ok(!removed.body.skills.some((s) => s.id === 'travel-booking'));
});

test('skill level and shared library skill can be edited', async () => {
  const lvl = await call('PATCH', '/api/v1/teammates/wren-sato/skills/lead-enrichment', { level: 3 });
  assert.equal(lvl.body.skills.find((s) => s.id === 'lead-enrichment').level, 3);
  assert.equal((await call('PATCH', '/api/v1/teammates/wren-sato/skills/lead-enrichment', { level: 7 })).status, 400);
  assert.equal((await call('PATCH', '/api/v1/teammates/wren-sato/skills/react', { level: 2 })).status, 404);

  const skill = await call('GET', '/api/v1/skills/code-review');
  assert.deepEqual(skill.body.usedBy.map((u) => u.id), ['rook-vale']);
  const updated = await call('PATCH', '/api/v1/skills/code-review', { description: 'Reviews diffs carefully', instructions: 'Check tests first.' });
  assert.equal(updated.body.instructions, 'Check tests first.');
  const rook = await call('GET', '/api/v1/teammates/rook-vale');
  assert.equal(rook.body.skills.find((s) => s.id === 'code-review').description, 'Reviews diffs carefully');
});
