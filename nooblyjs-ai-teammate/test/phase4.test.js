import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { startApp } from './helpers.js';
import { Bm25, chunk, normalizeProject, retrieve, selectSkills, tokenize } from '../src/services/retrieval.js';
import { FsStore } from '../src/store/fs-store.js';
import { MemoryRepo } from '../src/repos/memory.js';

// ---------- Unit ----------

test('tokenize drops stopwords and folds simple plurals', () => {
  assert.deepEqual(tokenize('What are the refund policies for invoices?'), ['refund', 'policy', 'invoice']);
});

test('BM25 ranks the document that matches the rarer terms', () => {
  const index = new Bm25([tokenize('refund policy for annual plans'), tokenize('annual offsite planning'), tokenize('office plants')]);
  const q = tokenize('annual refund');
  assert.ok(index.score(q, 0) > index.score(q, 1));
  assert.equal(index.score(q, 2), 0);
});

test('chunking keeps headings and never loses text', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about pricing tiers.`).join(' ');
  const doc = { id: 'doc_1', title: 'Pricing', content: `# Overview\n\nShort intro.\n\n## Tiers\n\n${long}\n\n## Discounts\n\nNon-profits get 30% off.` };
  const parts = chunk(doc, { size: 300 });
  assert.ok(parts.length > 3);
  assert.equal(parts.at(-1).heading, 'Discounts');
  for (let i = 0; i < 40; i++) assert.ok(parts.some((p) => p.text.includes(`Sentence number ${i} `)), `sentence ${i}`);
  assert.ok(parts.every((p) => p.text.length <= 320));
});

test('retrieval respects the project tag and the token budget', () => {
  const docs = [
    { id: 'doc_a', title: 'Acme refunds', project: 'acme', content: 'Acme customers get refunds within 30 days.' },
    { id: 'doc_g', title: 'Globex refunds', project: 'globex', content: 'Globex customers get refunds within 14 days.' },
    { id: 'doc_s', title: 'Shared refunds', content: 'Every refund needs a ticket number. '.repeat(30) },
  ];
  assert.deepEqual(retrieve(docs, 'refunds', { project: 'acme' }).map((p) => p.docId).sort(), ['doc_a', 'doc_s']);
  assert.deepEqual(retrieve(docs, 'refunds').map((p) => p.docId), ['doc_s']);
  assert.equal(retrieve(docs, 'refunds', { project: 'acme', budgetTokens: 20 }).length, 1);
  assert.deepEqual(retrieve(docs, 'zebra crossings'), []);
});

test('a passage that only matches the document title is not used, unless nothing else matches', () => {
  const docs = [{ id: 'doc_i', title: 'Initech account notes', content: '# Initech\n\nInitech renews in May.\n\n# Office\n\nThe stapler is red.' }];
  assert.deepEqual(retrieve(docs, 'Prepare the Initech renewal brief').map((p) => p.heading), ['Initech']);
  const untitled = [{ id: 'doc_n', title: 'Globex notes', content: 'Renewal is in March.\n\nThe buyer prefers email.' }];
  assert.deepEqual(retrieve(untitled, 'Summarise the Globex notes').map((p) => p.index), [1]);
});

test('project tags are normalised to slugs', () => {
  assert.equal(normalizeProject('Acme Corp'), 'acme-corp');
  assert.equal(normalizeProject(''), undefined);
  assert.throws(() => normalizeProject('!!!'), /project/);
});

test('skill selection keeps small skill sets and picks relevant ones from large sets', () => {
  const few = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  assert.equal(selectSkills(few, 'anything').skills.length, 2);
  const many = ['Ticket triage', 'Refund policy', 'Tone matching', 'SQL', 'Scheduling', 'Brand voice'].map((name, i) => ({ id: `s${i}`, name, description: '', level: i === 3 ? 3 : 2 }));
  const picked = selectSkills(many, 'Check this refund against the refund policy');
  assert.equal(picked.reason, 'matched');
  assert.deepEqual(picked.skills.map((s) => s.name), ['Refund policy']);
  const fallback = selectSkills(many, 'zzz');
  assert.equal(fallback.reason, 'strongest');
  assert.equal(fallback.skills[0].name, 'SQL');
});

test('memory over the cap merges old items instead of deleting, and never touches pinned items', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-mem-'));
  const repo = new MemoryRepo(new FsStore(dir));
  const t = { id: 'tess', memoryMode: 'personal', memoryCap: 0 };
  const day = (n) => `2026-09-${String(n).padStart(2, '0')}T10:00:00Z`;
  const pinned = await repo.add(t, { kind: 'fact', text: 'Oldest but pinned', learnedAt: day(1) });
  await repo.setPinned(t, pinned.id, true);
  for (let i = 2; i <= 6; i++) await repo.add(t, { kind: 'fact', text: `Note ${i}`, learnedAt: day(i), source: `wk_${i}` });
  await repo.add(t, { kind: 'fact', text: 'Acme only', learnedAt: day(7), project: 'acme' });

  t.memoryCap = 4;
  await repo.enforceCap(t);
  const items = await repo.list(t);
  assert.equal(items.length, 4);
  assert.ok(items.some((i) => i.id === pinned.id && i.pinned));
  const merged = items.find((i) => i.mergedFrom);
  assert.ok(merged, 'a merged note exists');
  assert.match(merged.text, /Note 2 · Note 3 · Note 4 · Note 5/);
  assert.deepEqual(merged.sources, ['wk_2', 'wk_3', 'wk_4', 'wk_5']);
  assert.ok(items.some((i) => i.text === 'Acme only' && i.project === 'acme'), 'project notes are not merged with shared ones');
});

// ---------- API ----------

let app;
before(async () => {
  app = await startApp();
});
after(() => app.close());

test('knowledge documents can be added, validated, edited and removed', async () => {
  const pdf = await app.send('POST', '/api/teammates/milo-brightwater/knowledge', { filename: 'policy.pdf', content: 'x' });
  assert.equal(pdf.status, 422);
  assert.ok(pdf.body.error.details.filename);
  assert.equal((await app.send('POST', '/api/teammates/milo-brightwater/knowledge', { title: 'Empty', content: '   ' })).status, 422);

  const created = await app.send('POST', '/api/teammates/milo-brightwater/knowledge', { filename: 'refund-policy.md', content: '# Refunds\n\nAnnual plans can be refunded within 30 days.', project: 'Acme Corp' });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, 'refund policy');
  assert.equal(created.body.project, 'acme-corp');

  const listed = await app.get('/api/teammates/milo-brightwater/knowledge');
  assert.equal(listed.body.docs.length, 1);
  assert.equal(listed.body.docs[0].content, undefined);

  const edited = await app.send('PATCH', `/api/teammates/milo-brightwater/knowledge/${created.body.id}`, { title: 'Refund policy', project: '' });
  assert.equal(edited.body.title, 'Refund policy');
  assert.equal(edited.body.project, undefined);
  assert.match((await app.get(`/api/teammates/milo-brightwater/knowledge/${created.body.id}`)).body.content, /30 days/);

  assert.equal((await app.send('DELETE', `/api/teammates/milo-brightwater/knowledge/${created.body.id}`)).status, 204);
  assert.equal((await app.get(`/api/teammates/milo-brightwater/knowledge/${created.body.id}`)).status, 404);
  assert.equal((await app.get('/api/teammates/milo-brightwater/knowledge/../../x')).status, 404);
});

test('an answer cites an uploaded document and the work item lists the documents and memories used', async () => {
  const doc = await app.send('POST', '/api/teammates/wren-sato/knowledge', {
    title: 'Globex account notes',
    content: '# Globex\n\nGlobex renews in March. Their buyer is Dana Ruiz, who prefers short briefs.\n\n# Unrelated\n\nThe office plants need water on Fridays.',
  });
  const res = await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'Prepare a brief for the Globex renewal' });
  assert.equal(res.status, 200);
  assert.match(res.body.output, /\[Globex account notes\]/);
  assert.deepEqual(res.body.knowledgeUsed.map((k) => [k.docId, k.heading]), [[doc.body.id, 'Globex']]);
  assert.ok(res.body.memoryUsed.length >= 1);

  const work = await app.get(`/api/teammates/wren-sato/work/${res.body.workId}`);
  assert.equal(work.body.knowledgeUsed[0].title, 'Globex account notes');
  assert.ok(work.body.memoryUsed.some((m) => /opening line/.test(m.text)));
  assert.match(work.body.thread, /^thr_/);
});

test('project tags keep knowledge and memory apart', async () => {
  await app.send('POST', '/api/teammates/juno-park/knowledge', { title: 'Acme style guide', project: 'acme', content: 'Acme buttons use the colour teal for checkout.' });
  const other = await app.send('POST', '/api/teammates/juno-park/tasks', { task: 'Pick a colour for the checkout buttons', project: 'globex' });
  assert.deepEqual(other.body.knowledgeUsed, []);
  const acme = await app.send('POST', '/api/teammates/juno-park/tasks', { task: 'Pick a colour for the checkout buttons', project: 'acme' });
  assert.equal(acme.body.knowledgeUsed[0].title, 'Acme style guide');
  assert.equal(acme.body.memoriesAdded[0].project, 'acme');

  const next = await app.send('POST', '/api/teammates/juno-park/tasks', { task: 'Anything else?', project: 'globex' });
  assert.ok(!next.body.memoryUsed.some((m) => m.id === acme.body.memoriesAdded[0].id), 'acme memory is not used for globex work');
  assert.ok((await app.get('/api/meta')).body.projects.includes('acme'));
  assert.equal((await app.send('POST', '/api/teammates/juno-park/tasks', { task: 'x', project: '***' })).status, 400);
});

test('follow-ups continue a thread with its history and project', async () => {
  const first = await app.send('POST', '/api/teammates/otis-fern/tasks', { task: 'Dedupe the CRM export', project: 'acme' });
  const follow = await app.send('POST', '/api/teammates/otis-fern/tasks', { task: 'Now do the same for leads', thread: first.body.thread });
  assert.equal(follow.status, 200);
  assert.equal(follow.body.thread, first.body.thread);
  assert.equal(follow.body.project, 'acme');
  assert.match(follow.body.output, /Following up on our earlier conversation \(1 earlier turn\)/);
  const third = await app.send('POST', '/api/teammates/otis-fern/tasks', { task: 'And contacts?', thread: first.body.thread });
  assert.match(third.body.output, /2 earlier turns/);

  assert.equal((await app.send('POST', '/api/teammates/otis-fern/tasks', { task: 'x', thread: 'thr_nope_000000' })).status, 404);
  assert.equal((await app.send('POST', '/api/teammates/otis-fern/tasks', { task: 'x', thread: '../etc' })).status, 400);
  assert.equal((await app.send('POST', '/api/teammates/otis-fern/tasks', { task: 'x', thread: first.body.thread, project: 'globex' })).status, 400);
  assert.equal((await app.send('POST', '/api/teammates/wren-sato/tasks', { task: 'x', thread: first.body.thread })).status, 404);
});

test('skills are chosen per task, or forced with the skill parameter', async () => {
  const hired = await app.send('POST', '/api/teammates', {
    name: 'Sam Many', role: 'Generalist', model: 'haiku', rate: 4, monthlyCap: 500,
    skills: ['ticket-triage', 'refund-policy', 'tone-matching', 'sql', 'scheduling', 'brand-voice'],
  });
  assert.equal(hired.status, 201);
  const auto = await app.send('POST', `/api/teammates/${hired.body.id}/tasks`, { input: 'Write a query in SQL for churned users' });
  assert.deepEqual(auto.body.skillsUsed, ['sql']);
  const forced = await app.send('POST', `/api/teammates/${hired.body.id}/tasks`, { task: 'Anything', skill: 'scheduling' });
  assert.deepEqual(forced.body.skillsUsed, ['scheduling']);
  assert.equal((await app.send('POST', `/api/teammates/${hired.body.id}/tasks`, { task: 'x', skill: 'react' })).status, 400);
});

test('memory can be pinned, and shared team memory has its own screen data', async () => {
  const { body } = await app.get('/api/teammates/ada-quill/memory');
  const pinned = await app.send('PATCH', `/api/teammates/ada-quill/memory/${body.items.at(-1).id}`, { pinned: true });
  assert.equal(pinned.body.pinned, true);
  assert.equal((await app.get('/api/teammates/ada-quill')).body.memory.pinned, 1);
  assert.equal((await app.send('PATCH', `/api/teammates/ada-quill/memory/${body.items[0].id}`, { pinned: 'yes' })).status, 400);
  const task = await app.send('POST', '/api/teammates/ada-quill/tasks', { task: 'Quick check' });
  assert.equal(task.body.memoryUsed[0].id, pinned.body.id, 'pinned memory goes first');

  await app.send('PATCH', '/api/teammates/pip-okafor', { memoryMode: 'team' });
  const work = await app.send('POST', '/api/teammates/pip-okafor/tasks', { task: 'Book the board dinner' });
  const shared = await app.get('/api/team-memory');
  const item = shared.body.items.find((i) => i.id === work.body.memoriesAdded[0].id);
  assert.equal(item.contributor, 'Pip Okafor');
  assert.equal(item.source, work.body.workId);
  assert.ok(shared.body.members.some((m) => m.id === 'pip-okafor'));
  assert.equal((await app.send('PATCH', `/api/team-memory/${item.id}`, { pinned: true })).body.pinned, true);
  assert.equal((await app.send('DELETE', `/api/team-memory/${item.id}`)).status, 204);
  assert.ok(!(await app.get('/api/team-memory')).body.items.some((i) => i.id === item.id));
});
