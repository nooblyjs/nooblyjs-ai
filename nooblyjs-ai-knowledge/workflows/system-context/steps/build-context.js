/**
 * @fileoverview Build Context step.
 *
 * Walks a wiki space's folder tree from a starting folder and, bottom-up,
 * generates AI "context" sidecars under the space-root `.system/context/`
 * namespace, mirroring the source tree:
 *   - `.system/context/<folder>/<SourceFile>.md` — a per-file summary, and
 *   - `.system/context/<folder>/_folder.md` — a roll-up of the folder built from
 *     its file summaries plus the overviews of the folders beneath it.
 *
 * The same step backs both workflows defined in workflow-definition.json:
 *   - "Context: Build Space Context (Scheduled)" — run on a periodic schedule
 *     with `{ space, folder: '' }` to sweep a whole space.
 *   - "Context: Build Folder Context (On-Demand)" — POST /api/workflows/start
 *     with `{ payload: { space, folder } }` to (re)build from a single folder.
 *
 * Context is also CLEANED UP here, not only generated. A run passed `removedFiles`
 * (the wiki platform sends it when a document or folder is deleted) rebuilds the
 * owning folder's roll-up without the deleted item; every run additionally prunes
 * sidecars whose source document has gone and drops the roll-up of a folder that
 * has been emptied. See ContextProcessor.pruneOrphanContext/pruneFolderRollup.
 *
 * Reads (folder tree + document content) come straight off the space's on-disk
 * baseDir (via DiskFileSource): the worker thread shares the platform's
 * filesystem, so it can read the space's files directly with no HTTP call back
 * into the backend. This is deliberate — in production the backend is fronted by
 * HTTPS + Entra SSO on :443, so a self-call from the worker fails the TLS/cert
 * check and is redirected to the Entra login ("fetch failed"). Disk reads
 * sidestep that entirely (they also avoid the cold full-tree HTTP fetch that
 * used to time out and retry on large spaces). The trade-off is that disk reads
 * do NOT warm the live wiki caches (treeCache/content/search) — the next real
 * user request repopulates them anyway.
 *
 * The HTTP alternative (`useWikiApi:true` -> WikiApiClient, authenticated with
 * WORKFLOW_API_TOKEN / WORKFLOW_API_USER+PASSWORD against WORKFLOW_API_URL) was
 * retired on 2026-07-25: it only ever worked on dev/localhost, and steps now
 * reach the backend's main process through the file-based workflow bridge
 * (`common/bridge/workflowBridgeClient.js`) rather than over HTTP. If cache
 * warming is ever needed here, add tree/content methods to that bridge — do not
 * reintroduce an HTTP self-call.
 *
 * The AI agent is the one tagged "Folder Processing" in the Agents screen
 * (override per run with `agent`).
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

// Load the knowledge platform's root .env so a scheduled run (which executes in
// a worker thread that may not inherit the backend's env) can still read the
// platform settings it needs, chiefly APP_BASE_DIR. dotenv never overrides an
// already-set value.
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const fs = require('node:fs');
const serviceRegistry = require('nooblyjs-core');
const { resolveAppBaseDir, resolveSpace } = require('../utilities/spaces');
const DiskFileSource = require('../services/diskFileSource');
const FolderExpert = require('../services/folderExpert');
const ContextProcessor = require('../services/contextProcessor');
const { libraryFor } = require('../../common/prompts/prompts');

/**
 * Resolve the step's settings from its input and the environment.
 * @param {Object} data - Workflow context / input.
 * @returns {Object} Resolved settings.
 */
function resolveSettings(data) {
  const d = data || {};
  return {
    // A folder PATH (disk mode) takes precedence over a space when supplied.
    contentPath: d.contentPath != null ? d.contentPath : (d.path != null ? d.path : null),
    // Space may be supplied as `space`, `spaceName`, or `spaceId`.
    space: d.space != null ? d.space : (d.spaceName != null ? d.spaceName : d.spaceId),
    folder: d.folder != null ? d.folder : (d.startFolder || ''),
    // Targeted single-file mode: one or more space-relative file paths. When
    // present the step rebuilds ONLY those files + their folder's roll-up
    // (ContextProcessor.runFiles) instead of walking the folder. The wiki
    // FileWatcher passes this on a per-file change.
    files: Array.isArray(d.files) ? d.files
      : (d.file != null ? [d.file] : (d.contentFile != null ? [d.contentFile] : null)),
    // Space-relative path(s) that were DELETED. Also targeted mode — the paths
    // can't be summarised, but they identify the folder whose roll-up still
    // describes them, so it is rebuilt (and their orphaned sidecars pruned) for
    // the cost of one AI call. The wiki platform's artifactCleanup passes this on
    // a document or folder delete. Without it a delete would have to be expressed
    // as a folder rebuild, i.e. the whole recursive walk.
    removedFiles: Array.isArray(d.removedFiles) ? d.removedFiles
      : (d.removedFile != null ? [d.removedFile] : (Array.isArray(d.removed) ? d.removed : null)),
    agent: d.agent || null,
    appBaseDir: d.appBaseDir || process.env.APP_BASE_DIR || undefined,
    extensions: Array.isArray(d.extensions) ? d.extensions : undefined,
    force: !!d.force,
    summaryMaxChars: d.summaryMaxChars || 500,
    folderMaxChars: d.folderMaxChars || 600,
    significanceThreshold: d.significanceThreshold, // default applied in ContextProcessor (0.9)
    includeDerived: d.includeDerived, // default true in ContextProcessor; false = markdown only
    aiTimeoutMs: d.aiTimeoutMs != null ? d.aiTimeoutMs : 0, // 0 = no timeout (local Ollama can be slow)
    aiRetries: d.aiRetries || 3,
  };
}

/**
 * @async
 * @function run
 * @param {Object} data - Workflow context / input.
 * @returns {Promise<Object>} Run summary.
 */
async function run(data) {
  const logger = serviceRegistry.logger();
  const s = resolveSettings(data);

  // The agent config (settings-agents.json) always lives under appBaseDir.
  const appBaseDir = resolveAppBaseDir(s.appBaseDir);

  // Pick the file source. A folder PATH reads straight off disk (no backend, no
  // spaces.json). A SPACE also reads off disk — resolveSpace maps it to its
  // on-disk baseDir, which the worker (sharing the platform filesystem) reads
  // directly, so there is no HTTP self-call back into the backend (which would
  // hit HTTPS+Entra on :443 and fail). Both expose the
  // getFolderTree()/readDocument() ContextProcessor needs.
  let space;
  let source;
  let startFolder;
  let sourceMode;
  if (s.contentPath) {
    const root = path.resolve(s.contentPath);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new Error(`build-context: path is not a directory: ${root}`);
    }
    space = { id: 0, name: path.basename(root) || 'content', baseDir: root };
    source = new DiskFileSource({ root, logger });
    startFolder = ''; // the path itself is the root to walk
    sourceMode = 'disk-path';
  } else {
    if (s.space == null || s.space === '') {
      throw new Error('build-context: provide "path" (a folder) or "space" (name or id)');
    }
    space = resolveSpace(s.space, appBaseDir);
    // Read the resolved space's files straight off disk — no backend self-call.
    source = new DiskFileSource({ root: space.baseDir, logger });
    sourceMode = 'disk-space';
    startFolder = s.folder;
  }

  // Targeted mode when the caller named specific files — changed OR removed.
  const targeted = (Array.isArray(s.files) && s.files.length > 0)
    || (Array.isArray(s.removedFiles) && s.removedFiles.length > 0);

  logger.info('Context build: starting', {
    mode: sourceMode,
    scope: targeted ? 'targeted-files' : 'folder',
    space: space.name,
    spaceId: space.id,
    baseDir: space.baseDir,
    folder: startFolder || '(root)',
    files: (Array.isArray(s.files) && s.files.length) ? s.files.length : undefined,
    removedFiles: (Array.isArray(s.removedFiles) && s.removedFiles.length) ? s.removedFiles.length : undefined,
    force: s.force,
  });

  await source.authenticate();

  // Worker-safe "Folder Processing" expert.
  const expert = new FolderExpert({
    appBaseDir,
    usage: 'Folder Processing',
    agentName: s.agent,
    logger,
    timeoutMs: s.aiTimeoutMs,
    retries: s.aiRetries,
  });

  const processor = new ContextProcessor({
    space,
    startFolder,
    wikiApi: source,
    expert,
    // System prompts come from the prompt library under the SAME appBaseDir the
    // agents do, rather than relying on APP_BASE_DIR reaching this worker.
    prompts: libraryFor(appBaseDir),
    logger,
    extensions: s.extensions,
    force: s.force,
    summaryMaxChars: s.summaryMaxChars,
    folderMaxChars: s.folderMaxChars,
    significanceThreshold: s.significanceThreshold,
    includeDerived: s.includeDerived,
  });

  // Targeted single-file mode when `files`/`removedFiles` is supplied (event-driven
  // per-file rebuild); otherwise the full bottom-up folder/space walk.
  const result = targeted
    ? await processor.runFiles(s.files || [], s.removedFiles || [])
    : await processor.run();

  const scope = targeted
    ? `${result.filesTargeted} changed + ${result.filesRemoved} removed file(s) in "${space.name}"/${result.folder || '(root)'}`
    : `"${space.name}"${startFolder ? ` /${startFolder}` : ''}`;
  const message = `Context build complete for ${scope}: `
    + `${result.filesSummarized} summarised, ${result.filesSkipped} up-to-date, `
    + `${result.filesUnchanged} unchanged, ${result.filesFailed} failed, `
    + `${result.contextPruned} orphan sidecar(s) pruned, `
    + `${result.rollupsWritten} folder roll-up(s)${targeted ? '' : ` (${result.foldersSkipped} unchanged)`}`
    + `${result.rollupsPruned ? `, ${result.rollupsPruned} roll-up(s) pruned` : ''}, `
    + `${result.homesSeeded} home page(s) seeded`
    + `${result.homesRefreshed ? `, ${result.homesRefreshed} refreshed` : ''}`;
  logger.info(message, result);

  return {
    message,
    space: space.name,
    spaceId: space.id,
    folder: targeted ? (result.folder || '') : (startFolder || ''),
    files: targeted ? s.files : undefined,
    removedFiles: targeted && s.removedFiles && s.removedFiles.length ? s.removedFiles : undefined,
    agent: expert.agentMeta,
    ...result,
    processedAt: new Date().toISOString(),
  };
}

module.exports = { run, resolveSettings };
