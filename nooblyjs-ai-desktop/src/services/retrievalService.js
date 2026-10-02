'use strict';

const documentService = require('./documentService');
const { chunkMarkdown, buildIndex, search } = require('../lib/textIndex');
const { estimate } = require('../lib/tokens');
const logger = require('../lib/logger');

// One index per project, held in memory and rebuilt when the files change.
// Validity is a fingerprint of the documents on disk rather than an explicit
// invalidation call, so edits made outside the app — the whole point of storing
// documents as plain files — are picked up too.
const indexes = new Map();

function invalidate(projectId) {
  indexes.delete(projectId);
}

function fingerprint(documents) {
  return documents
    .map((d) => `${d.path}:${d.size}:${d.updatedAt}`)
    .sort()
    .join('|');
}

async function getIndex(projectId) {
  const documents = await documentService.listDocuments(projectId);
  const stamp = fingerprint(documents);

  const cached = indexes.get(projectId);
  if (cached && cached.stamp === stamp) return cached.index;

  const chunks = [];
  for (const doc of documents) {
    try {
      const { content } = await documentService.readDocument(projectId, doc.path);
      chunks.push(...chunkMarkdown(content, doc.path));
    } catch (err) {
      logger.warn('Skipping unreadable document during indexing', { projectId, path: doc.path });
    }
  }

  const index = buildIndex(chunks);
  indexes.set(projectId, { stamp, index });
  logger.debug('Built document index', { projectId, documents: documents.length, chunks: index.size });
  return index;
}

/** `@path/to/doc.md` or `@"path with spaces.md"` in the message body. */
const MENTION_PATTERN = /@"([^"\n]+\.md)"|@([^\s@"']+\.md)/gi;

function parseMentions(text) {
  const found = new Set();
  for (const match of String(text || '').matchAll(MENTION_PATTERN)) {
    found.add((match[1] || match[2]).replace(/^\/+/, ''));
  }
  return [...found];
}

function formatSource(path, heading, body) {
  const label = heading ? `${path} › ${heading}` : path;
  return `--- ${label} ---\n${body}`;
}

/**
 * Builds the documents block for the system prompt.
 *
 * Explicitly mentioned documents are included whole and take priority; whatever
 * budget remains is filled with the best-matching chunks from everything else.
 * Returns null when there is nothing to add.
 */
async function buildDocumentContext(projectId, { query, mentions = [], tokenBudget }) {
  if (tokenBudget <= 0) return null;

  const blocks = [];
  const sources = [];
  let used = 0;
  const includedDocs = new Set();

  for (const mention of mentions) {
    let doc;
    try {
      doc = await documentService.readDocument(projectId, mention);
    } catch {
      sources.push({ path: mention, kind: 'missing' });
      continue;
    }

    const block = formatSource(doc.path, '', doc.content.trim());
    const cost = estimate(block);
    if (used + cost > tokenBudget) {
      // Too big to include whole — fall back to its best-matching chunks below.
      sources.push({ path: doc.path, kind: 'referenced-truncated' });
      const trimmed = `${doc.content.trim().slice(0, Math.max(0, (tokenBudget - used)) * 3)}\n…[truncated]`;
      if (trimmed.trim().length > 20) {
        blocks.push(formatSource(doc.path, '', trimmed));
        used = tokenBudget;
      }
      includedDocs.add(doc.path);
      break;
    }
    blocks.push(block);
    sources.push({ path: doc.path, kind: 'referenced' });
    includedDocs.add(doc.path);
    used += cost;
  }

  if (used < tokenBudget && query) {
    const index = await getIndex(projectId);
    for (const hit of search(index, query, 8)) {
      if (includedDocs.has(hit.chunk.docPath)) continue;
      const block = formatSource(hit.chunk.docPath, hit.chunk.heading, hit.chunk.text.trim());
      const cost = estimate(block);
      if (used + cost > tokenBudget) continue;
      blocks.push(block);
      sources.push({
        path: hit.chunk.docPath,
        heading: hit.chunk.heading || null,
        kind: 'retrieved',
        score: Number(hit.score.toFixed(3))
      });
      used += cost;
    }
  }

  if (blocks.length === 0) return null;

  return {
    text:
      '# Project documents\n\n' +
      'Excerpts from the documents in this project, provided as reference material. ' +
      'Cite the file path when you rely on one.\n\n' +
      blocks.join('\n\n'),
    sources,
    tokens: used
  };
}

module.exports = { buildDocumentContext, parseMentions, getIndex, invalidate };
