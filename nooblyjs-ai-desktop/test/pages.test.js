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

async function makeProject() {
  const { body } = await request(app)
    .post('/api/projects')
    .send({ name: 'Page Test', description: 'Some context.' })
    .expect(201);
  return body.project;
}

test('the project page edits name and description in place, with no edit dialog', async () => {
  const project = await makeProject();
  const res = await request(app).get(`/projects/${project.id}`).expect(200);

  assert.match(res.text, /<input[^>]+data-project-name/, 'name should be an editable field');
  assert.match(res.text, /<textarea[^>]+data-project-description/, 'description should be a textarea');
  assert.ok(!res.text.includes('data-edit-project'), 'the edit-project button should be gone');
  assert.ok(!res.text.includes('id="edit-project"'), 'the edit-project dialog should be gone');

  // The current values must be present so editing starts from what is stored.
  assert.match(res.text, /value="Page Test"/);
  assert.match(res.text, /Some context\./);
});

test('the project page shows the documents tree alongside the context', async () => {
  const project = await makeProject();
  const res = await request(app).get(`/projects/${project.id}`).expect(200);

  assert.match(res.text, /<h2>Documents<\/h2>/, 'a Documents panel should be present');
  assert.match(res.text, /data-tree/, 'the tree container should be present');
  assert.match(res.text, /data-drop-root/, 'the root drop target should be present');
  assert.match(res.text, new RegExp(`/projects/${project.id}/documents`), 'it should link to the editor');
});

test('the documents page renders for a project that has never had documents', async () => {
  const project = await makeProject();
  await request(app).get(`/projects/${project.id}/documents`).expect(200);
  const { body } = await request(app).get(`/api/projects/${project.id}/documents`).expect(200);
  assert.deepEqual(body.tree, [], 'an empty tree rather than an error');
});

test('a project name containing markup stays escaped in the editable field', async () => {
  const { body } = await request(app)
    .post('/api/projects')
    .send({ name: '"><script>alert(1)</script>' })
    .expect(201);

  const res = await request(app).get(`/projects/${body.project.id}`).expect(200);
  assert.ok(!res.text.includes('<script>alert(1)</script>'), 'script must not be injected');
  assert.ok(res.text.includes('&#34;&gt;&lt;script&gt;'), 'it should appear escaped in the value attribute');
});

test('chats open inline on the project page rather than on their own screen', async () => {
  const project = await makeProject();
  const { body } = await request(app).post(`/api/projects/${project.id}/chats`).send({}).expect(201);
  const res = await request(app).get(`/projects/${project.id}`).expect(200);

  assert.match(res.text, new RegExp(`data-chat-id="${body.chat.id}"`), 'the chat should be a row on the page');
  assert.match(res.text, /data-chat-toggle/, 'rows should expand in place');
  assert.match(res.text, /<template data-chat-template>/, 'the inline chat template should be present');
  assert.ok(!res.text.includes(`href="/projects/${project.id}/chats/`), 'rows should not link to a chat screen');
});

test('the old chat URL redirects to the project page with that chat open', async () => {
  const project = await makeProject();
  const { body } = await request(app).post(`/api/projects/${project.id}/chats`).send({}).expect(201);
  const res = await request(app).get(`/projects/${project.id}/chats/${body.chat.id}`).expect(302);
  assert.equal(res.headers.location, `/projects/${project.id}?chat=${body.chat.id}`);
});

test('fetching a chat reports the model its next turn would use', async () => {
  const project = await makeProject();
  const { body } = await request(app).post(`/api/projects/${project.id}/chats`).send({}).expect(201);
  const res = await request(app).get(`/api/projects/${project.id}/chats/${body.chat.id}`).expect(200);
  assert.ok('effective' in res.body, 'the response should carry the effective model, or null');
  assert.equal(res.body.chat.id, body.chat.id);
});
