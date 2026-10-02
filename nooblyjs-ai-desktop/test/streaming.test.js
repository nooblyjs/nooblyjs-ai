'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();
const { bootstrap } = require('../src/storage/bootstrap');
const registry = require('../src/providers/registry');
const { makeMockProvider } = require('../scripts/mockProvider');
const { createApp } = require('../src/app');

registry.register(makeMockProvider({ id: 'mock', delayMs: 0 }));
registry.register(makeMockProvider({ id: 'mockfail', label: 'Mock Fail', failWith: 'simulated outage' }));

const app = createApp();

test.before(() => bootstrap());
test.after(() => cleanup(dir));

async function seed() {
  const project = (
    await request(app).post('/api/projects').send({ name: 'Ctx', description: 'SECRET-CONTEXT-MARKER' })
  ).body.project;
  const chat = (await request(app).post(`/api/projects/${project.id}/chats`).send({})).body.chat;
  return { project, chat };
}

/** Deltas arrive fragmented across frames, so reassemble before asserting on content. */
function assembleText(text) {
  return parseEvents(text)
    .filter((e) => e.name === 'delta')
    .map((e) => e.data.text)
    .join('');
}

function parseEvents(text) {
  return text
    .split('\n\n')
    .filter((f) => f.trim() && !f.startsWith(':'))
    .map((frame) => {
      const name = /event: (.+)/.exec(frame)?.[1];
      const data = /data: (.+)/s.exec(frame)?.[1];
      return { name, data: data ? JSON.parse(data) : null };
    });
}

test('a turn streams meta, deltas and done in order', async () => {
  const { project, chat } = await seed();
  const res = await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'hello there', provider: 'mock' })
    .expect(200)
    .expect('Content-Type', /text\/event-stream/);

  const events = parseEvents(res.text);
  assert.equal(events[0].name, 'meta');
  assert.equal(events.at(-1).name, 'done');
  assert.ok(events.some((e) => e.name === 'delta'), 'should stream deltas');
  assert.equal(events[0].data.provider, 'mock');
});

test('the project description reaches the provider as system context', async () => {
  const { project, chat } = await seed();
  const res = await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'what is this project?', provider: 'mock' })
    .expect(200);

  // The mock echoes the system prompt it was given.
  assert.match(assembleText(res.text), /SECRET-CONTEXT-MARKER/);
});

test('an edited description takes effect on the next turn of an existing chat', async () => {
  const { project, chat } = await seed();
  await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'first', provider: 'mock' })
    .expect(200);

  await request(app)
    .patch(`/api/projects/${project.id}`)
    .send({ description: 'REVISED-CONTEXT-MARKER' })
    .expect(200);

  const res = await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'second', provider: 'mock' })
    .expect(200);

  const reply = assembleText(res.text);
  assert.match(reply, /REVISED-CONTEXT-MARKER/);
  assert.ok(!reply.includes('SECRET-CONTEXT-MARKER'), 'the stale description must not be resent');
});

test('both turns persist to disk and survive a reload', async () => {
  const { project, chat } = await seed();
  await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'persist me', provider: 'mock' })
    .expect(200);

  const { body } = await request(app).get(`/api/projects/${project.id}/chats/${chat.id}`).expect(200);
  assert.equal(body.chat.messages.length, 2);
  assert.equal(body.chat.messages[0].role, 'user');
  assert.equal(body.chat.messages[1].role, 'assistant');
  assert.equal(body.chat.messages[1].meta.provider, 'mock');
  assert.ok(body.chat.messages[1].meta.outputTokens > 0);
});

test('a provider failure still persists the user message and records the error', async () => {
  const { project, chat } = await seed();
  const res = await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'this will fail', provider: 'mockfail' })
    .expect(200);

  const events = parseEvents(res.text);
  assert.ok(events.some((e) => e.name === 'error'), 'should emit an error event');

  const { body } = await request(app).get(`/api/projects/${project.id}/chats/${chat.id}`).expect(200);
  assert.equal(body.chat.messages[0].content, 'this will fail', 'user message must survive');
  assert.match(body.chat.messages[1].content, /simulated outage/);
  assert.ok(body.chat.messages[1].meta.error, 'the failure must be recorded on the message');
});

test('switching provider mid-chat sends the existing history to the new provider', async () => {
  const { project, chat } = await seed();
  await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'first turn', provider: 'mock' })
    .expect(200);

  const res = await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'second turn', provider: 'mock', model: 'mock-small' })
    .expect(200);

  // The mock reports how much history it received.
  assert.match(assembleText(res.text), /I received 3 message\(s\) of history/);
});

test('an unknown provider is rejected before the stream opens', async () => {
  const { project, chat } = await seed();
  const res = await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'hi', provider: 'nonexistent' })
    .expect(400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
});

test('an empty message is rejected and does not touch the transcript', async () => {
  const { project, chat } = await seed();
  await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: '   ', provider: 'mock' })
    .expect(400);

  const { body } = await request(app).get(`/api/projects/${project.id}/chats/${chat.id}`).expect(200);
  assert.equal(body.chat.messages.length, 0);
});

test('a model missing from the catalogue falls back instead of failing', async () => {
  const { project, chat } = await seed();
  const res = await request(app)
    .post(`/api/projects/${project.id}/chats/${chat.id}/messages`)
    .send({ content: 'hi', provider: 'mock', model: 'retired-model' })
    .expect(200);

  const meta = parseEvents(res.text)[0];
  assert.equal(meta.data.modelFellBack, true);
  assert.equal(meta.data.model, 'mock-large');
});
