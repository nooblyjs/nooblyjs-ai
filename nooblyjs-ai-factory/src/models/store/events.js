// @ts-check
// Phase F05: THE EVENT LOG. The only thing the factory ever writes.
//
//   store.append('run:r1', 'step.finished', { runId: 'r1', step: 'build', result })
//
// Everything that happens is appended as an event; nothing is ever updated or
// deleted. Current state (runs, items…) is DERIVED from the log by projections.
//
// Why is "append, then derive" easier to make crash-safe than "update rows"?
//   - One write per change: the event's line is appended, and the tables are derived
//     from it. A crash leaves the line or no line, never half a change.
//   - Nothing is overwritten, so nothing is lost: you can always ask "what
//     happened, in what order?" (that's `factory logs`, and an audit trail).
//   - State can be rebuilt from scratch at any time.
//
// IDEMPOTENCY KEYS: an event may carry a unique `key`. Appending a second event
// with the same key does nothing and returns null. That turns "did I already
// do this?" into a rule of the store instead of a hope.
//
// seq is the global order. Readers ask for "seq > last seen".
//
// NooblyJS Phase 7: the log is FILES (daily YAML streams, see files.js), not SQLite. The
// tables are in memory, replayed from the log when the store opens. Other processes
// may append to the same folder (`factory submit` next to NooblyJS): every append and
// every read first catches up with what they wrote.
import path from 'node:path';
import fs from 'node:fs';
import { isoNow, systemClock } from '../../utils/clock.js';
import { factoryHome } from '../../utils/paths.js';
import { appendLines, dayFile, formatLine, listDayFiles, readFrom, readHead, withLock, writeAtomic } from './files.js';
import { applyProjections, newTables, rebuildProjections, PROJECTIONS } from './projections.js';

/** @typedef {import('./projections.js').FactoryEvent} FactoryEvent */

const TABLES = new Set(PROJECTIONS.map((p) => p.table));

/**
 * @param {{ env?: NodeJS.ProcessEnv, file?: string, clock?: import('../../utils/clock.js').Clock }} [options]
 *   file ':memory:' for a throw-away store that touches no disk
 */
export function openStore({ env = process.env, file, clock = systemClock } = {}) {
  const memory = file === ':memory:';
  const home = memory ? null : factoryHome(env);
  const root = home ? path.join(home, 'events') : '';
  const lock = { dir: home ? path.join(home, 'events.lock') : '', depth: 0 };
  const locked = (fn) => (memory ? fn() : withLock(lock, fn));

  /** @type {FactoryEvent[]} every event, in seq order */
  const log = [];
  const keys = new Set();
  const tables = newTables();
  /** @type {Map<string, number>} how many bytes of each day file have been read */
  const offsets = new Map();
  let lastSeq = 0;
  /** @type {Map<string, any>} leases, in memory only for a ':memory:' store */
  const memoryLeases = new Map();

  /** @type {Set<(e: FactoryEvent) => void>} */
  const listeners = new Set();
  const announce = (events) => {
    for (const e of events) for (const fn of listeners) fn(e);
  };
  /** The open transaction, if any: what it appended and how to take it back. */
  /** @type {{ events: FactoryEvent[], undo: any[], keys: string[] } | null} */
  let tx = null;

  /** Take in events another process wrote (already in seq order within a file). */
  function absorb(events) {
    events.sort((a, b) => a.seq - b.seq);
    for (const e of events) {
      if (e.seq <= lastSeq) continue;
      log.push(e);
      if (e.key) keys.add(e.key);
      applyProjections(tables, e);
      lastSeq = e.seq;
    }
  }

  /**
   * Catch up with the files. Cheap when nothing changed: one small read of HEAD. `sure` (under
   * the lock, before writing) also checks the files themselves, in case a writer died between
   * its append and its HEAD.
   */
  function refresh(sure = false) {
    if (memory) return;
    const head = readHead(root);
    if (!sure && (!head || head.seq <= lastSeq)) return;
    const fresh = [];
    const files = sure || !head || !offsets.has(head.file) ? listDayFiles(root) : [head.file];
    for (const name of files) {
      const { events, offset } = readFrom(root, name, offsets.get(name) ?? 0);
      offsets.set(name, offset);
      fresh.push(...events);
    }
    if (fresh.length) absorb(fresh);
  }

  /** Write what a transaction appended: its lines, then HEAD. Called under the lock. */
  function commit(events) {
    if (memory || !events.length) return;
    /** @type {Map<string, string>} */
    const byFile = new Map();
    for (const e of events) byFile.set(dayFile(e.at), (byFile.get(dayFile(e.at)) ?? '') + formatLine(e));
    for (const [name, text] of byFile) {
      appendLines(root, name, text);
      offsets.set(name, fs.statSync(path.join(root, name)).size);
    }
    const last = /** @type {FactoryEvent} */ (events.at(-1));
    writeAtomic(path.join(root, 'HEAD'), JSON.stringify({ seq: last.seq, file: dayFile(last.at) }));
  }

  /**
   * Run fn as one unit under the lock. Everything it appends is written together at the end, or,
   * if it throws, taken back: no line, no row, and nobody hears of it.
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  function transaction(fn) {
    if (tx) return fn(); // already inside one: join it
    return locked(() => {
      refresh(true);
      const mine = (tx = { events: [], undo: [], keys: [] });
      let result;
      try {
        result = fn();
        commit(mine.events);
      } catch (error) {
        for (const [table, id, before] of mine.undo.reverse()) {
          const rows = /** @type {Map<string, any>} */ (tables.get(table));
          if (before) rows.set(id, before);
          else rows.delete(id);
        }
        for (const key of mine.keys) keys.delete(key);
        log.length -= mine.events.length;
        lastSeq = log.at(-1)?.seq ?? 0;
        tx = null;
        throw error;
      }
      tx = null;
      // Listeners hear about events only AFTER they are written: never about something that was taken back.
      announce(mine.events);
      return result;
    });
  }

  const table = (name) => {
    if (!TABLES.has(name)) throw new Error(`There is no projection table "${name}".`);
    return /** @type {Map<string, { data: any, seq: number }>} */ (tables.get(name));
  };

  /** The live leases, read from disk (or memory), changed by fn, and written back. Under the lock. */
  function leases(fn) {
    return locked(() => {
      if (memory) return fn(memoryLeases);
      const file = path.join(/** @type {string} */ (home), 'leases.yaml');
      /** @type {Map<string, any>} */
      const map = new Map();
      try {
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line.startsWith('- ')) { const l = JSON.parse(line.slice(2)); map.set(l.runId, l); }
      } catch { /* no leases yet */ }
      const before = JSON.stringify([...map]);
      const result = fn(map);
      if (JSON.stringify([...map]) !== before) writeAtomic(file, [...map.values()].map(formatLine).join(''));
      return result;
    });
  }

  refresh(true);

  const store = {
    env,

    /**
     * Append one event (and update projections) as one unit.
     * @param {string} stream  @param {string} type  @param {object} data
     * @param {{ key?: string }} [options]
     * @returns {FactoryEvent | null}  null when an event with this key already exists
     */
    append(stream, type, data, { key } = {}) {
      return transaction(() => {
        if (key && keys.has(key)) return null;
        const current = /** @type {NonNullable<typeof tx>} */ (tx);
        /** @type {FactoryEvent} */
        const e = { seq: lastSeq + 1, stream, type, data: structuredClone(data), at: isoNow(clock), key: key ?? null };
        log.push(e);
        lastSeq = e.seq;
        if (key) { keys.add(key); current.keys.push(key); }
        applyProjections(tables, e, current.undo);
        current.events.push(e);
        return e;
      });
    },

    /** Several appends as ONE unit: all saved, or none. Listeners hear about them after they are written. */
    transaction,

    /**
     * Events in order, optionally one stream's, after a given seq.
     * @param {{ stream?: string, after?: number, types?: string[] }} [filter]
     * @returns {FactoryEvent[]}
     */
    read({ stream, after = 0, types } = {}) {
      if (!tx) refresh();
      const out = [];
      for (const e of log) {
        if (e.seq <= after || (stream && e.stream !== stream) || (types && !types.includes(e.type))) continue;
        out.push(structuredClone(e));
      }
      return out;
    },

    /** Is there already an event with this idempotency key? */
    hasKey(key) {
      if (!tx) refresh();
      return keys.has(key);
    },

    /** Be told about every new event in THIS process (other processes: poll read({ after })). */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** One row of a projection table, or null. */
    get(name, id) {
      if (!tx) refresh();
      const row = table(name).get(id);
      return row ? structuredClone(row.data) : null;
    },

    /** All rows of a projection table, newest change first. */
    list(name) {
      if (!tx) refresh();
      return [...table(name).values()].sort((a, b) => b.seq - a.seq).map((row) => structuredClone(row.data));
    },

    /** `factory db rebuild`: throw the projections away and replay the log. */
    rebuild() {
      return locked(() => {
        refresh(true);
        return rebuildProjections(tables, log);
      });
    },

    /** The live leases as a Map (runId → lease), changed inside fn. See scheduler/leases.js. */
    leases,

    close() {
      listeners.clear();
    },
  };
  return store;
}

/** @typedef {ReturnType<typeof openStore>} Store */
