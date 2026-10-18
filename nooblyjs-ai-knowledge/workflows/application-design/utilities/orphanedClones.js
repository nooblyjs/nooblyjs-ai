/**
 * @fileoverview Find working folders that no repository-listing document claims.
 *
 * The build workflow clones each listed repository into
 * `<application_design_datafolder>/<Name>/`. Nothing has ever removed one, so a
 * repository deleted from the listing document leaves its clone behind forever —
 * consuming disk, and quietly misleading anyone who goes looking at the working
 * folder to see what the platform tracks.
 *
 * A CLONE IS TWO THINGS ON DISK, NOT ONE. `GitService.statePath` puts the
 * processed-commit marker BESIDE the clone, not inside it:
 *
 *   <dataFolder>/my-service/            <- the clone
 *   <dataFolder>/.my-service.state.json <- the marker
 *
 * So removing only the directory leaves a marker that will be picked up if the
 * repository is ever re-listed — and `fetch-code` would then diff against a SHA
 * from the old clone and document nothing, leaving the repo silently
 * undocumented. Cleanup has to take the pair. Equally, a marker whose folder is
 * already gone is itself an orphan worth sweeping.
 *
 * NOTHING HERE DELETES. This module reports; the caller decides. That split is
 * deliberate: the caller is the one place that knows whether the listing
 * documents were actually read (see `documentsProcessed` in discover-repos), and
 * an empty read must never be mistaken for "nothing is listed any more".
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 2026-08-26
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** `.my-service.state.json` -> `my-service`; anything else -> null. */
const STATE_FILE = /^\.(.+)\.state\.json$/i;

/**
 * Compare folder names the way the file system that holds them does.
 *
 * Case-insensitive, because the content roots are Windows checkouts and a row
 * named `My-Service` must match a folder named `my-service` — treating those as
 * different would report a live clone as an orphan, which is the one mistake
 * with a real cost attached.
 *
 * @param {string} name
 * @return {string}
 */
function nameKey(name) {
   return String(name == null ? '' : name).trim().toLowerCase();
}

/**
 * List the working folders and state markers that no listed repository claims.
 *
 * Only DIRECT children of `dataFolder` are considered — the build creates
 * exactly one folder per repository name there, so anything nested deeper is
 * inside a clone and none of our business.
 *
 * @param {Object} options
 * @param {string} options.dataFolder - the `application_design_datafolder` root
 * @param {Iterable<string>} options.knownNames - every `Name` seen in the
 *   listing documents on this sweep
 * @return {{
 *   orphans: Array<{name:string, folder:(string|null), statePath:(string|null), bytes:number}>,
 *   kept: string[],
 *   scanned: number,
 *   missing: boolean
 * }}
 */
function findOrphanedClones({ dataFolder, knownNames }) {
   const empty = { orphans: [], kept: [], scanned: 0, missing: true };
   if (!dataFolder || !fs.existsSync(dataFolder)) return empty;

   let entries;
   try {
      entries = fs.readdirSync(dataFolder, { withFileTypes: true });
   } catch (_) {
      return empty;
   }

   const known = new Set();
   for (const name of knownNames || []) {
      const key = nameKey(name);
      if (key) known.add(key);
   }

   // Collect the two halves of each clone under one name, so a folder and its
   // marker are always reported (and later removed) together.
   const byName = new Map();
   const take = (name) => {
      const key = nameKey(name);
      if (!byName.has(key)) byName.set(key, { name, folder: null, statePath: null });
      return byName.get(key);
   };

   for (const entry of entries) {
      const full = path.join(dataFolder, entry.name);

      if (entry.isDirectory()) {
         // A dot-directory here is not a clone — it is somebody's tooling.
         if (entry.name.startsWith('.')) continue;
         take(entry.name).folder = full;
         continue;
      }

      const match = STATE_FILE.exec(entry.name);
      if (match) {
         const record = take(match[1]);
         record.statePath = full;
         // Prefer the folder's own casing for the display name when we have it.
         if (!record.folder) record.name = match[1];
      }
   }

   const orphans = [];
   const kept = [];
   for (const [key, record] of byName) {
      if (known.has(key)) {
         kept.push(record.name);
         continue;
      }
      orphans.push({
         name: record.name,
         folder: record.folder,
         statePath: record.statePath,
         bytes: record.folder ? directorySize(record.folder) : 0
      });
   }

   // Largest first: on a disk-pressure sweep the row worth acting on is the top one.
   orphans.sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

   return { orphans, kept, scanned: byName.size, missing: false };
}

/**
 * Total size of a directory tree, best-effort.
 *
 * Reported so the operator can see what a cleanup would actually reclaim — the
 * whole reason to run one. Unreadable entries are skipped rather than thrown:
 * an approximate number is useful, and a failure to measure must not stop the
 * orphan being reported.
 *
 * @param {string} dir
 * @return {number} bytes
 */
function directorySize(dir) {
   let total = 0;
   const stack = [dir];
   while (stack.length) {
      const current = stack.pop();
      let entries;
      try {
         entries = fs.readdirSync(current, { withFileTypes: true });
      } catch (_) {
         continue;
      }
      for (const entry of entries) {
         const full = path.join(current, entry.name);
         // Do not follow symlinks: a link into the repo would be counted twice,
         // and a link to its own ancestor would never terminate.
         if (entry.isSymbolicLink()) continue;
         if (entry.isDirectory()) { stack.push(full); continue; }
         try { total += fs.statSync(full).size; } catch (_) { /* skip */ }
      }
   }
   return total;
}

/**
 * Delete one orphan — its clone directory AND its state marker.
 *
 * Both halves are attempted even if the first fails, so a locked directory (a
 * Windows file handle held by an editor, say) still gets its marker cleared
 * rather than leaving a half-removed clone that reports as healthy.
 *
 * @param {{name:string, folder:?string, statePath:?string}} orphan
 * @return {{name:string, removed:string[], errors:Array<{path:string, error:string}>}}
 */
function removeOrphan(orphan) {
   const removed = [];
   const errors = [];
   for (const target of [orphan.folder, orphan.statePath]) {
      if (!target) continue;
      try {
         fs.rmSync(target, { recursive: true, force: true });
         removed.push(target);
      } catch (error) {
         errors.push({ path: target, error: error.message });
      }
   }
   return { name: orphan.name, removed, errors };
}

/** Human-readable size for the log line and the run summary. */
function formatBytes(bytes) {
   const n = Number(bytes) || 0;
   if (n < 1024) return `${n} B`;
   const units = ['KB', 'MB', 'GB', 'TB'];
   let value = n / 1024;
   let i = 0;
   while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
   return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

module.exports = {
   findOrphanedClones,
   removeOrphan,
   formatBytes,
   // exported for unit testing
   nameKey,
   directorySize,
};
