/**
 * @fileoverview Source Repo Discovery step.
 *
 * Reconciles the source-repository configuration documents with the platform's
 * build schedules. Everything it works on is driven by settings — there are no
 * hardcoded content folders:
 *
 *   1. Read `settings.configurationlocation` and find every markdown file in it.
 *   2. Parse each document's repository table
 *      (Name | Source | Repository | Folder | Status).
 *   3. List the live schedules from the running backend.
 *   4. For each repository row:
 *        - create the `Folder` directory structure (resolved against
 *          `settings.folderBase`);
 *        - if a schedule named after the repo exists  -> write its last run time
 *          into the `Status` cell;
 *        - else if `Status` is empty                  -> create a daily schedule
 *          that runs the build workflow ("Build: Code Processor (Bitbucket)")
 *          for that repository, then mark `Status` as scheduled-pending.
 *   5. Write the document back with only the `Status` cells changed.
 *   6. Sweep `settings.targetFolderBase` for working folders no document claims
 *      any more, and report them (or, with `orphanCleanup: 'remove'`, delete
 *      them along with their sibling `.state.json` markers). See `sweepOrphans`
 *      for the guards — the sweep declines whenever "no document claims this"
 *      could mean something other than what it says.
 *
 * The repository URL stored in the schedule keeps the credentials as
 * `${BITBUCKET_USERNAME}` / `${BITBUCKET_API_TOKEN}` placeholders — the build
 * workflow's fetch-code step expands those from the backend `.env` at run time,
 * so no secret is ever written into the schedule file or the document.
 *
 * @author Digital Technologies Team
 * @version 2.0.0
 * @since 2026-06-08
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Load the knowledge platform's root .env so this step can read BITBUCKET_* (for
// the scheduled build's repo URL), the application_design_* folder settings, and
// APP_BASE_DIR (where the file workflow bridge lives). dotenv never overrides an
// already-set process.env value, so this is safe whether run standalone or from
// a scheduler worker thread.
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const serviceRegistry = require('nooblyjs-core');
const WorkflowBridgeClient = require('../../common/bridge/workflowBridgeClient.js');
const {
   parseRepositoriesTable,
   serializeRepositoriesTable,
   setStatus,
   findConfigurationDocuments,
} = require('../utilities/codeRepositoriesDocument.js');
const {
   latestExecutionByRepo,
   statusFor,
} = require('../utilities/workflowExecutions.js');
const {
   findOrphanedClones,
   removeOrphan,
   formatBytes,
} = require('../utilities/orphanedClones.js');

const DEFAULTS = {
   buildWorkflowName: 'Build: Code Processor (Bitbucket)',
   cron: '0 2 * * *',                 // daily at 02:00
   branch: 'main',
   // REPORT, not remove. Deleting a clone is cheap to undo in principle — the
   // next build re-clones it — but the state marker goes with it, so the repo is
   // then re-documented from scratch and every directory is paid for again in AI
   // calls. The default therefore tells you what it WOULD remove; set
   // `orphanCleanup: 'remove'` once you have read that list.
   orphanCleanup: 'report',
};

/** Valid `orphanCleanup` modes; anything else falls back to the default. */
const ORPHAN_MODES = new Set(['off', 'report', 'remove']);

/**
 * Resolve a folder path: empty stays empty, an absolute path is kept as-is, and
 * a relative path is resolved against the workflows-repo root (two levels up
 * from this steps/ dir) so it lands predictably whatever the worker thread's CWD
 * is. The `.env` folder entries may be absolute (/workspaces/...) or repo-root
 * relative (../.application/...); both resolve correctly here.
 *
 * @param {string} folder
 * @returns {string}
 */
function resolveFolder(folder) {
   if (!folder) return '';
   return path.isAbsolute(folder) ? folder : path.resolve(__dirname, '../..', folder);
}

/**
 * Resolve the step's settings from its input and the environment.
 *
 * Where the repository-definition documents live is a per-workflow decision, so
 * it is taken from the workflow definition / run input first and only falls back
 * to the `.env` convention:
 *   - `configurationlocation` ← input, else `application_design_contentfolder`
 *     (the knowledge content folder the repo table is read from). Set it in the
 *     workflow definition's `defaultInput` to point a run at a different space.
 *   - `folderBase` ← input, else the resolved `configurationLocation` (each
 *     row's `Folder` markdown output is written under it — by default alongside
 *     the config docs).
 * The working folder stays environment-driven, as it is host/deployment state
 * rather than a per-workflow choice:
 *   - `targetFolderBase` ← input, else `application_design_datafolder` (the
 *     `.application` working folder the code is downloaded/cloned into, one
 *     subfolder per repo name).
 * Any value can still be overridden per-run via the step input.
 *
 * @param {Object} data - step input
 * @returns {Object} resolved settings
 */
function resolveSettings(data) {
   const settings = data.settings || data;

   const configurationLocation = resolveFolder(
      settings.configurationlocation
      || settings.configurationLocation
      || process.env.application_design_contentfolder
   );

   const folderBase = resolveFolder(
      settings.folderBase
      || data.folderBase
   ) || configurationLocation;

   const targetFolderBase = resolveFolder(
      settings.targetFolderBase
      || process.env.application_design_datafolder
   );

   return {
      configurationLocation,
      folderBase,
      buildWorkflowName: settings.buildWorkflowName || DEFAULTS.buildWorkflowName,
      cron: settings.cron || DEFAULTS.cron,
      branch: settings.branch || DEFAULTS.branch,
      targetFolderBase,
      orphanCleanup: ORPHAN_MODES.has(String(settings.orphanCleanup || '').toLowerCase())
         ? String(settings.orphanCleanup).toLowerCase()
         : DEFAULTS.orphanCleanup,
      bitbucketUsername: process.env.BITBUCKET_USERNAME,
      bitbucketApiToken: process.env.BITBUCKET_API_TOKEN,
      // Where the file-based workflow bridge exchanges request/response files
      // (<appBaseDir>/workflow/.bridge). No backend HTTP self-call is made.
      appBaseDir: settings.appBaseDir || process.env.APP_BASE_DIR || undefined,
   };
}

/**
 * Join a child path onto a base using the base's path separator. The child's own
 * separators are normalised to the base's, so a Windows-style `A\B\C` Folder
 * value becomes nested directories on a POSIX host (and vice-versa) rather than a
 * single oddly-named directory. When `base` is empty the child is returned
 * unchanged.
 *
 * @param {string} base
 * @param {string} child
 * @returns {string}
 */
function joinTargetFolder(base, child) {
   if (!base) return String(child || '');
   const sep = base.includes('\\') ? '\\' : '/';
   const left = base.replace(/[\\/]+$/, '');
   const right = String(child || '')
      .replace(/^[\\/]+/, '')        // drop any leading separator
      .replace(/[\\/]+/g, sep);      // normalise interior separators to the base's
   return left + sep + right;
}

/**
 * True when a repository URL carries a LITERAL credential rather than a
 * placeholder — i.e. someone pasted a real username:token into the document
 * instead of leaving `[user]:[token]`. Used to warn loudly, since the secret is
 * then sitting in a wiki page that anyone with read access can see.
 *
 * @param {string} repository
 * @returns {boolean}
 */
function hasEmbeddedCredential(repository) {
   const match = String(repository || '').match(/^https?:\/\/([^/@]+)@/i);
   if (!match) return false;
   const credentials = match[1];
   // Placeholder forms are fine: `[user]:[token]` and `${VAR}:${VAR}`.
   return !credentials.includes('${') && !credentials.includes('[');
}

/**
 * Turn the document's templated repository URL into one the build workflow can
 * use, substituting the `[user]` / `[token]` placeholders for the env-var
 * placeholders the fetch-code step expands at run time. Keeping the placeholders
 * (rather than the literal secret) means no credential is ever written to the
 * schedule file or the document.
 *
 * `https://[user]:[token]@bitbucket.org/org/repo.git`
 *   -> `https://${BITBUCKET_USERNAME}:${BITBUCKET_API_TOKEN}@bitbucket.org/org/repo.git`
 *
 * A row whose URL carries a REAL credential is rewritten to the same env-var
 * placeholders rather than passed through. Previously it was passed through
 * verbatim — only the literal `[user]`/`[token]` strings were substituted — so a
 * pasted secret was copied straight into the on-disk schedule payload. The
 * credential of record is BITBUCKET_USERNAME / BITBUCKET_API_TOKEN in the
 * platform .env; a URL-embedded one is dropped here, never persisted.
 *
 * @param {string} repository
 * @returns {string}
 */
function toBuildRepoUrl(repository) {
   const templated = String(repository || '')
      .replace(/\[user\]/gi, '${BITBUCKET_USERNAME}')
      .replace(/\[token\]/gi, '${BITBUCKET_API_TOKEN}');

   if (!hasEmbeddedCredential(templated)) return templated;

   return templated.replace(
      /^(https?:\/\/)[^/@]+@/i,
      '$1${BITBUCKET_USERNAME}:${BITBUCKET_API_TOKEN}@'
   );
}

/** Normalise a schedule name for matching (trim + case-insensitive). */
function normalizeName(name) {
   return String(name == null ? '' : name).trim().toLowerCase();
}

/**
 * Create the folder structure for a repository row. Failures are logged and
 * swallowed so one un-creatable path does not abort the whole sweep (e.g. a
 * Windows target path on a POSIX host).
 *
 * @param {string} folder - resolved markdown output folder
 * @param {Object} logger
 * @returns {boolean} true when the folder exists after the call
 */
function ensureFolder(folder, logger) {
   if (!folder) return false;
   try {
      fs.mkdirSync(folder, { recursive: true });
      return true;
   } catch (error) {
      logger.warn('Source Repo Discovery: could not create folder', { folder, error: error.message });
      return false;
   }
}

/**
 * @async
 * @function run
 * @param {Object} data - workflow context / input
 * @returns {Promise<Object>} a completion summary
 */
async function run(data) {
   const logger = serviceRegistry.logger();
   const settings = resolveSettings(data);

   logger.info('Source Repo Discovery: starting', {
      configurationLocation: settings.configurationLocation,
      folderBase: settings.folderBase,
      buildWorkflowName: settings.buildWorkflowName,
   });

   if (!settings.configurationLocation) {
      throw new Error('Source Repo Discovery: settings.configurationlocation is required');
   }
   if (!settings.bitbucketUsername || !settings.bitbucketApiToken) {
      logger.warn('Source Repo Discovery: BITBUCKET_USERNAME / BITBUCKET_API_TOKEN are not both set in '
         + 'the platform .env — scheduled builds will fail to authenticate until they are');
   }

   // 1. Connect to the LIVE WorkflowBridge over the file bridge (no HTTP
   //    self-call) and pull the current schedules.
   const api = new WorkflowBridgeClient({
      appBaseDir: settings.appBaseDir,
      logger,
   });
   await api.authenticate(); // no-op; kept for interface parity
   const schedules = await api.listSchedules();
   const scheduleByName = new Map();
   for (const s of schedules) scheduleByName.set(normalizeName(s.name), s);

   // 1b. Read the build history. listSchedules reports WHEN a schedule last ran
   //     but never whether it SUCCEEDED, so a repo failing every night looked
   //     identical to a healthy one in the table. The execution records carry
   //     the outcome and the error, which is what actually goes in the cell.
   const executionByRepo = latestExecutionByRepo(
      api.appBaseDir, settings.buildWorkflowName, logger
   );

   // 2. Find every configuration document under the configuration folder.
   const documents = await findConfigurationDocuments(settings.configurationLocation);
   if (documents.length === 0) {
      logger.warn('Source Repo Discovery: no markdown documents found', {
         configurationLocation: settings.configurationLocation,
      });
   }

   const summary = {
      documentsProcessed: 0,
      reposSeen: 0,
      foldersCreated: 0,
      schedulesCreated: 0,
      statusUpdated: 0,
      created: [],
      updated: [],
      skipped: [],
      failing: [],
      orphans: { mode: settings.orphanCleanup, found: [], removed: [], errors: [], bytes: 0 },
   };

   // Every repository name any document claims, gathered across the whole sweep
   // so the orphan pass below can only run once ALL documents have been read.
   const knownNames = new Set();

   for (const docPath of documents) {
      const markdown = fs.readFileSync(docPath, 'utf8');
      const parsed = parseRepositoriesTable(markdown);
      if (!parsed) {
         // A configuration document without a repositories table is fine — skip.
         continue;
      }
      summary.documentsProcessed += 1;

      for (const row of parsed.rows) {
         summary.reposSeen += 1;
         knownNames.add(row.name);

         // Create the folder structure named in the row's "Folder" column,
         // resolved against the configured base. This is also the build's
         // markdown output folder.
         const markdownFolder = joinTargetFolder(settings.folderBase, row.folder);
         if (markdownFolder && ensureFolder(markdownFolder, logger)) {
            summary.foldersCreated += 1;
         }

         const existing = scheduleByName.get(normalizeName(row.name));

         if (existing) {
            // A schedule exists for this repo -> report its real outcome, so a
            // failing build is visible in the table rather than only in the logs.
            const execution = executionByRepo.get(row.name) || null;
            setStatus(row, statusFor({ schedule: existing, execution }));
            summary.statusUpdated += 1;

            const failed = !!execution
               && (execution.status === 'failed' || execution.outcome === 'failed');
            if (failed) {
               summary.failing.push({ name: row.name, error: execution.error || null });
               logger.warn('Source Repo Discovery: last build failed', {
                  repo: row.name,
                  when: execution.completedAt || execution.startedAt,
                  error: execution.error,
               });
            }
            summary.updated.push({
               name: row.name,
               lastRun: existing.lastRun || null,
               lastOutcome: execution ? (execution.outcome || execution.status) : null,
            });
            continue;
         }

         // No schedule yet. Only create one when the Status cell is empty, so
         // an operator who has filled it in by hand is never overwritten.
         if (row.status !== '') {
            summary.skipped.push({ name: row.name, reason: 'no schedule but Status not empty' });
            continue;
         }

         // A real credential in the document is a live secret exposure — the
         // page is readable by anyone with wiki access. It is stripped before
         // the schedule is written (see toBuildRepoUrl), but the operator needs
         // to know so they can rotate it and restore the placeholders.
         if (hasEmbeddedCredential(row.repository)) {
            logger.warn('Source Repo Discovery: repository URL contains a literal credential — it has '
               + 'been replaced with the ${BITBUCKET_USERNAME}/${BITBUCKET_API_TOKEN} placeholders for the '
               + 'schedule, but the secret is still in the document. Rotate it and restore [user]:[token].', {
               repo: row.name,
               document: docPath,
            });
         }

         // Per-repo Branch column, falling back to the workflow default ('main').
         // Not every repository's default branch is 'main' — one on 'master'
         // previously failed its very first clone, because GitService passes the
         // branch to `git clone --branch <b> --single-branch` and git treats an
         // absent branch as fatal ("Remote branch main not found in upstream
         // origin") rather than falling back to the remote's HEAD.
         const branch = row.branch || settings.branch;

         const repoUrl = toBuildRepoUrl(row.repository);
         const payload = {
            repoUrl,
            branch,
            targetFolder: joinTargetFolder(settings.targetFolderBase, row.name),
            markdownFolder,
         };

         try {
            const created = await api.createSchedule({
               workflowName: settings.buildWorkflowName,
               cron: settings.cron,
               name: row.name,
               payload,
            });
            // Remember it so a second document referencing the same repo in this
            // same run is treated as already-scheduled.
            scheduleByName.set(normalizeName(row.name), {
               name: row.name,
               lastRun: null,
               nextRun: created.nextRun,
            });
            setStatus(row, 'Scheduled — awaiting first run');
            summary.schedulesCreated += 1;
            summary.created.push({ name: row.name, scheduleId: created.scheduleId, nextRun: created.nextRun });
            logger.info('Source Repo Discovery: created schedule', {
               repo: row.name,
               scheduleId: created.scheduleId,
            });
         } catch (error) {
            // Don't fail the whole sweep because one repo could not be scheduled.
            logger.error('Source Repo Discovery: failed to create schedule', {
               repo: row.name,
               error: error.message,
            });
            summary.skipped.push({ name: row.name, reason: error.message });
         }
      }

      // 3. Write the document back only if a Status cell actually changed.
      const { markdown: nextMarkdown, changed } = serializeRepositoriesTable(parsed);
      if (changed) {
         fs.writeFileSync(docPath, nextMarkdown, 'utf8');
         logger.info('Source Repo Discovery: updated document', { docPath });
      }
   }

   // 4. Sweep the working folder for clones no document claims any more.
   //    Runs LAST, once every document has contributed its names — a per-document
   //    sweep would call a repo listed in the second document an orphan while
   //    reading the first.
   sweepOrphans({ settings, knownNames, summary, logger });

   logger.info('Source Repo Discovery: complete', summary);

   const orphanNote = summary.orphans.found.length === 0
      ? ''
      : summary.orphans.mode === 'remove'
         ? `, ${summary.orphans.removed.length} orphan(s) removed (${formatBytes(summary.orphans.bytes)})`
         : `, ${summary.orphans.found.length} orphan(s) found (${formatBytes(summary.orphans.bytes)}, not removed)`;

   return {
      message: `Source Repo Discovery: ${summary.reposSeen} repo(s) across `
         + `${summary.documentsProcessed} document(s) — `
         + `${summary.schedulesCreated} created, ${summary.statusUpdated} updated`
         + (summary.failing.length > 0 ? `, ${summary.failing.length} failing` : '')
         + orphanNote,
      ...summary,
      processedAt: new Date().toISOString(),
   };
}

/**
 * Report — and optionally remove — working folders that no listing document
 * claims any more.
 *
 * THE REFUSALS MATTER MORE THAN THE SWEEP. Deleting the wrong folder here costs
 * a full re-clone and a full re-documentation of every directory in it, paid in
 * AI calls, so the pass declines to act in every situation where "no document
 * claims this" might mean something other than what it says:
 *
 *   - NO DOCUMENTS PARSED. A mistyped `configurationlocation`, a content folder
 *     that has not mounted yet, a document whose table was accidentally
 *     malformed — each of these reads as "nothing is listed any more", and would
 *     otherwise delete every clone on the box. This is the single most important
 *     guard in the step.
 *   - NO NAMES GATHERED. Documents were found and parsed, but between them they
 *     listed nothing. Same reasoning.
 *   - NO WORKING FOLDER CONFIGURED, or it does not exist yet — nothing to sweep.
 *
 * Mutates `summary.orphans` in place; never throws.
 *
 * @param {Object} args
 * @param {Object} args.settings - resolved step settings
 * @param {Set<string>} args.knownNames - every `Name` seen across all documents
 * @param {Object} args.summary - the run summary being built
 * @param {Object} args.logger
 */
function sweepOrphans({ settings, knownNames, summary, logger }) {
   const mode = settings.orphanCleanup;
   if (mode === 'off') return;

   if (!settings.targetFolderBase) {
      logger.info('Source Repo Discovery: orphan sweep skipped — no working folder configured '
         + '(set application_design_datafolder, or targetFolderBase on the step)');
      return;
   }

   if (summary.documentsProcessed === 0 || knownNames.size === 0) {
      // Refusing loudly: silence here would look identical to "the working
      // folder is clean", which is exactly the wrong thing to believe.
      logger.warn('Source Repo Discovery: orphan sweep REFUSED — no repository rows were read, so '
         + 'every working folder would look orphaned. Check configurationlocation and the '
         + 'documents under it.', {
         configurationLocation: settings.configurationLocation,
         documentsProcessed: summary.documentsProcessed,
      });
      summary.orphans.refused = 'no repository rows were read';
      return;
   }

   const { orphans, kept, missing } = findOrphanedClones({
      dataFolder: settings.targetFolderBase,
      knownNames,
   });

   if (missing) {
      logger.info('Source Repo Discovery: orphan sweep skipped — working folder does not exist yet', {
         dataFolder: settings.targetFolderBase,
      });
      return;
   }

   summary.orphans.found = orphans.map((o) => ({
      name: o.name,
      folder: o.folder,
      statePath: o.statePath,
      bytes: o.bytes,
      size: formatBytes(o.bytes),
   }));
   summary.orphans.bytes = orphans.reduce((total, o) => total + o.bytes, 0);
   summary.orphans.kept = kept.length;

   if (orphans.length === 0) {
      logger.info('Source Repo Discovery: orphan sweep clean', { tracked: kept.length });
      return;
   }

   if (mode !== 'remove') {
      logger.warn(`Source Repo Discovery: ${orphans.length} orphaned working folder(s) — `
         + `${formatBytes(summary.orphans.bytes)} reclaimable. Not removed: orphanCleanup is `
         + `"${mode}". Set it to "remove" to delete them.`, {
         orphans: summary.orphans.found.map((o) => `${o.name} (${o.size})`),
      });
      return;
   }

   for (const orphan of orphans) {
      const result = removeOrphan(orphan);
      if (result.errors.length > 0) {
         summary.orphans.errors.push(...result.errors);
         logger.error('Source Repo Discovery: could not remove orphan', {
            repo: orphan.name,
            errors: result.errors,
         });
      }
      if (result.removed.length > 0) {
         summary.orphans.removed.push(orphan.name);
         logger.info('Source Repo Discovery: removed orphaned working folder', {
            repo: orphan.name,
            size: formatBytes(orphan.bytes),
            removed: result.removed,
         });
      }
   }
}

module.exports = {
   run, resolveSettings, toBuildRepoUrl, hasEmbeddedCredential, joinTargetFolder, sweepOrphans,
};
