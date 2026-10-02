// Phase 21: CHECKPOINTS. Every change noobly makes to a file can be undone.
//
// A conversation and the project's files are two histories that move together.
// To rewind both, we record, per user turn ("turn 3: 'refactor the parser'"):
//
//   - where the conversation stood when the turn began (history length)
//   - for each file Edit/Write changed: its content BEFORE the first change in
//     that turn (or "did not exist"), saved once in a content-addressed store
//   - files a Bash command changed: noticed, but NOT restorable (we can't know
//     beforehand what a command will touch, so we have no copy)
//
// Rewinding to "before turn N" restores each file to its OLDEST snapshot from
// turn N or later: that is how it looked when turn N began.
//
//   ~/.noobly/projects/<slug>/checkpoints/<conversation id>/
//     index.jsonl        what happened, one JSON line each (like transcripts, Phase 09)
//     blobs/<sha256>     file contents, stored once however often they are saved
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { listProjectFiles } from '../tools/files.js';

const MAX_SCAN_FILES = 20_000; // above this, Bash changes aren't tracked (too slow to compare every time)

/**
 * @param {string} dir   where this conversation's checkpoints live
 * @param {{ cwd: string }} options  the project, for Bash change detection
 */
export function createCheckpointStore(dir, { cwd }) {
  const state = { turns: [], snapshots: [], bash: [], current: null };
  load();

  function log(entry) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'index.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }

  /** Replay index.jsonl (after --continue / /resume). */
  function load() {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, 'index.jsonl'), 'utf8');
    } catch {
      return;
    }
    for (const line of text.split('\n')) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      apply(entry);
    }
  }

  // The same function changes the state live and when replaying the log, so they can't disagree.
  function apply(entry) {
    if (entry.type === 'turn') state.turns.push({ id: entry.id, prompt: entry.prompt, at: entry.ts, historyLength: entry.historyLength, dropped: false });
    if (entry.type === 'snapshot') state.snapshots.push({ turn: entry.turn, file: entry.file, blob: entry.blob, consumed: false });
    if (entry.type === 'bash') state.bash.push({ turn: entry.turn, files: entry.files, consumed: false });
    if (entry.type === 'restore') {
      for (const item of [...state.snapshots, ...state.bash]) if (item.turn >= entry.from) item.consumed = true;
    }
    if (entry.type === 'drop') for (const turn of state.turns) if (turn.id >= entry.from) turn.dropped = true;
    if (entry.type === 'history-replaced') for (const turn of state.turns) turn.historyLength = null;
  }

  const record = (entry) => {
    apply({ ts: new Date().toISOString(), ...entry });
    log(entry);
  };

  function saveBlob(content) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const file = path.join(dir, 'blobs', hash);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    return hash;
  }

  const readBlob = (hash) => fs.readFileSync(path.join(dir, 'blobs', hash));

  return {
    dir,

    /** A user turn begins. Returns its id (ids only ever grow, even after a rewind). */
    startTurn({ historyLength, prompt }) {
      const id = (state.turns.at(-1)?.id ?? 0) + 1;
      record({ type: 'turn', id, historyLength, prompt: String(prompt).slice(0, 200) });
      state.current = id;
      return id;
    },

    /** Edit/Write call this just before changing `file`. The first change in a turn saves the old content. */
    async beforeWrite(file) {
      const turn = state.current;
      if (turn === null) return; // not inside a turn (e.g. a tool called directly)
      if (state.snapshots.some((s) => s.turn === turn && s.file === file && !s.consumed)) return;
      let content = null;
      try {
        content = await fs.promises.readFile(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      record({ type: 'snapshot', turn, file, blob: content === null ? null : saveBlob(content) });
    },

    /** The project's files and their size+mtime, to compare before and after a Bash command. */
    async scan() {
      if (state.current === null) return null;
      const files = await listProjectFiles(cwd).catch(() => []);
      if (files.length > MAX_SCAN_FILES) return null;
      const seen = new Map();
      await Promise.all(
        files.map(async (file) => {
          const stat = await fs.promises.stat(path.join(cwd, file)).catch(() => null);
          if (stat?.isFile()) seen.set(path.join(cwd, file), `${stat.mtimeMs}:${stat.size}`);
        }),
      );
      return seen;
    },

    /** After a Bash command: record which files it created, changed or deleted. Returns them. */
    async noteBash(before) {
      if (!before) return [];
      const after = await this.scan();
      if (!after) return [];
      const changed = [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file));
      if (changed.length) record({ type: 'bash', turn: state.current, files: changed });
      return changed;
    },

    /** The turns you can rewind to, oldest first, with what changed in each. */
    turns() {
      return state.turns
        .filter((turn) => !turn.dropped)
        .map((turn) => ({
          ...turn,
          files: [...new Set(state.snapshots.filter((s) => s.turn === turn.id && !s.consumed).map((s) => s.file))],
          bashFiles: [...new Set(state.bash.filter((b) => b.turn === turn.id && !b.consumed).flatMap((b) => b.files))],
        }));
    },

    /**
     * Put every file back the way it was when turn `from` began.
     * @returns {Promise<{ restored: string[], deleted: string[], notRestorable: string[] }>}
     */
    async restoreTo(from) {
      const oldest = new Map();
      for (const snapshot of state.snapshots) {
        if (snapshot.turn >= from && !snapshot.consumed && !oldest.has(snapshot.file)) oldest.set(snapshot.file, snapshot);
      }
      const restored = [];
      const deleted = [];
      for (const [file, snapshot] of oldest) {
        if (snapshot.blob === null) {
          await fs.promises.rm(file, { force: true });
          deleted.push(file);
        } else {
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          await fs.promises.writeFile(file, readBlob(snapshot.blob));
          restored.push(file);
        }
      }
      const byBash = state.bash.filter((b) => b.turn >= from && !b.consumed).flatMap((b) => b.files);
      const notRestorable = [...new Set(byBash)].filter((file) => !oldest.has(file));
      record({ type: 'restore', from });
      return { restored, deleted, notRestorable };
    },

    /** The conversation was rewound: turns from `from` on no longer exist. */
    dropFrom(from) {
      record({ type: 'drop', from });
      if (state.current !== null && state.current >= from) state.current = null;
    },

    /** Compaction rewrote the history: earlier positions mean nothing now (code can still be rewound). */
    historyReplaced() {
      if (state.turns.some((turn) => turn.historyLength !== null)) record({ type: 'history-replaced' });
    },

    /** For /diff: each changed file's content when noobly first touched it this conversation (null = didn't exist). */
    baseline() {
      const first = new Map();
      for (const snapshot of state.snapshots) {
        if (!first.has(snapshot.file)) first.set(snapshot.file, snapshot.blob === null ? null : readBlob(snapshot.blob));
      }
      return first;
    },
  };
}
