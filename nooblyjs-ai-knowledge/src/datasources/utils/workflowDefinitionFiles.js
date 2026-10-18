/**
 * @fileoverview Which files in a workflow group folder hold workflow definitions.
 *
 * A group folder holds the bare `workflow-definition.json` plus any number of
 * `workflow-definition-<suffix>.json` sub-group files. That rule has TWO
 * independent readers and they must agree:
 *
 *   1. `datasources/lib/workflowBridge.js` — the in-process loader that backs
 *      the UI list, manual "Run now" and schedule creation.
 *   2. `src/configuration/activities/run-workflow.js` — the worker-thread
 *      activity a SCHEDULED run executes. Worker threads get an isolated
 *      service registry with no workflows in it, so the activity cannot ask the
 *      bridge anything and re-reads the definitions off disk itself.
 *
 * They drifted: the activity only ever opened the bare `workflow-definition.json`,
 * so every workflow defined in a suffixed file loaded fine, appeared in the UI
 * and could be scheduled — and then failed at fire time with "not found on
 * disk". It was silent because the two paths only diverge on the scheduled run;
 * clicking Run now on the same workflow succeeded. That covered all nine
 * `Refresh Solution: *` workflows (solution-design/workflow-definition-maintenance.json)
 * and the entire `system-context` group, which has no bare file at all.
 *
 * Hence this module: one definition of the rule, required by both.
 */

'use strict';

/**
 * Matches a workflow definition file, capturing the optional sub-group suffix:
 *   workflow-definition.json       -> suffix = undefined  (group = folder name)
 *   workflow-definition-data.json  -> suffix = "data"     (group = "<folder> / data")
 * @type {RegExp}
 */
const DEFINITION_FILE_RE = /^workflow-definition(?:-(.+))?\.json$/;

/**
 * Test one filename against the rule.
 * @param {string} fileName - A bare filename (not a path)
 * @returns {{ fileName: string, suffix: string|undefined }|null} Null when the
 *   file is not a definition file; `suffix` is undefined for the bare file.
 */
function matchDefinitionFile(fileName) {
  const match = DEFINITION_FILE_RE.exec(fileName);
  if (!match) return null;
  return { fileName, suffix: match[1] };
}

/**
 * Pick every definition file out of a directory listing, in a stable order.
 * Sorted by name so the bare `workflow-definition.json` is read before its
 * suffixed siblings and load order does not depend on the filesystem.
 * @param {string[]} fileNames - Directory listing (bare filenames)
 * @returns {Array<{ fileName: string, suffix: string|undefined }>}
 */
function definitionFilesIn(fileNames) {
  return (fileNames || [])
    .map(matchDefinitionFile)
    .filter(Boolean)
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

module.exports = {
  DEFINITION_FILE_RE,
  matchDefinitionFile,
  definitionFilesIn
};
