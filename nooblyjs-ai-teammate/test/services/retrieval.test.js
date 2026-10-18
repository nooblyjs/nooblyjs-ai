// services/retrieval.js: tokenising, BM25, chunking, retrieval and skill selection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bm25, chunk, normalizeProject, retrieve, selectSkills, tokenize } from '../../src/services/retrieval.js';

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
