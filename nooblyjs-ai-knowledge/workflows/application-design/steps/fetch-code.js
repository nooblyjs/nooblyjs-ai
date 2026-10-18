/**
 * @fileoverview Step 1 (git pipeline) - Fetch Code: clone or fetch a git
 * repository, then work out which directories changed since the last commit
 * that was *successfully* documented, so only those are reprocessed.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';
const path = require('node:path');

// Load the knowledge platform's root .env so a workflow payload can reference
// secrets (e.g. ${BITBUCKET_API_TOKEN}) in repoUrl without committing them. The
// backend already loads this at startup; loading it here is idempotent (dotenv
// never overrides an existing process.env value) and keeps the step working
// when run standalone or from a scheduler worker thread.
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const serviceRegistry = require('nooblyjs-core');
const GitService = require('../services/gitService');

/**
 * Expand ${VAR} placeholders in a string from process.env.
 *
 * Lets a workflow's defaultInput keep credentials out of the committed payload:
 *   "https://srbooysen:${BITBUCKET_API_TOKEN}@bitbucket.org/org/repo.git"
 * Throws (naming the variable) when a referenced let is unset, so a missing
 * token fails loudly instead of attempting an unauthenticated clone. The token
 * is only ever materialised here, in-memory, on the way into GitService — which
 * redacts it from all logs and errors.
 *
 * @param {string} value
 * @returns {string}
 */
function expandEnv(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
        const resolved = process.env[name];
        if (resolved == null || resolved === '') {
            throw new Error(`Fetch Code: environment variable ${name} (referenced in repoUrl) is not set`);
        }
        return resolved;
    });
}

/**
 * Step 1 - Fetch Code
 *
 * @param {Object} data - Workflow context
 * @param {string} data.repoUrl - Git URL (may embed an access token, or a
 *   ${ENV_VAR} placeholder expanded from process.env — see expandEnv)
 * @param {string} data.targetFolder - Local folder to clone/fetch into
 * @param {string} [data.branch] - Branch to track (default: remote default)
 * @returns {Promise<Object>} Working folder + the directories that changed
 */
async function run(data) {
    const logger = serviceRegistry.logger();

    const repoUrl = data.repoUrl;
    const targetFolder = data.targetFolder;
    const branch = data.branch || null;

    if (!repoUrl) {
        throw new Error('Fetch Code: repoUrl is required');
    }
    if (!targetFolder) {
        throw new Error('Fetch Code: targetFolder is required');
    }

    logger.info('Step 1 - Fetch Code: Starting', { targetFolder, branch });

    // Expand ${ENV_VAR} placeholders (e.g. the access token) just-in-time.
    const git = new GitService({ repoUrl: expandEnv(repoUrl), targetFolder, branch, logger });

    // The last commit we *successfully* documented — null on the first run.
    const lastProcessedSha = GitService.readLastProcessedSha(targetFolder);

    // Clone (first run) or fetch + fast-forward (subsequent runs). After this
    // the working tree is at result.currentSha.
    const result = git.sync();
    const currentSha = result.currentSha;

    let hasChanges;
    let changedFiles;
    let affectedDirectories;

    if (result.action === 'clone' || !lastProcessedSha) {
        // First clone, or no processed commit recorded yet — document it all.
        hasChanges = true;
        changedFiles = null;          // null = no filter
        affectedDirectories = null;   // null = no filter
        logger.info('Step 1 - Fetch Code: full pass (first run)', { currentSha });
    } else if (lastProcessedSha === currentSha) {
        // Nothing new since the last successful run.
        hasChanges = false;
        changedFiles = [];
        affectedDirectories = [];
        logger.info('Step 1 - Fetch Code: no new commits', { currentSha });
    } else {
        // Diff from the last *successfully processed* commit (not local HEAD),
        // so commits from a previously failed run are not silently skipped.
        try {
            changedFiles = git.diffNames(lastProcessedSha, currentSha);
            affectedDirectories = GitService.affectedDirectories(changedFiles);

            // Deletions need their parents reprocessed: a removed directory is
            // never walked by the bottom-up processor, so without this its
            // nearest surviving parent would keep a stale child summary. Mark
            // every ancestor of each deleted path affected; the nearest one that
            // still exists regenerates and the orphaned .home.md is pruned in the
            // Process step. (Edits/adds are already covered by the traversal.)
            const deletedFiles = git.diffNames(lastProcessedSha, currentSha, 'D');
            if (deletedFiles.length > 0) {
                const seen = new Set(affectedDirectories);
                for (const dir of GitService.ancestorDirectories(deletedFiles)) {
                    if (!seen.has(dir)) {
                        seen.add(dir);
                        affectedDirectories.push(dir);
                    }
                }
            }

            hasChanges = true;
            logger.info('Step 1 - Fetch Code: incremental', {
                from: lastProcessedSha.slice(0, 7),
                to: currentSha.slice(0, 7),
                changedFiles: changedFiles.length,
                deletedFiles: deletedFiles.length,
                affectedDirectories: affectedDirectories.length
            });
        } catch (error) {
            // lastProcessedSha may be unreachable (e.g. history was rewritten).
            // Fall back to a full pass rather than miss changes.
            logger.warn('Step 1 - Fetch Code: diff failed, doing a full pass', {
                error: error.message
            });
            hasChanges = true;
            changedFiles = null;
            affectedDirectories = null;
        }
    }

    return {
        message: `Fetch Code: ${result.action} — ${hasChanges ? 'changes detected' : 'no changes'}`,
        workingDestination: targetFolder,
        currentSha: currentSha,
        lastProcessedSha: lastProcessedSha,
        hasChanges: hasChanges,
        changedFiles: changedFiles,
        affectedDirectories: affectedDirectories,
        action: result.action,
        processedAt: new Date().toISOString()
    };
}

module.exports = { run };
