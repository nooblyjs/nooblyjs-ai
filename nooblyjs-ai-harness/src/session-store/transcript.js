// Phase 09: saving conversations so they survive quitting.
//
// Each session is a JSONL file ("JSON Lines": one JSON object per line) in
//   ~/.noobly/projects/<project-folder-slug>/<session-id>.jsonl
//
//   {"type":"meta", ...}        who/what/where: model, provider, system prompt…
//   {"type":"message", ...}     one per message, in order
//   {"type":"turn", ...}        tokens and cost of a finished turn
//   {"type":"history", ...}     after compaction: the whole new (short) history
//
// Why APPEND-ONLY lines instead of rewriting one JSON file?
//   - Writing one line is fast, however long the conversation gets.
//   - If noobly crashes, at most the last line is lost, never the whole file.
//   - The file is a log of what happened, which is great for debugging.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { nooblyHome, projectSlug } from '../util/paths.js';

export function projectDir(cwd, env = process.env) {
  return path.join(nooblyHome(env), 'projects', projectSlug(cwd));
}

/** A new transcript file for a session. Nothing is written until the first message. */
export function createTranscript(cwd, { env = process.env } = {}) {
  const id = crypto.randomUUID();
  return openTranscript(path.join(projectDir(cwd, env), `${id}.jsonl`), id);
}

/** Append to an existing transcript file (used when resuming). */
export function openTranscript(file, id = path.basename(file, '.jsonl')) {
  let started = fs.existsSync(file);
  let meta = null;
  return {
    id,
    file,
    /** Remember the meta line; it's written together with the first real line. */
    setMeta(value) {
      meta = value;
    },
    append(entry) {
      if (started) startOnNewLine(file);
      if (!started) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (meta) fs.appendFileSync(file, JSON.stringify({ type: 'meta', ts: new Date().toISOString(), ...meta }) + '\n');
        started = true;
      }
      fs.appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
    },
  };
}

/**
 * If the file doesn't end with a newline (a crash cut the last line short),
 * add one, so the next entry starts on its own line instead of being glued to
 * the broken one and lost with it.
 */
function startOnNewLine(file) {
  const size = fs.statSync(file).size;
  if (size === 0) return;
  const last = Buffer.alloc(1);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, last, 0, 1, size - 1);
  fs.closeSync(fd);
  if (last[0] !== 0x0a) fs.appendFileSync(file, '\n');
}

/** Read a transcript back into history, meta and totals. Broken lines are skipped. */
export function readTranscript(file) {
  const result = { meta: null, history: [], usage: {}, cost: 0, turns: 0, title: null, traces: [] };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // e.g. half a line written during a crash
    }
    if (entry.type === 'meta') result.meta ??= entry;
    if (entry.type === 'message') {
      result.history.push(entry.message);
      result.title ??= firstUserText(entry.message);
    }
    if (entry.type === 'history') result.history = entry.history;
    if (entry.type === 'turn') {
      for (const [key, value] of Object.entries(entry.usage ?? {})) {
        if (typeof value === 'number') result.usage[key] = (result.usage[key] ?? 0) + value;
      }
      result.cost += entry.cost ?? 0;
      result.turns += 1;
      if (entry.trace) result.traces.push(entry.trace); // Phase 19
    }
  }
  return result;
}

function firstUserText(message) {
  if (message.role !== 'user') return null;
  const text = typeof message.content === 'string' ? message.content : message.content.find((b) => b.type === 'text')?.text;
  if (!text || text.startsWith('<')) return null;
  return text.replace(/\s+/g, ' ').slice(0, 70);
}

/** This project's saved sessions, newest first. */
export function listSessions(cwd, { env = process.env } = {}) {
  const dir = projectDir(cwd, env);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => {
      const file = path.join(dir, name);
      const { title, history, turns } = readTranscript(file);
      return { id: name.slice(0, -'.jsonl'.length), file, title: title ?? '(untitled)', messages: history.length, turns, modified: fs.statSync(file).mtime };
    })
    .filter((session) => session.messages > 0)
    .sort((a, b) => b.modified - a.modified);
}

/** Find a session by (a prefix of) its id, or by its number in the list (1 = newest). */
export function findSession(cwd, idOrNumber, { env } = {}) {
  const sessions = listSessions(cwd, { env });
  if (/^\d+$/.test(idOrNumber) && Number(idOrNumber) <= sessions.length) return sessions[Number(idOrNumber) - 1];
  const matches = sessions.filter((s) => s.id.startsWith(idOrNumber));
  if (matches.length > 1) throw new Error(`"${idOrNumber}" matches ${matches.length} sessions. Use more of the id.`);
  return matches[0] ?? null;
}

/** A short fingerprint of the tool definitions, to notice when they changed between runs. */
export function hashTools(schemas) {
  return crypto.createHash('sha256').update(JSON.stringify(schemas)).digest('hex').slice(0, 16);
}
