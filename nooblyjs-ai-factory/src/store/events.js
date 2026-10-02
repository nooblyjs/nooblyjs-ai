// @ts-check
// Phase F05: THE EVENT LOG. The only thing the factory ever writes.
//
//   store.append('run:r1', 'step.finished', { runId: 'r1', step: 'build', result })
//
// Everything that happens is appended as an event; nothing is ever updated or
// deleted. Current state (runs, items…) is DERIVED from the log by projections.
//
// Why is "append, then derive" easier to make crash-safe than "update rows"?
//   - One write per change: the event and its projection updates go in ONE
//     transaction. A crash leaves either both or neither, never half.
//   - Nothing is overwritten, so nothing is lost: you can always ask "what
//     happened, in what order?" (that's `factory logs`, and an audit trail).
//   - State can be rebuilt from scratch at any time.
//
// IDEMPOTENCY KEYS: an event may carry a unique `key`. Appending a second event
// with the same key does nothing and returns null. That turns "did I already
// do this?" into a database constraint instead of a hope.
//
// seq is the global order. It can have GAPS: SQLite's AUTOINCREMENT uses up a
// number even for an insert that the key made it ignore. Order is guaranteed,
// contiguity is not, so readers ask for "seq > last seen", never "seq = last + 1".
import { isoNow, systemClock } from '../util/clock.js';
import { openDb, transaction } from './db.js';
import { applyProjections, rebuildProjections } from './projections.js';

/** @typedef {import('./projections.js').FactoryEvent} FactoryEvent */

/**
 * @param {{ env?: NodeJS.ProcessEnv, file?: string, clock?: import('../util/clock.js').Clock }} [options]
 */
export function openStore({ env = process.env, file, clock = systemClock } = {}) {
  const db = openDb({ env, file });
  /** @type {Set<(e: FactoryEvent) => void>} */
  const listeners = new Set();
  /** @type {FactoryEvent[]} */
  let unannounced = []; // appended inside a caller's transaction: announce only when IT commits
  const announce = (events) => {
    for (const e of events) for (const fn of listeners) fn(e);
  };
  const insert = db.prepare('INSERT OR IGNORE INTO events (stream, type, data, at, key) VALUES (?, ?, ?, ?, ?)');
  const toEvent = (row) => ({ ...row, data: JSON.parse(row.data) });

  const store = {
    db,
    env,

    /**
     * Append one event (and update projections) atomically.
     * @param {string} stream  @param {string} type  @param {object} data
     * @param {{ key?: string }} [options]
     * @returns {FactoryEvent | null}  null when an event with this key already exists
     */
    append(stream, type, data, { key } = {}) {
      const inOuter = db.isTransaction;
      const event = transaction(db, () => {
        const at = isoNow(clock);
        const { changes, lastInsertRowid } = insert.run(stream, type, JSON.stringify(data), at, key ?? null);
        if (!changes) return null;
        /** @type {FactoryEvent} */
        const e = { seq: Number(lastInsertRowid), stream, type, data, at, key: key ?? null };
        applyProjections(db, e);
        return e;
      });
      // Listeners hear about it only AFTER the commit: never about something that might roll back.
      // Inside a caller's transaction, "the commit" is the caller's: wait for it (store.transaction).
      if (event && inOuter) unannounced.push(event);
      else if (event) announce([event]);
      return event;
    },

    /**
     * Several appends as ONE unit: all saved, or none. Listeners hear about them after the commit.
     * @template T
     * @param {() => T} fn
     * @returns {T}
     */
    transaction(fn) {
      try {
        const result = transaction(db, fn);
        const events = unannounced;
        unannounced = [];
        announce(events);
        return result;
      } catch (error) {
        unannounced = []; // rolled back: these never happened
        throw error;
      }
    },

    /**
     * Events in order, optionally one stream's, after a given seq.
     * @param {{ stream?: string, after?: number, types?: string[] }} [filter]
     * @returns {FactoryEvent[]}
     */
    read({ stream, after = 0, types } = {}) {
      const rows = stream
        ? db.prepare('SELECT * FROM events WHERE stream = ? AND seq > ? ORDER BY seq').all(stream, after)
        : db.prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq').all(after);
      const events = rows.map(toEvent);
      return types ? events.filter((e) => types.includes(e.type)) : events;
    },

    /** Is there already an event with this idempotency key? */
    hasKey(key) {
      return Boolean(db.prepare('SELECT 1 FROM events WHERE key = ?').get(key));
    },

    /** Be told about every new event in THIS process (other processes: poll read({ after })). */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** One row of a projection table, or null. */
    get(table, id) {
      const row = /** @type {any} */ (db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id));
      return row ? JSON.parse(row.data) : null;
    },

    /** All rows of a projection table, newest change first. */
    list(table) {
      return db.prepare(`SELECT data FROM ${table} ORDER BY seq DESC`).all().map((r) => JSON.parse(/** @type {any} */ (r).data));
    },

    /** `factory db rebuild`: throw the projections away and replay the log. */
    rebuild() {
      return transaction(db, () => rebuildProjections(db, () => store.read()));
    },

    close() {
      db.close();
    },
  };
  return store;
}

/** @typedef {ReturnType<typeof openStore>} Store */
