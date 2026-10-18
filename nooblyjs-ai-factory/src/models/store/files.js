// @ts-check
// NooblyJS Phase 7: the factory's log as FILES. No database.
//
//   <FACTORY_HOME>/events/2026/10/2026-10-10.yaml     one event per line, appended, never rewritten
//   <FACTORY_HOME>/events/HEAD                        the last seq and where it was written
//   <FACTORY_HOME>/events.lock/                       held while one process appends
//   <FACTORY_HOME>/leases.yaml                        the few live leases (not events: see leases.js)
//
// Each line is a YAML list item whose value is JSON:
//
//   - {"seq":412,"stream":"run:r1","type":"step.finished","data":{…},"at":"2026-10-10T09:14:02.118Z","key":null}
//
// JSON is YAML, so any YAML reader can open a day file, and this module reads it back
// with JSON.parse, one line at a time. The factory's core stays on Node built-ins.
//
// What a database gave us, and what does that job here:
//   - one writer at a time     a LOCK FOLDER. mkdir either creates it or fails, atomically, on every
//                              file system. A process that dies holding it leaves a stale folder,
//                              which the next writer removes after STALE_MS.
//   - a global order           seq, read from HEAD under the lock, plus one
//   - seeing others' appends   HEAD says how far the log has got; a reader that is behind reads
//                              the bytes it hasn't seen
//   - no torn writes           a line counts only once its newline is on disk. A half-written last
//                              line (a crash mid-append) is never read, and is overwritten by nobody:
//                              the next append starts on a fresh line.
import fs from 'node:fs';
import path from 'node:path';

const STALE_MS = 30_000;
const WAIT_MS = 15_000;
const sleeper = new Int32Array(new SharedArrayBuffer(4));
/** Block this thread for a moment (the store is synchronous, like the database it replaces). */
const sleep = (ms) => void Atomics.wait(sleeper, 0, 0, ms);

/** The day file an event belongs in, relative to the events folder: 2026/10/2026-10-10.yaml */
export const dayFile = (at) => `${at.slice(0, 4)}/${at.slice(5, 7)}/${at.slice(0, 10)}.yaml`;
export const formatLine = (event) => `- ${JSON.stringify(event)}\n`;

/**
 * Hold the lock folder while fn runs. Re-entrant within one process (a transaction that appends).
 * @param {{ dir: string, depth: number }} lock
 */
export function withLock(lock, fn) {
  if (lock.depth > 0) {
    lock.depth++;
    try { return fn(); } finally { lock.depth--; }
  }
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock.dir);
      break;
    } catch (error) {
      const code = /** @type {any} */ (error).code;
      if (code === 'ENOENT') { fs.mkdirSync(path.dirname(lock.dir), { recursive: true }); continue; }
      // Windows answers EPERM (not EEXIST) while another process is removing the folder.
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EBUSY') throw error;
      try {
        if (Date.now() - fs.statSync(lock.dir).mtimeMs > STALE_MS) fs.rmdirSync(lock.dir); // its holder died
      } catch { /* released meanwhile */ }
      if (Date.now() - started > WAIT_MS) throw new Error(`The factory's log is locked (${lock.dir}). Another process has held it for over ${WAIT_MS / 1000}s.`);
      sleep(2 + Math.floor(Math.random() * 8));
    }
  }
  lock.depth = 1;
  try {
    return fn();
  } finally {
    lock.depth = 0;
    try { fs.rmdirSync(lock.dir); } catch { /* removed as stale by someone else */ }
  }
}

/** Every day file under the events folder, as relative paths, oldest first. */
export function listDayFiles(root) {
  const out = [];
  const names = (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };
  for (const year of names(root)) {
    if (!/^\d{4}$/.test(year)) continue;
    for (const month of names(path.join(root, year))) {
      for (const file of names(path.join(root, year, month))) if (file.endsWith('.yaml')) out.push(`${year}/${month}/${file}`);
    }
  }
  return out;
}

/**
 * The complete lines of a day file from a byte offset: the events, and the offset after the last newline.
 * @returns {{ events: any[], offset: number }}
 */
export function readFrom(root, file, offset) {
  let fd;
  try {
    fd = fs.openSync(path.join(root, file), 'r');
  } catch {
    return { events: [], offset };
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size <= offset) return { events: [], offset };
    const buffer = Buffer.alloc(size - offset);
    fs.readSync(fd, buffer, 0, buffer.length, offset);
    const end = buffer.lastIndexOf(0x0a); // a line without its newline isn't written yet
    if (end < 0) return { events: [], offset };
    const events = [];
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.startsWith('- ')) continue;
      try { events.push(JSON.parse(line.slice(2))); } catch { /* a torn line from a crash: skip it */ }
    }
    return { events, offset: offset + end + 1 };
  } finally {
    fs.closeSync(fd);
  }
}

/** Append lines to a day file, starting on a fresh line if a crash left the last one unfinished. */
export function appendLines(root, file, text) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  let lead = '';
  try {
    const fd = fs.openSync(full, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      if (size > 0) {
        const last = Buffer.alloc(1);
        fs.readSync(fd, last, 0, 1, size - 1);
        if (last[0] !== 0x0a) lead = '\n';
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch { /* a new file */ }
  fs.appendFileSync(full, lead + text);
}

export function readHead(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'HEAD'), 'utf8'));
  } catch {
    return null;
  }
}

/** Written whole, then renamed into place: a reader sees the old HEAD or the new one, never half. */
export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (error) {
      // Windows refuses a rename while another process has the target open for a read. It is brief.
      if (i >= 50 || !['EPERM', 'EBUSY', 'EACCES'].includes(/** @type {any} */ (error).code)) throw error;
      sleep(2);
    }
  }
}
