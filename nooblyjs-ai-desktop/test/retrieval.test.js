'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { useTempDataDir, cleanup } = require('./helpers');

const dir = useTempDataDir();
const { bootstrap } = require('../src/storage/bootstrap');
const { createApp } = require('../src/app');
const retrieval = require('../src/services/retrievalService');
const { chunkMarkdown, buildIndex, search } = require('../src/lib/textIndex');

const app = createApp();

test.before(() => bootstrap());
test.after(() => cleanup(dir));

/* ---- chunking and scoring ---- */

test('chunks markdown on its headings', () => {
  const chunks = chunkMarkdown(
    '# Title\n\nIntro text.\n\n## Baud rates\n\nRuns at 4800 baud.\n\n## Checksum\n\nXOR the payload.',
    'doc.md'
  );
  const headings = chunks.map((c) => c.heading);
  assert.deepEqual(headings, ['Title', 'Baud rates', 'Checksum']);
  assert.ok(chunks.every((c) => c.docPath === 'doc.md'));
});

test('splits an oversized section into several chunks', () => {
  const paragraph = `${'word '.repeat(120)}\n\n`;
  const chunks = chunkMarkdown(`# Big\n\n${paragraph.repeat(8)}`, 'big.md');
  assert.ok(chunks.length > 1, 'a long section should not be one giant chunk');
  assert.ok(chunks.every((c) => c.heading === 'Big'));
});

test('empty and heading-free documents do not break chunking', () => {
  assert.deepEqual(chunkMarkdown('', 'a.md'), []);
  assert.deepEqual(chunkMarkdown('   \n\n  ', 'a.md'), []);
  assert.equal(chunkMarkdown('Just a sentence, no heading.', 'a.md').length, 1);
});

test('ranks the matching chunk above unrelated ones', () => {
  const index = buildIndex([
    ...chunkMarkdown('# Baud rates\n\nAIS receivers use 38400 baud.', 'baud.md'),
    ...chunkMarkdown('# Roadmap\n\nShip the parser in Q3.', 'roadmap.md'),
    ...chunkMarkdown('# Licence\n\nMIT licensed.', 'licence.md')
  ]);
  const hits = search(index, 'what baud rate do AIS receivers use?');
  assert.ok(hits.length > 0);
  assert.equal(hits[0].chunk.docPath, 'baud.md');
});

test('a query matching nothing returns no hits', () => {
  const index = buildIndex(chunkMarkdown('# Cats\n\nCats purr.', 'cats.md'));
  assert.deepEqual(search(index, 'quantum chromodynamics'), []);
});

/* ---- mention parsing ---- */

test('parses @mentions, including quoted paths with spaces', () => {
  assert.deepEqual(retrieval.parseMentions('see @notes.md please'), ['notes.md']);
  assert.deepEqual(retrieval.parseMentions('see @"Specs/NMEA checksum.md" ok'), ['Specs/NMEA checksum.md']);
  assert.deepEqual(retrieval.parseMentions('@a.md and @b.md'), ['a.md', 'b.md']);
  assert.deepEqual(retrieval.parseMentions('@a.md twice @a.md'), ['a.md'], 'duplicates collapse');
  assert.deepEqual(retrieval.parseMentions('no mentions here'), []);
  assert.deepEqual(retrieval.parseMentions('an email@example.com is not a mention'), []);
});

/* ---- end to end through the service ---- */

async function seedProject() {
  const { body } = await request(app)
    .post('/api/projects')
    .send({ name: 'RAG', description: 'ctx' })
    .expect(201);
  const project = body.project;
  const base = `/api/projects/${project.id}/documents`;

  await request(app)
    .post(`${base}/documents`)
    .send({ name: 'Baud rates', content: '# Baud rates\n\nAIS receivers commonly use 38400 baud.' })
    .expect(201);
  await request(app)
    .post(`${base}/documents`)
    .send({ name: 'Licence', content: '# Licence\n\nDistributed under the MIT licence.' })
    .expect(201);

  return project;
}

test('retrieves the relevant document for a query', async () => {
  const project = await seedProject();
  const result = await retrieval.buildDocumentContext(project.id, {
    query: 'what baud rate do AIS receivers use?',
    tokenBudget: 2000
  });
  assert.ok(result, 'should return a document block');
  assert.match(result.text, /38400 baud/);
  assert.equal(result.sources[0].path, 'Baud rates.md');
  assert.equal(result.sources[0].kind, 'retrieved');
});

test('an explicitly mentioned document is included whole and marked referenced', async () => {
  const project = await seedProject();
  const result = await retrieval.buildDocumentContext(project.id, {
    query: 'summarise this',
    mentions: ['Licence.md'],
    tokenBudget: 2000
  });
  assert.match(result.text, /MIT licence/);
  assert.equal(result.sources.find((s) => s.path === 'Licence.md').kind, 'referenced');
});

test('a mention of a missing document is reported, not fatal', async () => {
  const project = await seedProject();
  const result = await retrieval.buildDocumentContext(project.id, {
    query: 'baud',
    mentions: ['Nope.md'],
    tokenBudget: 2000
  });
  assert.ok(result.sources.some((s) => s.path === 'Nope.md' && s.kind === 'missing'));
});

test('a project with no documents yields no document block', async () => {
  const { body } = await request(app).post('/api/projects').send({ name: 'Bare' }).expect(201);
  const result = await retrieval.buildDocumentContext(body.project.id, {
    query: 'anything',
    tokenBudget: 2000
  });
  assert.equal(result, null);
});

test('a zero budget yields no document block', async () => {
  const project = await seedProject();
  assert.equal(
    await retrieval.buildDocumentContext(project.id, { query: 'baud', tokenBudget: 0 }),
    null
  );
});

test('retrieval stays within its token budget', async () => {
  const project = await seedProject();
  const result = await retrieval.buildDocumentContext(project.id, {
    query: 'baud licence receivers',
    tokenBudget: 40
  });
  if (result) assert.ok(result.tokens <= 40, `used ${result.tokens} of a 40 token budget`);
});

test('the index reflects an edit without a restart', async () => {
  const project = await seedProject();
  const base = `/api/projects/${project.id}/documents`;

  const before = await retrieval.buildDocumentContext(project.id, {
    query: 'zebra',
    tokenBudget: 2000
  });
  assert.ok(!before || !before.text.includes('zebra'), 'nothing should match yet');

  await request(app)
    .put(`${base}/content`)
    .send({ path: 'Licence.md', content: '# Licence\n\nA zebra crossing appears here.' })
    .expect(200);

  const after = await retrieval.buildDocumentContext(project.id, {
    query: 'zebra crossing',
    tokenBudget: 2000
  });
  assert.match(after.text, /zebra crossing/i);
});
