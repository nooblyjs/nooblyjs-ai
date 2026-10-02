// Lexical retrieval (BM25) for knowledge passages and skill selection. No embeddings, no extra model calls.
import { badRequest } from '../util/errors.js';

// Passages scoring below this share of the best match are dropped (e.g. ones that only match the document title).
const RELATIVE_CUTOFF = 0.35;

const STOPWORDS = new Set(
  'a an and are as at be but by can do does for from has have how i if in into is it its me my no not of on or our please so than that the their them then there these they this to up us was we what when where which who why will with would you your'.split(' '),
);

/** Lowercased word tokens without stopwords; plurals are folded so "invoices" matches "invoice" and "policies" "policy". */
export function tokenize(text) {
  return (String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map((w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && /[^su]s$/.test(w) ? w.slice(0, -1) : w));
}

export const estimateTokens = (text) => Math.ceil(String(text ?? '').length / 4);

/** BM25 over pre-tokenized documents. */
export class Bm25 {
  constructor(docs, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = docs.map((tokens) => {
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      return { tf, length: tokens.length };
    });
    this.avg = this.docs.reduce((s, d) => s + d.length, 0) / (this.docs.length || 1) || 1;
    const df = new Map();
    for (const d of this.docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const n = this.docs.length;
    this.idf = new Map([...df].map(([t, f]) => [t, Math.log(1 + (n - f + 0.5) / (f + 0.5))]));
  }

  score(queryTokens, i) {
    const d = this.docs[i];
    let s = 0;
    for (const q of new Set(queryTokens)) {
      const f = d.tf.get(q);
      if (!f) continue;
      s += this.idf.get(q) * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * d.length) / this.avg)));
    }
    return s;
  }
}

/** Splits a document into passages of roughly `size` characters along paragraph boundaries, keeping the nearest heading. */
export function chunk(doc, { size = 900 } = {}) {
  const passages = [];
  let heading = '';
  let current = [];
  let length = 0;
  const flush = () => {
    const text = current.join('\n\n').trim();
    if (text) passages.push({ docId: doc.id, title: doc.title, project: doc.project, heading, index: passages.length + 1, text });
    current = [];
    length = 0;
  };
  for (const block of String(doc.content ?? '').split(/\n\s*\n/)) {
    const para = block.trim();
    if (!para) continue;
    const h = /^#{1,6}\s+(.+)$/.exec(para.split('\n')[0]);
    if (h) {
      flush();
      heading = h[1].trim();
    }
    if (length + para.length > size && current.length) flush();
    // Very long paragraphs are split on sentence boundaries (or hard-cut when a sentence is itself too long).
    if (para.length > size * 1.5) {
      flush();
      let piece = '';
      for (const sentence of para.split(/(?<=[.!?])\s+/)) {
        for (let s = sentence; s; s = s.slice(size)) {
          const part = s.slice(0, size);
          if (piece && piece.length + part.length + 1 > size) {
            current.push(piece);
            flush();
            piece = '';
          }
          piece = piece ? `${piece} ${part}` : part;
          if (s.length <= size) break;
        }
      }
      if (piece) {
        current.push(piece);
        flush();
      }
      continue;
    }
    current.push(para);
    length += para.length;
  }
  flush();
  return passages;
}

/** Items tagged with a project are only used for tasks on that project; untagged items are shared. */
export const projectAllows = (itemProject, taskProject) => !itemProject || itemProject === taskProject;

const PROJECT = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** Project tags are slugs: "Acme Corp" becomes "acme-corp". Empty means no project. */
export function normalizeProject(value) {
  if (value == null || String(value).trim() === '') return undefined;
  const slug = String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!PROJECT.test(slug)) throw badRequest('project must be a short name using letters, numbers and dashes', { project: 'Letters, numbers and dashes' });
  return slug;
}

/**
 * Best passages for a query, within a token budget. Returns [{ docId, title, heading, index, text, score }].
 * Passages are scored on their own heading and text; a matching document title adds a bonus. Only when no passage
 * text matches at all do title matches alone count, so "summarise the Initech notes" still finds that document.
 */
export function retrieve(docs, query, { project, budgetTokens = 1500, maxPassages = 6 } = {}) {
  const passages = docs.filter((d) => projectAllows(d.project, project)).flatMap((d) => chunk(d));
  if (!passages.length) return [];
  const q = tokenize(query);
  if (!q.length) return [];
  const body = new Bm25(passages.map((p) => tokenize(`${p.heading} ${p.text}`)));
  const titles = new Bm25(passages.map((p) => tokenize(p.title)));
  const scored = passages.map((p, i) => ({ ...p, body: body.score(q, i), titleScore: titles.score(q, i) }));
  const matching = scored.some((p) => p.body > 0) ? scored.filter((p) => p.body > 0) : scored.filter((p) => p.titleScore > 0 && p.index === 1);
  const ranked = matching
    .map((p) => ({ ...p, score: p.body + 0.5 * p.titleScore }))
    .sort((a, b) => b.score - a.score)
    .filter((p, _, all) => p.score >= all[0].score * RELATIVE_CUTOFF)
    .map(({ body: _b, titleScore: _t, ...p }) => p);
  const out = [];
  let used = 0;
  for (const p of ranked) {
    const cost = estimateTokens(p.text);
    if (out.length >= maxPassages) break;
    if (used + cost > budgetTokens && out.length) continue;
    out.push({ ...p, score: Math.round(p.score * 100) / 100 });
    used += cost;
  }
  return out;
}

/**
 * Picks the skills relevant to a task. Teammates with only a few skills always get all of them.
 * Otherwise the top-scoring skills are used, falling back to the strongest ones when nothing matches.
 */
export function selectSkills(skills, task, { keepAllUpTo = 4, max = 3 } = {}) {
  if (skills.length <= keepAllUpTo) return { skills, reason: 'all' };
  const q = tokenize(task);
  const index = new Bm25(skills.map((s) => tokenize(`${s.name} ${s.name} ${s.description ?? ''} ${s.instructions ?? ''}`)));
  const scored = skills.map((s, i) => ({ s, score: index.score(q, i) })).sort((a, b) => b.score - a.score || (b.s.level ?? 0) - (a.s.level ?? 0));
  const best = scored[0]?.score ?? 0;
  const matched = scored.filter((x) => x.score > 0 && x.score >= best * RELATIVE_CUTOFF).slice(0, max).map((x) => x.s);
  if (matched.length) return { skills: matched, reason: 'matched' };
  return { skills: [...skills].sort((a, b) => (b.level ?? 0) - (a.level ?? 0)).slice(0, max), reason: 'strongest' };
}
