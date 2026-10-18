/**
 * @fileoverview Read the platform's workflow execution history so the discovery
 * step can report a build's real outcome — including WHY it failed — back into
 * the repository table's Status cell.
 *
 * Why read the history rather than ask the bridge: the file bridge's
 * `listSchedules` returns only id/name/workflowId/enabled/cronExpression/
 * lastRun/nextRun (see workflowBridgeServer.js in the sibling knowledge repo).
 * It carries no outcome and no error, so a schedule that has been failing every
 * night for a week is indistinguishable from one that has been succeeding — the
 * table would cheerfully report "Last run: <timestamp>" either way and the only
 * way to find the failure was to open the execution JSON by hand.
 *
 * The execution history is written by the backend to
 * `<appBaseDir>/workflow/executions/<YYYY-MM-DD>.json`, the same filesystem the
 * worker already uses for the bridge, so this needs no new transport and no
 * backend change.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Only look this far back — a repo with no run in a month is "never run". */
const MAX_DAY_FILES = 60;

/**
 * Absolute path of the execution-history directory for an application base dir.
 * @param {string} appBaseDir
 * @returns {string}
 */
function executionsDir(appBaseDir) {
   return path.join(appBaseDir, 'workflow', 'executions');
}

/**
 * The repository a build execution was for.
 *
 * Discovery sets `targetFolder` to `<targetFolderBase><sep><row.name>`, so the
 * final path segment is exactly the row name — a deterministic join back to the
 * table row. Falls back to the repo slug in the URL for executions started by
 * hand with a different folder convention.
 *
 * @param {Object} execution
 * @returns {?string} repository name, or null when it cannot be determined
 */
function executionRepoName(execution) {
   const input = (execution && execution.input) || {};

   if (input.targetFolder) {
      const segments = String(input.targetFolder).split(/[\\/]+/).filter(Boolean);
      if (segments.length > 0) return segments[segments.length - 1];
   }

   if (input.repoUrl) {
      const match = String(input.repoUrl).match(/\/([^/]+?)(?:\.git)?$/);
      if (match) return match[1];
   }

   return null;
}

/**
 * Most recent execution of `workflowName` for each repository.
 *
 * Day files are read newest-first and the first record seen for a repository
 * wins, so this is O(days) rather than O(all executions) for the common case of
 * a repo that ran recently.
 *
 * @param {string} appBaseDir - Application base dir (holds workflow/executions)
 * @param {string} workflowName - Build workflow name to match
 * @param {Object} [logger] - Optional logger
 * @returns {Map<string, Object>} repository name -> latest execution record
 */
function latestExecutionByRepo(appBaseDir, workflowName, logger) {
   const byRepo = new Map();
   if (!appBaseDir) return byRepo;

   const dir = executionsDir(appBaseDir);
   let files;
   try {
      // Filenames are ISO dates, so a reverse lexical sort is newest-first.
      files = fs.readdirSync(dir)
         .filter((f) => f.endsWith('.json'))
         .sort()
         .reverse()
         .slice(0, MAX_DAY_FILES);
   } catch (error) {
      // No history yet (fresh install) is normal — not an error.
      if (logger && error.code !== 'ENOENT') {
         logger.warn('Source Repo Discovery: could not read execution history', {
            dir, error: error.message,
         });
      }
      return byRepo;
   }

   for (const file of files) {
      let records;
      try {
         const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
         records = Array.isArray(parsed) ? parsed : (parsed.executions || []);
      } catch (error) {
         continue; // a partially-written or corrupt day file must not break the sweep
      }

      // Within a day file, later entries are more recent.
      for (let i = records.length - 1; i >= 0; i--) {
         const execution = records[i];
         if (workflowName && execution.name !== workflowName) continue;
         const repo = executionRepoName(execution);
         if (!repo || byRepo.has(repo)) continue;
         byRepo.set(repo, execution);
      }
   }

   return byRepo;
}

/**
 * Reduce a multi-line error to the one line a reader needs.
 *
 * Git puts the diagnosis on its own line and the noise around it:
 *   "git clone failed: Cloning into '...'...\nfatal: Remote branch main not found"
 * The `fatal:`/`error:` line is the answer, so prefer it when present.
 *
 * @param {string} error
 * @returns {string}
 */
function principalErrorLine(error) {
   const lines = String(error || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
   if (lines.length === 0) return '';
   const diagnostic = lines.find((l) => /^(fatal|error|remote):/i.test(l));
   return diagnostic || lines[0];
}

/**
 * Make a string safe to drop into a markdown table cell: no pipes (they would
 * split the row into extra columns) and no newlines (they would end the table).
 *
 * @param {string} text
 * @param {number} [maxLength=180]
 * @returns {string}
 */
function toTableCell(text, maxLength = 180) {
   const flat = String(text == null ? '' : text)
      .replace(/\r?\n/g, ' ')
      .replace(/\|/g, '/')      // a literal pipe would break the table row
      .replace(/\s+/g, ' ')
      .trim();
   return flat.length > maxLength ? flat.slice(0, maxLength - 1) + '…' : flat;
}

/**
 * Compact, readable timestamp for a Status cell: `2026-08-07 11:26 UTC`.
 * Falls back to the raw value when it is not a parseable date.
 *
 * @param {string} value - ISO timestamp
 * @returns {string}
 */
function formatTimestamp(value) {
   const date = new Date(value);
   if (isNaN(date.getTime())) return String(value == null ? '' : value);
   return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

/**
 * The Status cell text for a repository row.
 *
 * The whole point is that a reader of the wiki table sees the outcome without
 * opening a log: a failed build states that it failed, when, and the actual
 * reason (e.g. "fatal: Remote branch main not found in upstream origin").
 *
 * @param {Object} options
 * @param {?Object} options.schedule - Live schedule record, or null when none exists
 * @param {?Object} options.execution - Latest execution for this repo, or null
 * @returns {string} status cell text
 */
function statusFor({ schedule, execution }) {
   if (execution && (execution.status === 'failed' || execution.outcome === 'failed')) {
      const when = formatTimestamp(execution.completedAt || execution.startedAt);
      const failedStep = (execution.steps || []).find((s) => s.status === 'failed');
      const reason = principalErrorLine(execution.error || (failedStep && failedStep.error));
      const step = failedStep && failedStep.stepName ? ` in ${failedStep.stepName}` : '';
      return toTableCell(`❌ Failed ${when}${step} — ${reason || 'no error detail recorded'}`);
   }

   if (execution && execution.completedAt) {
      return toTableCell(`✅ Last run: ${formatTimestamp(execution.completedAt)}`);
   }

   if (schedule && schedule.lastRun) {
      return toTableCell(`✅ Last run: ${formatTimestamp(schedule.lastRun)}`);
   }

   return 'Scheduled — awaiting first run';
}

module.exports = {
   latestExecutionByRepo,
   statusFor,
   // exported for unit testing
   executionRepoName,
   principalErrorLine,
   toTableCell,
   formatTimestamp,
};
