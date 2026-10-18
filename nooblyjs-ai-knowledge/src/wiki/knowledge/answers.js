/**
 * @fileoverview Answers from search (NooblyJS Phase 8).
 *
 * Two things live here:
 *
 * 1. The answer when NO AI agent is configured. Asking used to fail outright;
 *    now the top sources' own sentences are the answer, cited by number like a
 *    model's would be, and it says plainly that no model wrote it. Offline
 *    tests and a fresh install both rely on this.
 *
 * 2. What an answer's SOURCES are to the rest of NooblyJS: a knowledge link the
 *    Product Factory can keep on a spec ({ id, title, kind, detail }).
 *
 * Pure except for `readDocument`, which the caller supplies.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-10-10
 */

'use strict';

const MAX_SOURCES = 3;
const MAX_PASSAGE_CHARS = 320;
const NO_MODEL_NOTE = 'No model is configured here, so this is what the sources say, not a written answer.';

const STOP = new Set(('a an and are as at be but by can do does for from has have how i if in into is it its me my no not of on or our so than that the ' +
  'their them then there these they this to was we were what when where which who why will with you your').split(' '));

const terms = (text) => String(text || '').toLowerCase().match(/[a-z0-9][a-z0-9.-]*/g)?.filter((w) => w.length > 1 && !STOP.has(w)) || [];

/** Drop what is not prose: fenced blocks, tables, headings' markers, quotes, emphasis, links' targets. */
function plainText(markdown) {
  return String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^ {4}.*$/gm, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/^\s*>.*$/gm, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const META_LINE = /^(type|owner|reviewed|source|period|status|decided|repository|branch):/i;

/** A document's sentences. A paragraph break ends a sentence too, and "Type: … · Owner: …" lines are not prose. */
function sentencesOf(markdown) {
  const out = [];
  // Fenced blocks go first: a blank line inside one must not split it into "paragraphs".
  const body = String(markdown || '').replace(/```[\s\S]*?```/g, '\n\n');
  for (const paragraph of body.split(/\r?\n\s*\r?\n/)) {
    if (META_LINE.test(paragraph.trim())) continue;
    const text = plainText(paragraph);
    for (const s of text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || []) if (s.trim().length > 20) out.push(s.trim());
  }
  return out;
}

/** The sentences of a document that share the most words with the question: up to two, in document order. */
function bestPassage(question, markdown) {
  const wanted = new Set(terms(question));
  const sentences = sentencesOf(markdown);
  if (!sentences.length) return '';
  const scored = sentences.map((text, index) => ({ text, index, score: new Set(terms(text).filter((w) => wanted.has(w))).size }));
  const top = [...scored].sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 2).filter((s, i) => i === 0 || s.score > 0);
  let passage = top.sort((a, b) => a.index - b.index).map((s) => s.text).join(' ');
  if (passage.length > MAX_PASSAGE_CHARS) passage = `${passage.slice(0, MAX_PASSAGE_CHARS - 1).replace(/\s+\S*$/, '')}…`;
  return passage;
}

/** A page's title: its first heading, else its file name without the extension. */
function titleOf(markdown, filePath) {
  const heading = /^#\s+(.+)$/m.exec(String(markdown || ''));
  if (heading) return heading[1].trim();
  return String(filePath || '').split('/').pop().replace(/\.[^.]+$/, '');
}

/**
 * @param {string} question
 * @param {Array<{ spaceName: string, path: string }>} hits - visible search hits, best first
 * @param {(spaceName: string, path: string) => Promise<string|null>} readDocument
 * @return {Promise<{ response: string, sources: Array }>}
 */
async function passageAnswer(question, hits, readDocument) {
  const sources = [];
  const parts = [];
  for (const hit of hits) {
    if (sources.length >= MAX_SOURCES) break;
    const filePath = hit.relativePath || hit.path;
    if (!/\.(md|markdown)$/i.test(filePath || '')) continue;
    const content = await readDocument(hit.spaceName, filePath);
    if (!content) continue;
    const passage = bestPassage(question, content);
    if (!passage) continue;
    sources.push({ index: sources.length + 1, path: filePath, spaceName: hit.spaceName, title: titleOf(content, filePath), cached: false });
    parts.push(`${passage} [${sources.length}]`);
  }
  if (!sources.length) return { response: 'Nothing in the wiki matches that question.', sources: [] };
  return { response: `${NO_MODEL_NOTE}\n\n${parts.join('\n\n')}`, sources };
}

const KIND_BY_FOLDER = [[/^runbooks?$/i, 'runbook'], [/^(decisions?|adrs?)$/i, 'adr'], [/^customer insights?$/i, 'customer-insight']];

/** What kind of knowledge a page is, from the folder it sits in. */
function kindOf(filePath) {
  const top = String(filePath || '').split('/')[0];
  return KIND_BY_FOLDER.find(([pattern]) => pattern.test(top))?.[1] || 'doc';
}

/** An id for a page that other NooblyJS apps can keep: letters, digits, dots and hyphens, at most 80. */
function knowledgeId(spaceName, filePath) {
  const part = (text) => String(text).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const id = [part(spaceName), ...String(filePath || '').split('/').map(part)].filter(Boolean).join('.');
  return id.slice(0, 80).replace(/[.-]+$/, '') || 'page';
}

/** A source as a link on a spec. ADRs are known by their number ("ADR-013"), so that is their id and title. */
function linkFor(source) {
  const kind = kindOf(source.path);
  const title = String(source.title || '').trim() || source.path;
  const adr = kind === 'adr' && /^(ADR-\d+)\s*[·:-]\s*(.+)$/i.exec(title);
  if (adr) return { id: adr[1].toUpperCase(), title: adr[2].trim().slice(0, 200), kind, detail: source.spaceName.slice(0, 200) };
  return { id: knowledgeId(source.spaceName, source.path), title: title.slice(0, 200), kind, detail: source.spaceName.slice(0, 200) };
}

module.exports = { passageAnswer, bestPassage, plainText, titleOf, kindOf, knowledgeId, linkFor, MAX_SOURCES, NO_MODEL_NOTE };
