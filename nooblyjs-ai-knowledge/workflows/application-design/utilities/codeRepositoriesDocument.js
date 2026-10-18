/**
 * @fileoverview Locate and round-trip the source-repository configuration
 * documents.
 *
 * The discovery workflow scans a single configuration folder
 * (`settings.configurationlocation`) for markdown files. Each document may carry
 * a table of source repositories:
 *
 *   | Name | Source | Repository | Folder | Branch | Status |
 *   | --- | --- | --- | --- | --- | --- |
 *   | **nooblyjs-core** | Bitbucket | https://[user]:[token]@.../core.git | Digital Platforms\Knowledge Repository | main |  |
 *
 * `Branch` is OPTIONAL — both for a row (an empty cell falls back to the
 * workflow's default branch) and for the table as a whole (a five-column table
 * with no Branch header still parses, every row simply taking the default). It
 * exists because the default branch is not universal: a repo whose default is
 * `master` was previously cloned with `--branch main`, which fails outright with
 * "Remote branch main not found in upstream origin".
 *
 * For each row the workflow creates the `Folder` directory, schedules the build
 * job, and records when that schedule last ran into the `Status` cell. The
 * document then has to be written back with ONLY the `Status` cells changed and
 * every other line — headings, prose, the other table cells — preserved.
 *
 * Rather than re-emit the whole file from a markdown AST (which loses incidental
 * formatting), this helper edits the table in place at the line level: it finds
 * the table by its header row, parses each data row into a record, and rebuilds
 * only the rows whose `Status` value changed.
 *
 * @author NooblyJS Team
 * @version 2.0.0
 * @since 2026-06-08
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { glob } = require('glob');

/** A line is a table row when, trimmed, it starts with a pipe. */
function isTableRow(line) {
   return /^\s*\|/.test(line);
}

/**
 * Split a markdown table row into its trimmed cell values, dropping the leading
 * and trailing pipe. The repository URLs in this table never contain a pipe, so
 * a plain split is safe.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
   let s = line.trim();
   if (s.startsWith('|')) s = s.slice(1);
   if (s.endsWith('|')) s = s.slice(0, -1);
   return s.split('|').map((c) => c.trim());
}

/** A separator row is the `| --- | --- |` line under the header. */
function isSeparatorRow(line) {
   if (!isTableRow(line)) return false;
   const cells = splitRow(line);
   return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

/** Strip markdown emphasis/code markers from a cell so names compare cleanly. */
function stripFormatting(cell) {
   return String(cell == null ? '' : cell).replace(/[*`]/g, '').trim();
}

/**
 * Find the repositories table in a markdown document and parse its rows.
 *
 * The table is identified as the first one whose header contains a `Name`, a
 * `Repository` and a `Status` column. Returns `null` when no such table is
 * present (so configuration documents without a repository table are skipped).
 *
 * @param {string} markdown
 * @returns {{
 *   lines: string[],
 *   columns: Object<string,number>,
 *   rows: Array<{name:string, source:string, repository:string, folder:string, branch:string, status:string, cells:string[], lineIndex:number}>
 * }|null}
 */
function parseRepositoriesTable(markdown) {
   const lines = String(markdown || '').split(/\r?\n/);

   let headerIdx = -1;
   let headerCells = null;
   for (let i = 0; i < lines.length; i++) {
      if (!isTableRow(lines[i])) continue;
      const cells = splitRow(lines[i]);
      const lower = cells.map((c) => c.toLowerCase());
      if (lower.includes('name') && lower.includes('repository') && lower.includes('status')
         && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
         headerIdx = i;
         headerCells = cells;
         break;
      }
   }
   if (headerIdx === -1) return null;

   const columns = {};
   headerCells.forEach((c, idx) => { columns[c.toLowerCase()] = idx; });
   const nameCol = columns.name;
   const sourceCol = columns.source;
   const repoCol = columns.repository;
   const folderCol = columns.folder;
   // Optional — undefined for a legacy five-column table, in which case every
   // row reports an empty branch and the caller applies its default.
   const branchCol = columns.branch;
   const statusCol = columns.status;

   const rows = [];
   for (let i = headerIdx + 2; i < lines.length; i++) {
      if (!isTableRow(lines[i])) break;          // table ended
      if (isSeparatorRow(lines[i])) continue;
      const cells = splitRow(lines[i]);
      const name = stripFormatting(cells[nameCol]);
      if (!name) continue;                        // skip blank/placeholder rows
      rows.push({
         name,
         source: cells[sourceCol] != null ? cells[sourceCol] : '',
         repository: cells[repoCol] != null ? cells[repoCol] : '',
         folder: folderCol != null && cells[folderCol] != null ? stripFormatting(cells[folderCol]) : '',
         branch: branchCol != null && cells[branchCol] != null ? stripFormatting(cells[branchCol]) : '',
         status: cells[statusCol] != null ? cells[statusCol].trim() : '',
         cells,
         lineIndex: i,
         _statusCol: statusCol,
      });
   }

   return { lines, columns, rows };
}

/**
 * Rebuild the document text from a parsed table after row `Status` values have
 * been edited in place (via `setStatus`). Only rows flagged as changed are
 * re-emitted, so the rest of the file is byte-for-byte preserved.
 *
 * @param {Object} parsed - the object returned by {@link parseRepositoriesTable}
 * @returns {{markdown:string, changed:boolean}}
 */
function serializeRepositoriesTable(parsed) {
   let changed = false;
   for (const row of parsed.rows) {
      if (!row._changed) continue;
      changed = true;
      const cells = row.cells.slice();
      cells[row._statusCol] = row.status;
      parsed.lines[row.lineIndex] = '| ' + cells.map((c) => c.trim()).join(' | ') + ' |';
   }
   return { markdown: parsed.lines.join('\n'), changed };
}

/** Mark a row's `Status` cell for update on the next serialize. */
function setStatus(row, value) {
   const next = String(value == null ? '' : value);
   if (next !== row.status) {
      row.status = next;
      row._changed = true;
   }
}

/**
 * Find every markdown file beneath the configuration folder. The discovery step
 * inspects each one for a repositories table, so any `.md` file is a candidate.
 *
 * @param {string} configurationLocation - Folder to scan for markdown documents
 * @returns {Promise<string[]>} absolute paths of matching documents
 */
async function findConfigurationDocuments(configurationLocation) {
   if (!configurationLocation || !fs.existsSync(configurationLocation)) return [];
   const pattern = path.join(configurationLocation, '**', '*.md').replace(/\\/g, '/');
   const matches = await glob(pattern, { dot: true, nodir: true });
   const found = [];
   for (const m of matches) if (!found.includes(m)) found.push(m);
   return found;
}

module.exports = {
   parseRepositoriesTable,
   serializeRepositoriesTable,
   setStatus,
   findConfigurationDocuments,
   // exported for unit testing
   stripFormatting,
   splitRow,
   isSeparatorRow,
};
