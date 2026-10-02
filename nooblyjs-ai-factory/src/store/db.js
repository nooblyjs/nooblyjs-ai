// @ts-check
// Phase F05: the factory's database. One SQLite file, built into Node.
//
//   ~/.factory/factory.db
//
// Why SQLite (node:sqlite, no dependency)? The concept we need is an
// append-only log with transactions, not a database server. SQLite gives us:
//   - TRANSACTIONS: an event and the state it changes are saved together, or not at all
//   - WAL mode ("write-ahead log"): readers (`factory runs`, later the dashboard)
//     don't block the writer, and the writer doesn't block them
//   - a busy timeout: two `factory` processes writing at once WAIT for each other
//     instead of failing with "database is locked"
//
// MIGRATIONS: the schema has a version number (PRAGMA user_version). Each
// migration moves it up by one; opening an old file applies the missing ones.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { factoryHome } from '../util/paths.js';

const MIGRATIONS = [
  // 1: the event log, and the projection tables derived from it (see projections.js)
  `CREATE TABLE events (
     seq    INTEGER PRIMARY KEY AUTOINCREMENT,  -- global order (gaps are possible, see events.js)
     stream TEXT NOT NULL,                      -- 'item:<id>' | 'run:<id>' | 'system'
     type   TEXT NOT NULL,                      -- 'run.started', 'step.finished', …
     data   TEXT NOT NULL,                      -- JSON
     at     TEXT NOT NULL,                      -- ISO time
     key    TEXT UNIQUE                         -- idempotency key, or NULL
   );
   CREATE INDEX events_stream ON events (stream, seq);
   CREATE TABLE items   (id TEXT PRIMARY KEY, data TEXT NOT NULL, seq INTEGER NOT NULL);
   CREATE TABLE runs    (id TEXT PRIMARY KEY, data TEXT NOT NULL, seq INTEGER NOT NULL);
   CREATE TABLE effects (id TEXT PRIMARY KEY, data TEXT NOT NULL, seq INTEGER NOT NULL);`,

  // 2 (Phase F06): LEASES, and a projection of the factory's own state (the kill switch).
  //   Leases are deliberately NOT events: a heartbeat every few seconds per run would
  //   flood the log with rows nobody needs. The table is small, mutable coordination
  //   state; only lease CHANGES (acquired, lost) are recorded as events.
  `CREATE TABLE leases (
     run_id     TEXT PRIMARY KEY,
     lease_id   TEXT NOT NULL,
     worker     TEXT NOT NULL,     -- 'serve:<host>:<pid>' or 'cli:<host>:<pid>'
     host       TEXT NOT NULL,
     pid        INTEGER NOT NULL,
     expires_at INTEGER NOT NULL   -- ms since 1970 (from the injectable clock)
   );
   CREATE TABLE system (id TEXT PRIMARY KEY, data TEXT NOT NULL, seq INTEGER NOT NULL);`,

  // 3 (Phase F12): the human INBOX, a projection like the others.
  `CREATE TABLE inbox (id TEXT PRIMARY KEY, data TEXT NOT NULL, seq INTEGER NOT NULL);`,
];

/**
 * Open (and create or upgrade) the database.
 * @param {{ env?: NodeJS.ProcessEnv, file?: string }} [options]  file ':memory:' for a throw-away database
 */
export function openDb({ env = process.env, file } = {}) {
  const location = file ?? path.join(factoryHome(env), 'factory.db');
  if (location !== ':memory:') fs.mkdirSync(path.dirname(location), { recursive: true });
  const db = new DatabaseSync(location);
  // busy_timeout FIRST: even switching to WAL needs a lock, and without a timeout a process
  // that finds the file busy fails at once ("database is locked") instead of waiting its turn.
  db.exec('PRAGMA busy_timeout = 10000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db) {
  const version = () => /** @type {any} */ (db.prepare('PRAGMA user_version').get()).user_version;
  if (version() >= MIGRATIONS.length) return;
  // Check the version again INSIDE the write lock: two processes opening a new file at
  // once would otherwise both see "version 0" and both try to create the tables.
  transaction(db, () => {
    for (let v = version(); v < MIGRATIONS.length; v++) {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    }
  });
}

/**
 * Run fn inside one transaction: all of it is saved, or none of it.
 * BEGIN IMMEDIATE takes the write lock at the START, so two processes can't
 * both read "not there yet" and then both write (the classic lost update).
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(db, fn) {
  if (db.isTransaction) return fn(); // already inside one: join it
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
