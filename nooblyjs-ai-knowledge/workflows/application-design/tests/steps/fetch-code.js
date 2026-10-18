/**
 * @fileoverview Test the engineering-code fetch-code workflow step.
 *
 * Runs the fetch-code step directly (in-process): a first run clones the
 * repository, a second run fetches it. The step does no AI work, so only the
 * service registry is initialized (for serviceRegistry.logger()) — no Agents
 * registry is needed.
 *
 * Configure via environment variables (or rely on the defaults):
 *   GIT_TEST_REPO_URL - repo to clone (default: a small public GitHub repo)
 *   GIT_TEST_FOLDER   - local folder to clone into (default: a temp folder here)
 *   GIT_TEST_BRANCH   - branch to track (optional)
 *
 * Requires the `git` CLI and network access to the chosen repository.
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

// Load environment variables from the repository-root .env file.
require('dotenv').config({ path: path.join(__dirname, '../../../../.env') });

const serviceRegistry = require('nooblyjs-core');
const fetchCodeStep = require('../../steps/fetch-code');
const GitService = require('../../services/gitService');

const REPO_URL = process.env.GIT_TEST_REPO_URL || 'https://github.com/octocat/Hello-World.git';
const TMP = path.join(__dirname, '.tmp-fetchcode-test');
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

async function runTest() {
    console.log('fetch-code step test');

    // The fetch-code step only needs serviceRegistry.logger() — no AI agents.
    const app = express();
    app.use(express.json());
    serviceRegistry.initialize(app);

    // Start clean so the run is deterministic.
    rm(TARGET_FOLDER);
    rm(GitService.statePath(TARGET_FOLDER));

    const input = { repoUrl: REPO_URL, targetFolder: TARGET_FOLDER, branch: BRANCH };

    // 1. First run — clones, treated as a full pass.
    const first = await fetchCodeStep.run(input);
    console.log('First run:', JSON.stringify(first, null, 2));
    check('first run clones', first.action === 'clone');
    check('first run hasChanges = true', first.hasChanges === true);
    check('first run affectedDirectories = null (full pass)', first.affectedDirectories === null);
    check('first run reports a currentSha',
        typeof first.currentSha === 'string' && first.currentSha.length > 0);
    check('first run workingDestination is the target folder',
        first.workingDestination === TARGET_FOLDER);

    // Simulate the record-state step recording the just-processed commit.
    GitService.writeLastProcessedSha(TARGET_FOLDER, first.currentSha);

    // 2. Second run — fetches; no new commits since the recorded sha.
    const second = await fetchCodeStep.run(input);
    console.log('Second run:', JSON.stringify(second, null, 2));
    check('second run fetches', second.action === 'fetch');
    check('second run hasChanges = false', second.hasChanges === false);
    check('second run affectedDirectories is empty',
        Array.isArray(second.affectedDirectories) && second.affectedDirectories.length === 0);

    // Clean up what this test created.
    rm(TARGET_FOLDER);
    rm(GitService.statePath(TARGET_FOLDER));
    if (usingDefaultFolder) {
        rm(TMP);
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

runTest().catch((err) => {
    console.error('Test execution error:', err.message);
    process.exit(1);
});
