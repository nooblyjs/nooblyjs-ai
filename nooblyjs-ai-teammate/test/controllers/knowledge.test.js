// controllers/knowledge.js: knowledge documents, and project tags that keep knowledge and memory apart.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from '../helpers.js';

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('knowledge documents can be added, validated, edited and removed', async () => {
  const pdf = await app.send('POST', '/api/v1/teammates/milo-brightwater/knowledge', { filename: 'policy.pdf', content: 'x' });
  assert.equal(pdf.status, 422);
  assert.ok(pdf.body.error.details.filename);
  assert.equal((await app.send('POST', '/api/v1/teammates/milo-brightwater/knowledge', { title: 'Empty', content: '   ' })).status, 422);

  const created = await app.send('POST', '/api/v1/teammates/milo-brightwater/knowledge', { filename: 'refund-policy.md', content: '# Refunds\n\nAnnual plans can be refunded within 30 days.', project: 'Acme Corp' });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, 'refund policy');
  assert.equal(created.body.project, 'acme-corp');

  const listed = await app.get('/api/v1/teammates/milo-brightwater/knowledge');
  assert.equal(listed.body.docs.length, 1);
  assert.equal(listed.body.docs[0].content, undefined);

  const edited = await app.send('PATCH', `/api/v1/teammates/milo-brightwater/knowledge/${created.body.id}`, { title: 'Refund policy', project: '' });
  assert.equal(edited.body.title, 'Refund policy');
  assert.equal(edited.body.project, undefined);
  assert.match((await app.get(`/api/v1/teammates/milo-brightwater/knowledge/${created.body.id}`)).body.content, /30 days/);

  assert.equal((await app.send('DELETE', `/api/v1/teammates/milo-brightwater/knowledge/${created.body.id}`)).status, 204);
  assert.equal((await app.get(`/api/v1/teammates/milo-brightwater/knowledge/${created.body.id}`)).status, 404);
  assert.equal((await app.get('/api/v1/teammates/milo-brightwater/knowledge/../../x')).status, 404);
});

test('project tags keep knowledge and memory apart', async () => {
  await app.send('POST', '/api/v1/teammates/juno-park/knowledge', { title: 'Acme style guide', project: 'acme', content: 'Acme buttons use the colour teal for checkout.' });
  const other = await app.send('POST', '/api/v1/teammates/juno-park/tasks', { task: 'Pick a colour for the checkout buttons', project: 'globex' });
  assert.deepEqual(other.body.knowledgeUsed, []);
  const acme = await app.send('POST', '/api/v1/teammates/juno-park/tasks', { task: 'Pick a colour for the checkout buttons', project: 'acme' });
  assert.equal(acme.body.knowledgeUsed[0].title, 'Acme style guide');
  assert.equal(acme.body.memoriesAdded[0].project, 'acme');

  const next = await app.send('POST', '/api/v1/teammates/juno-park/tasks', { task: 'Anything else?', project: 'globex' });
  assert.ok(!next.body.memoryUsed.some((m) => m.id === acme.body.memoriesAdded[0].id), 'acme memory is not used for globex work');
  assert.ok((await app.get('/api/v1/meta')).body.projects.includes('acme'));
  assert.equal((await app.send('POST', '/api/v1/teammates/juno-park/tasks', { task: 'x', project: '***' })).status, 400);
});
