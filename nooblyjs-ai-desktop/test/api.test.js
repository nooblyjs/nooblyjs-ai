'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();
const { bootstrap } = require('../src/storage/bootstrap');
const { createApp } = require('../src/app');

const app = createApp();

test.before(() => bootstrap());
test.after(() => cleanup(dir));

async function makeProject(overrides = {}) {
  const res = await request(app)
    .post('/api/projects')
    .send({ name: 'NMEA Parser', description: 'Rust CLI for NMEA 0183.', ...overrides })
    .expect(201);
  return res.body.project;
}

test('creates, reads, updates and deletes a project', async () => {
  const project = await makeProject();
  assert.match(project.id, /^nmea-parser-[a-z0-9]{4}$/);

  await request(app).get(`/api/projects/${project.id}`).expect(200);

  const patched = await request(app)
    .patch(`/api/projects/${project.id}`)
    .send({ description: 'Updated context.' })
    .expect(200);
  assert.equal(patched.body.project.description, 'Updated context.');
  assert.equal(patched.body.project.id, project.id, 'id must be stable across edits');

  await request(app).delete(`/api/projects/${project.id}`).expect(204);
  await request(app).get(`/api/projects/${project.id}`).expect(404);
});

test('rejects a project with no name', async () => {
  const res = await request(app).post('/api/projects').send({ description: 'orphan' }).expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('rejects an over-long description', async () => {
  await request(app)
    .post('/api/projects')
    .send({ name: 'Big', description: 'x'.repeat(20001) })
    .expect(400);
});

test('two projects with the same name get distinct ids', async () => {
  const a = await makeProject({ name: 'Duplicate' });
  const b = await makeProject({ name: 'Duplicate' });
  assert.notEqual(a.id, b.id);
});

test('rejects a traversal attempt in the project id', async () => {
  await request(app).get('/api/projects/..%2f..%2fetc').expect(400);
});

test('creates a chat and derives its title from the first message', async () => {
  const project = await makeProject();
  const created = await request(app).post(`/api/projects/${project.id}/chats`).send({}).expect(201);
  const chatId = created.body.chat.id;
  assert.equal(created.body.chat.title, 'New chat');

  // No provider is configured in tests, so the turn fails — but the user's
  // message and the derived title must still be persisted.
  await request(app)
    .post(`/api/projects/${project.id}/chats/${chatId}/messages`)
    .send({ content: 'Why does my checksum validation reject valid RMC sentences?' })
    .expect(409);

  const after = await request(app).get(`/api/projects/${project.id}/chats/${chatId}`).expect(200);
  assert.equal(after.body.chat.messages.length, 1, 'the user message must survive a provider failure');
  assert.equal(after.body.chat.messages[0].role, 'user');
  assert.match(after.body.chat.title, /^Why does my checksum/);
});

test('renaming a chat stops the title being auto-derived', async () => {
  const project = await makeProject();
  const { body } = await request(app).post(`/api/projects/${project.id}/chats`).send({}).expect(201);

  const renamed = await request(app)
    .patch(`/api/projects/${project.id}/chats/${body.chat.id}`)
    .send({ title: 'Checksum notes' })
    .expect(200);
  assert.equal(renamed.body.chat.title, 'Checksum notes');
  assert.equal(renamed.body.chat.titleGenerated, false);
});

test('deleting a project removes its chats', async () => {
  const project = await makeProject();
  await request(app).post(`/api/projects/${project.id}/chats`).send({}).expect(201);
  await request(app).delete(`/api/projects/${project.id}`).expect(204);
  await request(app).get(`/api/projects/${project.id}/chats`).expect(404);
});

test('the providers endpoint never leaks key material', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-value-do-not-leak';
  try {
    const res = await request(app).get('/api/providers').expect(200);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes('sk-ant-secret-value-do-not-leak'), 'key must never reach the client');
    const anthropic = res.body.providers.find((p) => p.id === 'anthropic');
    assert.equal(anthropic.configured, true);
    assert.equal(anthropic.apiKeyEnvVar, 'ANTHROPIC_API_KEY');
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('settings round-trip and reject out-of-range values', async () => {
  const saved = await request(app).patch('/api/settings').send({ temperature: 0.3 }).expect(200);
  assert.equal(saved.body.settings.temperature, 0.3);
  await request(app).patch('/api/settings').send({ temperature: 9 }).expect(400);
});

test('unknown api endpoints return a JSON 404', async () => {
  const res = await request(app).get('/api/nothing-here').expect(404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('a project name containing markup renders inert', async () => {
  const project = await makeProject({ name: '<img src=x onerror=alert(1)>' });
  const res = await request(app).get('/').expect(200);
  assert.ok(!res.text.includes('<img src=x onerror=alert(1)>'), 'raw markup must not reach the page');
  assert.ok(res.text.includes('&lt;img src=x onerror=alert(1)&gt;'), 'it should appear escaped');
  await request(app).delete(`/api/projects/${project.id}`);
});
