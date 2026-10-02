'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const request = require('supertest');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();
const { bootstrap } = require('../src/storage/bootstrap');
const { createApp } = require('../src/app');
const paths = require('../src/storage/paths');

const app = createApp();

test.before(() => bootstrap());
test.after(() => cleanup(dir));

async function makeProject(name = 'Docs') {
  const res = await request(app).post('/api/projects').send({ name, description: 'ctx' }).expect(201);
  return res.body.project;
}

const docsUrl = (id) => `/api/projects/${id}/documents`;

test('creates folders and documents, and reads the tree back', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);

  await request(app).post(`${base}/folders`).send({ name: 'Specs' }).expect(201);
  await request(app).post(`${base}/folders`).send({ parent: 'Specs', name: 'Protocols' }).expect(201);
  await request(app)
    .post(`${base}/documents`)
    .send({ parent: 'Specs/Protocols', name: 'Checksum', content: '# Checksum\n\nXOR everything.' })
    .expect(201);

  const { body } = await request(app).get(base).expect(200);
  assert.equal(body.tree[0].name, 'Specs');
  assert.equal(body.tree[0].children[0].name, 'Protocols');
  assert.equal(body.tree[0].children[0].children[0].name, 'Checksum.md');
});

test('stores documents as real files on disk', async () => {
  const project = await makeProject();
  await request(app)
    .post(`${docsUrl(project.id)}/documents`)
    .send({ name: 'Notes', content: '# Notes\n\nPlain text on disk.' })
    .expect(201);

  const onDisk = nodePath.join(paths.documentsDir(project.id), 'Notes.md');
  assert.ok(fs.existsSync(onDisk), 'the .md file should exist on disk');
  assert.match(fs.readFileSync(onDisk, 'utf8'), /Plain text on disk/);
});

test('picks up a document created outside the app', async () => {
  const project = await makeProject();
  await request(app).get(docsUrl(project.id)).expect(200); // ensure the root exists
  fs.writeFileSync(nodePath.join(paths.documentsDir(project.id), 'External.md'), '# External\n\nHand-made.');

  const { body } = await request(app).get(`${docsUrl(project.id)}/list`).expect(200);
  assert.ok(body.documents.some((d) => d.path === 'External.md'));
});

test('updates a document', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);
  await request(app).post(`${base}/documents`).send({ name: 'Draft', content: 'v1' }).expect(201);

  await request(app).put(`${base}/content`).send({ path: 'Draft.md', content: 'v2' }).expect(200);
  const { body } = await request(app).get(`${base}/content?path=${encodeURIComponent('Draft.md')}`).expect(200);
  assert.equal(body.document.content, 'v2');
});

test('moves a document into a folder and back out', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);
  await request(app).post(`${base}/folders`).send({ name: 'Archive' }).expect(201);
  await request(app).post(`${base}/documents`).send({ name: 'Old', content: 'x' }).expect(201);

  await request(app).post(`${base}/move`).send({ from: 'Old.md', to: 'Archive/Old.md' }).expect(200);
  await request(app).get(`${base}/content?path=${encodeURIComponent('Archive/Old.md')}`).expect(200);

  await request(app).post(`${base}/move`).send({ from: 'Archive/Old.md', to: 'Old.md' }).expect(200);
  await request(app).get(`${base}/content?path=${encodeURIComponent('Old.md')}`).expect(200);
});

test('moving a folder carries its contents', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);
  await request(app).post(`${base}/folders`).send({ name: 'A' }).expect(201);
  await request(app).post(`${base}/folders`).send({ name: 'B' }).expect(201);
  await request(app).post(`${base}/documents`).send({ parent: 'A', name: 'Inside', content: 'x' }).expect(201);

  await request(app).post(`${base}/move`).send({ from: 'A', to: 'B/A' }).expect(200);
  await request(app).get(`${base}/content?path=${encodeURIComponent('B/A/Inside.md')}`).expect(200);
});

test('refuses to move a folder into its own descendant', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);
  await request(app).post(`${base}/folders`).send({ name: 'Parent' }).expect(201);
  await request(app).post(`${base}/folders`).send({ parent: 'Parent', name: 'Child' }).expect(201);

  await request(app).post(`${base}/move`).send({ from: 'Parent', to: 'Parent/Child/Parent' }).expect(400);
});

test('refuses to overwrite an existing entry on move', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);
  await request(app).post(`${base}/documents`).send({ name: 'One', content: 'keep me' }).expect(201);
  await request(app).post(`${base}/documents`).send({ name: 'Two', content: 'other' }).expect(201);

  await request(app).post(`${base}/move`).send({ from: 'Two.md', to: 'One.md' }).expect(400);
  const { body } = await request(app).get(`${base}/content?path=${encodeURIComponent('One.md')}`).expect(200);
  assert.equal(body.document.content, 'keep me', 'the existing document must be untouched');
});

test('deletes a folder and everything in it', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);
  await request(app).post(`${base}/folders`).send({ name: 'Temp' }).expect(201);
  await request(app).post(`${base}/documents`).send({ parent: 'Temp', name: 'Doomed', content: 'x' }).expect(201);

  await request(app).delete(`${base}?path=Temp`).expect(204);
  await request(app).get(`${base}/content?path=${encodeURIComponent('Temp/Doomed.md')}`).expect(404);
  const { body } = await request(app).get(base).expect(200);
  assert.ok(!body.tree.some((n) => n.name === 'Temp'), 'the folder should be gone from the tree');
});

test('rejects duplicate names', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);
  await request(app).post(`${base}/documents`).send({ name: 'Same' }).expect(201);
  await request(app).post(`${base}/documents`).send({ name: 'Same' }).expect(400);
});

test('blocks every path traversal attempt', async () => {
  const project = await makeProject();
  const base = docsUrl(project.id);

  for (const name of ['../escape', '../../etc/passwd', '/absolute', 'a/../../b', '.hidden', 'con']) {
    await request(app).post(`${base}/documents`).send({ name }).expect(400);
  }
  for (const path of ['../../project.json', '../chats', '/etc/passwd']) {
    await request(app).get(`${base}/content?path=${encodeURIComponent(path)}`).expect(400);
  }
  await request(app).post(`${base}/move`).send({ from: 'x.md', to: '../../escaped.md' }).expect(400);
  await request(app).delete(`${base}?path=${encodeURIComponent('../../project.json')}`).expect(400);

  // The project's own files must still be intact.
  await request(app).get(`/api/projects/${project.id}`).expect(200);
});

test('refuses to delete the documents root', async () => {
  const project = await makeProject();
  await request(app).delete(`${docsUrl(project.id)}?path=`).expect(400);
});

test('a symlink pointing outside the project is not readable', async () => {
  const project = await makeProject();
  await request(app).get(docsUrl(project.id)).expect(200);

  const secret = nodePath.join(dir, 'outside-secret.md');
  fs.writeFileSync(secret, '# Secret\n\nShould never be served.');
  fs.symlinkSync(secret, nodePath.join(paths.documentsDir(project.id), 'Link.md'));

  const res = await request(app).get(`${docsUrl(project.id)}/content?path=Link.md`);
  assert.notEqual(res.status, 200, 'a symlink out of the documents tree must not resolve');

  const { body } = await request(app).get(`${docsUrl(project.id)}/list`).expect(200);
  assert.ok(!body.documents.some((d) => d.path === 'Link.md'), 'symlinks are not listed');
});

test('only markdown files are exposed', async () => {
  const project = await makeProject();
  await request(app).get(docsUrl(project.id)).expect(200);
  fs.writeFileSync(nodePath.join(paths.documentsDir(project.id), 'data.csv'), 'a,b\n1,2');

  const { body } = await request(app).get(`${docsUrl(project.id)}/list`).expect(200);
  assert.ok(!body.documents.some((d) => d.path === 'data.csv'));
  await request(app).post(`${docsUrl(project.id)}/documents`).send({ name: 'x.txt' }).expect(201);
  // .txt gets the .md extension appended rather than being stored as-is.
  const after = await request(app).get(`${docsUrl(project.id)}/list`).expect(200);
  assert.ok(after.body.documents.some((d) => d.path === 'x.txt.md'));
});
