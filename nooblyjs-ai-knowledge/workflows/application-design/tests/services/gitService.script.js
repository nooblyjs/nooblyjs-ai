/**
 * @fileoverview GitService test — exercises clone/fetch, diff and state
 * tracking directly against the GitService class (no workflow engine).
 *
 * Configure via environment variables (or rely on the defaults):
 *   GIT_TEST_REPO_URL - repo to clone (default: a small public GitHub repo)
 *   GIT_TEST_FOLDER   - local folder to clone into (default: a temp folder here)
 *   GIT_TEST_BRANCH   - branch to track (optional)
 *
 * A token may be embedded in GIT_TEST_REPO_URL for private repos. Requires the
 * `git` CLI and network access to the chosen repository.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

// Load environment variables from the repository-root .env file.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const GitService = require('../../services/gitService');

const REPO_URL = process.env.GIT_TEST_REPO_URL || 'https://github.com/octocat/Hello-World.git';
const TMP = path.join(__dirname, '.tmp-gitservice-test');
const TARGET_FOLDER = process.env.GIT_TEST_FOLDER || path.join(TMP, 'repo');
const BRANCH = process.env.GIT_TEST_BRANCH || null;
const usingDefaultFolder = !process.env.GIT_TEST_FOLDER;

let passed = 0;
let failed = 0;

/** Record an assertion result. */
function check(label, condition) {
    if (condition) {
        passed++;
        console.log(`  PASS  ${label}`);
    } else {
        failed++;
        console.error(`  FAIL  ${label}`);
    }
}

/** Remove a path, ignoring any error (best-effort cleanup). */
function rm(target) {
    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    } catch (err) {
        /* ignore */
    }
}

function runTest() {
    console.log('GitService test');
    console.log(`  repo:   ${REPO_URL.replace(/\/\/[^/@]+@/, '//***@')}`);
    console.log(`  folder: ${TARGET_FOLDER}`);

    // Start clean so the run is deterministic: a clone, then a fetch.
    rm(TARGET_FOLDER);
    rm(GitService.statePath(TARGET_FOLDER));

    const git = new GitService({ repoUrl: REPO_URL, targetFolder: TARGET_FOLDER, branch: BRANCH });

    // 1. First sync — the folder does not exist, so it clones.
    const first = git.sync();
    check('first sync clones', first.action === 'clone');
    check('clone reports a currentSha', typeof first.currentSha === 'string' && first.currentSha.length > 0);
    check('clone has no previousSha', first.previousSha === null);
    check('clone hasChanges = true', first.hasChanges === true);
    check('clone affectedDirectories = null (process everything)', first.affectedDirectories === null);
    check('target folder is now a git repo', git.isGitRepo());

    // 2. Second sync — the folder exists, so it fetches; no new commits.
    const second = git.sync();
    check('second sync fetches', second.action === 'fetch');
    check('fetch finds no new commits', second.hasChanges === false);
    check('fetch currentSha matches the clone', second.currentSha === first.currentSha);
    check('fetch changedFiles is empty', Array.isArray(second.changedFiles) && second.changedFiles.length === 0);

    // 3. diffNames of a commit against itself is empty.
    check('diffNames(sha, sha) is empty', git.diffNames(first.currentSha, first.currentSha).length === 0);

    // 4. State file round-trip.
    rm(GitService.statePath(TARGET_FOLDER));
    check('readLastProcessedSha is null before any write',
        GitService.readLastProcessedSha(TARGET_FOLDER) === null);
    GitService.writeLastProcessedSha(TARGET_FOLDER, first.currentSha);
    check('readLastProcessedSha returns the written sha',
        GitService.readLastProcessedSha(TARGET_FOLDER) === first.currentSha);

    // 5. affectedDirectories helper.
    const dirs = GitService.affectedDirectories(['a/b/x.js', 'a/y.js', 'z.js']);
    check('affectedDirectories derives unique dirs',
        dirs.length === 3 && dirs.includes('a/b') && dirs.includes('a') && dirs.includes(''));

    // 6. ancestorDirectories helper — every parent of a deleted path, up to root.
    const ancestors = GitService.ancestorDirectories(['a/b/c/gone.js']);
    check('ancestorDirectories includes the full parent chain to root',
        ancestors.includes('a/b/c') && ancestors.includes('a/b')
        && ancestors.includes('a') && ancestors.includes(''));
    check('ancestorDirectories of a root-level file is just the root',
        JSON.stringify(GitService.ancestorDirectories(['top.js'])) === JSON.stringify(['']));

    // Clean up what this test created.
    rm(TARGET_FOLDER);
    rm(GitService.statePath(TARGET_FOLDER));
    if (usingDefaultFolder) {
        rm(TMP);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

try {
    runTest();
} catch (err) {
    console.error('Test execution error:', err.message);
    process.exit(1);
}
