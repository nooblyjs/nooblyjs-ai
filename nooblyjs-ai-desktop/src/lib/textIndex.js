'use strict';

// A small lexical search index (BM25 over markdown chunks). Chosen over vector
// embeddings so retrieval stays provider-agnostic: Anthropic has no embeddings
// endpoint, and requiring OpenAI for search would undermine the point of the app.
// It also costs nothing per query and needs no vector store.

const STOPWORDS = new Set(
  ('a an and are as at be but by for from has have he her his i in is it its of on or she that the ' +
    'their them then there these they this to was were what when where which who will with you your')
    .split(' ')
);

const K1 = 1.5;
const B = 0.75;

function tokenize(text) {
  const tokens = [];
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || raw.length > 40) continue;
    if (STOPWORDS.has(raw)) continue;
    // Crude singularisation so "sentence" matches "sentences".
    tokens.push(raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw);
  }
  return tokens;
}

const TARGET_CHUNK_CHARS = 1200;
const MIN_CHUNK_CHARS = 200;

/**
 * Splits markdown on headings first so chunks follow the author's own structure,
 * then packs and splits to keep them near a workable size.
 */
function chunkMarkdown(text, docPath) {
  const lines = String(text || '').split('\n');
  const sections = [];
  let heading = '';
  let buffer = [];

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ heading, body });
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[2].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();

  if (sections.length === 0) {
    const body = String(text || '').trim();
    if (!body) return [];
    sections.push({ heading: '', body });
  }

  const chunks = [];
  for (const section of sections) {
    if (section.body.length <= TARGET_CHUNK_CHARS) {
      chunks.push({ docPath, heading: section.heading, text: section.body });
      continue;
    }
    // Split oversized sections on paragraph boundaries.
    let current = [];
    let size = 0;
    for (const paragraph of section.body.split(/\n{2,}/)) {
      if (size + paragraph.length > TARGET_CHUNK_CHARS && size >= MIN_CHUNK_CHARS) {
        chunks.push({ docPath, heading: section.heading, text: current.join('\n\n') });
        current = [];
        size = 0;
      }
      current.push(paragraph);
      size += paragraph.length + 2;
    }
    if (current.length) chunks.push({ docPath, heading: section.heading, text: current.join('\n\n') });
  }

  return chunks.filter((c) => c.text.trim().length > 0);
}

function buildIndex(chunks) {
  const docs = chunks.map((chunk) => {
    // The heading is repeated so a section title carries weight in matching.
    const tokens = tokenize(`${chunk.heading} ${chunk.heading} ${chunk.text}`);
    const frequencies = new Map();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
    return { chunk, frequencies, length: tokens.length };
  });

  const documentFrequency = new Map();
  for (const doc of docs) {
    for (const term of doc.frequencies.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  const averageLength = docs.length ? docs.reduce((sum, d) => sum + d.length, 0) / docs.length : 0;
  return { docs, documentFrequency, averageLength, size: docs.length };
}

function search(index, query, limit = 6) {
  if (!index || index.size === 0) return [];
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const total = index.docs.length;
  const scored = index.docs.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const frequency = doc.frequencies.get(term);
      if (!frequency) continue;
      const df = index.documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const norm = 1 - B + (B * doc.length) / (index.averageLength || 1);
      score += idf * ((frequency * (K1 + 1)) / (frequency + K1 * norm));
    }
    return { chunk: doc.chunk, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

module.exports = { tokenize, chunkMarkdown, buildIndex, search, TARGET_CHUNK_CHARS };
