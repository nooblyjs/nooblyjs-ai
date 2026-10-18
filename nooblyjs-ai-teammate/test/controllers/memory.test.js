// controllers/memory.js: reviewing, pinning, deleting and resetting memory, and shared team memory.
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

test('memory review, delete and reset', async () => {
  const { body } = await get('/api/v1/teammates/milo-brightwater/memory');
  assert.ok(body.items.length >= 3);
  assert.equal((await send('DELETE', `/api/v1/teammates/milo-brightwater/memory/${body.items[0].id}`)).status, 204);
  assert.equal((await get('/api/v1/teammates/milo-brightwater/memory')).body.items.length, body.items.length - 1);
  assert.equal((await send('DELETE', '/api/v1/teammates/milo-brightwater/memory')).status, 204);
  assert.equal((await get('/api/v1/teammates/milo-brightwater/memory')).body.items.length, 0);
});

test('memory can be pinned, and shared team memory has its own screen data', async () => {
  const { body } = await app.get('/api/v1/teammates/ada-quill/memory');
  const pinned = await app.send('PATCH', `/api/v1/teammates/ada-quill/memory/${body.items.at(-1).id}`, { pinned: true });
  assert.equal(pinned.body.pinned, true);
  assert.equal((await app.get('/api/v1/teammates/ada-quill')).body.memory.pinned, 1);
  assert.equal((await app.send('PATCH', `/api/v1/teammates/ada-quill/memory/${body.items[0].id}`, { pinned: 'yes' })).status, 400);
  const task = await app.send('POST', '/api/v1/teammates/ada-quill/tasks', { task: 'Quick check' });
  assert.equal(task.body.memoryUsed[0].id, pinned.body.id, 'pinned memory goes first');

  await app.send('PATCH', '/api/v1/teammates/pip-okafor', { memoryMode: 'team' });
  const work = await app.send('POST', '/api/v1/teammates/pip-okafor/tasks', { task: 'Book the board dinner' });
  const shared = await app.get('/api/v1/team-memory');
  const item = shared.body.items.find((i) => i.id === work.body.memoriesAdded[0].id);
  assert.equal(item.contributor, 'Pip Okafor');
  assert.equal(item.source, work.body.workId);
  assert.ok(shared.body.members.some((m) => m.id === 'pip-okafor'));
  assert.equal((await app.send('PATCH', `/api/v1/team-memory/${item.id}`, { pinned: true })).body.pinned, true);
  assert.equal((await app.send('DELETE', `/api/v1/team-memory/${item.id}`)).status, 204);
  assert.ok(!(await app.get('/api/v1/team-memory')).body.items.some((i) => i.id === item.id));
});
