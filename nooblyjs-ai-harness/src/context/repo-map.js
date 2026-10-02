// Phase 27: A MAP OF THE CODEBASE.
//
// In a big repo the model spends many rounds just finding its way: Glob, Grep,
// Read, Grep again. A repo map puts a compact overview in front of it: the most
// relevant files and the functions/classes they define, one line each:
//
//   src/core/loop.js:
//   │ export async function* runTurn(session, text, { signal } = {})
//   │ export function batchTools(session, toolUses)
//
// Three steps (the approach Aider made popular):
//   1. SYMBOLS: find each file's top-level definitions (here with regular
//      expressions per language; Aider uses tree-sitter parsers)
//   2. RANK: a file matters if other files USE what it defines. That's a graph
//      (file → the files whose symbols it mentions), and PageRank finds the
//      files many important files lean on. Files the task mentions get a boost.
//   3. FIT: add files in rank order until the token budget is used.
import fs from 'node:fs';
import path from 'node:path';
import { listProjectFiles } from '../tools/files.js';
import { estimateTokens } from './tokens.js';

const MAX_FILE_BYTES = 300_000; // bigger files are generated or data: skip them
const MAX_FILES = 5_000;

// ── 1. Symbols ───────────────────────────────────────────────────────────

// Each pattern: a regex for a line that DEFINES something, and which group is its name.
const JS = [
  /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
  /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[\w$]+)\s*=>/,
  /^\s*export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
  // a method inside a class (two-space indent): `  async rewind(turnId, …) {`
  /^ {2}(?:static\s+)?(?:async\s+)?\*?(?!(?:if|for|while|switch|catch|return|function|await|new)\b)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/,
];
const LANGUAGES = {
  js: JS, mjs: JS, cjs: JS, jsx: JS, ts: JS, tsx: JS, mts: JS,
  py: [/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, /^class\s+([A-Za-z_]\w*)/, /^    (?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/, /^type\s+([A-Za-z_]\w*)\s+/],
  rs: [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/],
};

/**
 * Can another file use this definition? Only those count when ranking (a file-local
 * helper called `read` says nothing about which file matters).
 */
const PUBLIC = {
  js: (line) => /^\s*export\b/.test(line) || /^ {2}\S/.test(line), // exported, or a method of a class
  py: (line, name) => !name.startsWith('_'),
  go: (line, name) => /^[A-Z]/.test(name),
  rs: (line) => /^\s*pub\b/.test(line),
};
const publicFor = (extension) => PUBLIC[['py', 'go', 'rs'].includes(extension) ? extension : 'js'];

/** Top-level definitions in one file: [{ name, line, text, isPublic }]. */
export function extractSymbols(source, extension) {
  const patterns = LANGUAGES[extension];
  if (!patterns) return [];
  const symbols = [];
  source.split('\n').forEach((line, i) => {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        symbols.push({ name: match[1], line: i + 1, text: signature(line), isPublic: publicFor(extension)(line, match[1]) });
        break;
      }
    }
  });
  return symbols;
}

/**
 * The definition line, without its body: "export function add(a, b)".
 * The body starts at the "{" after the LAST ")" (a "{" inside the parameters, as in
 * `({ signal } = {})`, is not a body), or after "=>" for arrow functions.
 */
function signature(line) {
  let text = line.trim();
  if (/=>/.test(text) && /^(export\s+)?(const|let)\s/.test(text)) text = text.replace(/=>.*$/, '=>');
  else if (text.includes(')')) text = text.slice(0, text.lastIndexOf(')') + 1) + text.slice(text.lastIndexOf(')') + 1).replace(/\s*\{.*$/, '').replace(/:\s*$/, '');
  else text = text.replace(/\s*\{.*$/, '').replace(/:\s*$/, '');
  return text.slice(0, 160);
}

// ── Reading files, cached by size + modification time ────────────────────

const cache = new Map(); // absolute path → { stamp, symbols, words }

function analyse(full, extension) {
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  const hit = cache.get(full);
  if (hit?.stamp === stamp) return hit;
  const source = fs.readFileSync(full, 'utf8');
  const entry = { stamp, symbols: extractSymbols(source, extension), words: countWords(source) };
  cache.set(full, entry);
  return entry;
}

function countWords(source) {
  const counts = new Map();
  for (const word of source.match(/[A-Za-z_$][\w$]{2,}/g) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

// ── 2. Rank ──────────────────────────────────────────────────────────────

/**
 * PageRank over "file A mentions a symbol file B defines". `boost` (file → weight)
 * personalises it: the random surfer jumps to boosted files more often.
 */
export function rankFiles(files, { boost = new Map(), iterations = 25, damping = 0.85 } = {}) {
  const definedIn = new Map(); // symbol name → files defining it (publicly)
  for (const [file, info] of files) {
    for (const { name, isPublic = true } of info.symbols) {
      if (!isPublic) continue;
      if (!definedIn.has(name)) definedIn.set(name, new Set());
      definedIn.get(name).add(file);
    }
  }
  // How many files mention each word: a name found everywhere ("text", "add") says little
  // about which file you depend on; a rare one ("formatDate") says a lot. (IDF, from search engines.)
  const mentionedIn = new Map();
  for (const info of files.values()) for (const word of info.words.keys()) mentionedIn.set(word, (mentionedIn.get(word) ?? 0) + 1);
  const rarity = (word) => Math.log((files.size + 1) / (mentionedIn.get(word) ?? 1));

  // Edges: file → the files defining names it uses, weighted by count and rarity.
  const edges = new Map(); // file → Map(target → weight)
  for (const [file, info] of files) {
    const out = new Map();
    for (const [word, count] of info.words) {
      const targets = definedIn.get(word);
      if (!targets || targets.size > 3) continue;
      const weight = (Math.sqrt(count) * rarity(word)) / targets.size;
      if (weight <= 0) continue;
      for (const target of targets) {
        if (target === file) continue;
        out.set(target, (out.get(target) ?? 0) + weight);
      }
    }
    edges.set(file, out);
  }
  const names = [...files.keys()];
  const totalBoost = [...boost.values()].reduce((a, b) => a + b, 0);
  const jump = (file) => (totalBoost ? (boost.get(file) ?? 0) / totalBoost : 1 / names.length);
  let rank = new Map(names.map((f) => [f, 1 / names.length]));
  for (let i = 0; i < iterations; i++) {
    const next = new Map(names.map((f) => [f, (1 - damping) * jump(f)]));
    for (const file of names) {
      const out = edges.get(file);
      const total = [...out.values()].reduce((a, b) => a + b, 0);
      if (!total) {
        for (const f of names) next.set(f, next.get(f) + (damping * rank.get(file)) * jump(f)); // nowhere to go: jump
        continue;
      }
      for (const [target, weight] of out) next.set(target, next.get(target) + (damping * rank.get(file) * weight) / total);
    }
    rank = next;
  }
  return rank;
}

// ── 3. Fit ───────────────────────────────────────────────────────────────

/**
 * The repo map, as text, within `maxTokens`.
 * @param {string} cwd
 * @param {{ focus?: string[], maxTokens?: number }} options  focus: file paths or words the task is about
 * @returns {Promise<{ text: string, files: number, shown: number }>}
 */
export async function buildRepoMap(cwd, { focus = [], maxTokens = 2_000 } = {}) {
  const all = (await listProjectFiles(cwd).catch(() => [])).filter((f) => LANGUAGES[path.extname(f).slice(1)]).slice(0, MAX_FILES);
  const files = new Map();
  for (const file of all) {
    const info = analyse(path.join(cwd, file), path.extname(file).slice(1));
    if (info) files.set(file, info);
  }
  if (!files.size) return { text: '', files: 0, shown: 0 };

  // Boost files the task names, and files defining or mentioning the words it uses.
  const boost = new Map();
  for (const item of focus) {
    const asPath = path.relative(cwd, path.resolve(cwd, item));
    if (files.has(asPath)) boost.set(asPath, (boost.get(asPath) ?? 0) + 10);
    for (const [file, info] of files) {
      if (info.symbols.some((s) => s.name === item)) boost.set(file, (boost.get(file) ?? 0) + 5);
      else if (file.includes(item)) boost.set(file, (boost.get(file) ?? 0) + 2);
      else if (info.words.has(item)) boost.set(file, (boost.get(file) ?? 0) + 0.5);
    }
  }
  const rank = rankFiles(files, { boost });
  const ordered = [...files.keys()].filter((f) => files.get(f).symbols.length).sort((a, b) => rank.get(b) - rank.get(a) || a.localeCompare(b));

  const parts = [];
  let used = 0;
  for (const file of ordered) {
    const block = `${file}:\n${files.get(file).symbols.map((s) => `│ ${s.text}`).join('\n')}`;
    const cost = estimateTokens(block);
    if (used + cost > maxTokens) {
      if (parts.length) continue; // try smaller files further down
      parts.push(block.split('\n').slice(0, 20).join('\n') + '\n│ …'); // always show something
      break;
    }
    parts.push(block);
    used += cost;
  }
  return { text: parts.join('\n'), files: files.size, shown: parts.length };
}
