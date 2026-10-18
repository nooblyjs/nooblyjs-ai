/**
 * @fileoverview Git Service
 *
 * Clones or fetches a git repository into a local folder and reports which
 * files changed since the previous run. Designed to feed incremental work
 * (e.g. the CodeProcessor) so AI tokens are only spent on changed code:
 *
 *   - First run  → the folder does not exist → `git clone`. Everything is new.
 *   - Later runs → the folder exists         → `git fetch` + fast-forward, and
 *                  `git diff` reports exactly which files changed.
 *
 * The repository URL is expected to embed an access token, e.g.
 *   https://x-access-token:<TOKEN>@github.com/org/repo.git
 * The token is never written to logs — every URL is redacted first.
 *
 * Requires the `git` CLI to be available on PATH.
 *
 * @constructor    - Receive { repoUrl, targetFolder, branch?, logger?, timeout? }
 * @method sync    - Clone (first run) or fetch (subsequent runs); reports changes
 * @method clone   - Clone the repository (first run)
 * @method fetch   - Fetch + fast-forward an existing clone, diff against the old HEAD
 * @method diffNames - List files changed between two commits
 * @method isGitRepo - Whether targetFolder is already a git working tree
 * @method statePath - (static) Sidecar state file path for a clone
 * @method readLastProcessedSha  - (static) Read the last processed commit SHA
 * @method writeLastProcessedSha - (static) Record the last processed commit SHA
 *
 * @author NooblyJS Team
 * @version 1.0.0
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Replace the `user:token@` portion of a URL with `***` so tokens never
 * reach logs or error messages.
 * @param {string} url
 * @returns {string}
 */
function redactUrl(url) {
    return String(url || '').replace(/\/\/[^/@]+@/, '//***@');
}

class GitService {

    /**
     * @param {Object} settings
     * @param {string} settings.repoUrl - Git URL; may embed an access token
     * @param {string} settings.targetFolder - Local folder to clone/fetch into
     * @param {string} [settings.branch] - Branch to track (default: remote default)
     * @param {Object} [settings.logger] - Optional logger (info/warn/error)
     * @param {number} [settings.timeout] - Per-command timeout in ms (default: 120000)
     */
    constructor(settings) {
        this.repoUrl = settings.repoUrl;
        this.targetFolder = settings.targetFolder;
        this.branch = settings.branch || null;
        this.logger = settings.logger || null;
        this.timeout = settings.timeout || 120000;
    }

    /** Log via the injected logger, if any. */
    log(level, message) {
        if (this.logger && typeof this.logger[level] === 'function') {
            this.logger[level](message);
        }
    }

    /**
     * Run a git command and return trimmed stdout.
     * Any token in the command/output is redacted before the error is thrown.
     * @param {string[]} args - Arguments to `git`
     * @returns {string}
     */
    git(args) {
        try {
            return execFileSync('git', args, {
                timeout: this.timeout,
                encoding: 'utf-8',
                stdio: ['ignore', 'pipe', 'pipe']
            }).trim();
        } catch (err) {
            const detail = redactUrl((err.stderr || err.message || '').toString().trim());
            throw new Error(`git ${args[0]} failed: ${detail}`);
        }
    }

    /** @returns {boolean} True if targetFolder is an existing git working tree. */
    isGitRepo() {
        return fs.existsSync(path.join(this.targetFolder, '.git'));
    }

    /**
     * Normalise a path to forward slashes.
     *
     * Every directory path this class hands downstream is a POSIX-style path,
     * because that is what git emits and it is the only form that is stable
     * across hosts. The consumer (CodeProcessor.isAffectedDirectory) normalises
     * its own side the same way before comparing — see the note there.
     *
     * @param {string} p
     * @returns {string}
     */
    static toPosix(p) {
        return String(p == null ? '' : p).replace(/\\/g, '/');
    }

    /**
     * Derive the set of directories containing the given changed files.
     * Paths are relative to the repo root and always forward-slashed; the root
     * itself is ''.
     * @param {string[]} changedFiles
     * @returns {string[]}
     */
    static affectedDirectories(changedFiles) {
        const dirs = new Set();
        for (const file of changedFiles) {
            // path.posix, not path — on Windows path.dirname would preserve
            // whatever separator the input used, producing a mixed-separator
            // list that no consumer can match reliably.
            const dir = path.posix.dirname(GitService.toPosix(file));
            dirs.add(dir === '.' ? '' : dir);
        }
        return Array.from(dirs);
    }

    /**
     * Derive every ancestor directory of the given paths, up to and including
     * the repo root (''). Used for deletions: a removed directory is never
     * visited by the bottom-up processor, so its surviving parents must be
     * marked affected to drop the vanished child from their documentation.
     * Returned paths are forward-slashed, as with {@link affectedDirectories}.
     * @param {string[]} paths
     * @returns {string[]}
     */
    static ancestorDirectories(paths) {
        const dirs = new Set();
        for (const p of paths) {
            let dir = path.posix.dirname(GitService.toPosix(p));
            while (true) {
                dirs.add(dir === '.' ? '' : dir);
                const parent = path.posix.dirname(dir);
                if (parent === dir || dir === '.' || dir === '') break;
                dir = parent;
            }
        }
        return Array.from(dirs);
    }

    /**
     * Synchronise the local clone with the remote: clone on the first run,
     * fetch + fast-forward afterwards.
     *
     * @returns {Object} result
     * @returns {('clone'|'fetch')} result.action
     * @returns {string} result.targetFolder
     * @returns {?string} result.previousSha - HEAD before this run (null on clone)
     * @returns {string} result.currentSha - HEAD after this run
     * @returns {boolean} result.hasChanges - false only when a fetch found no new commits
     * @returns {?string[]} result.changedFiles - changed paths; null on clone (= "all")
     * @returns {?string[]} result.affectedDirectories - dirs to reprocess; null on clone
     */
    sync() {
        if (!this.repoUrl) {
            throw new Error('GitService: repoUrl is required');
        }
        if (!this.targetFolder) {
            throw new Error('GitService: targetFolder is required');
        }
        return this.isGitRepo() ? this.fetch() : this.clone();
    }

    /**
     * First run: clone the repository. Everything is treated as new, so
     * changedFiles / affectedDirectories are null (no filter = process all).
     * @returns {Object} sync result
     */
    clone() {
        this.log('info', `Git clone: ${redactUrl(this.repoUrl)} -> ${this.targetFolder}`);

        // git clone creates the target folder, but its parent must exist.
        fs.mkdirSync(path.dirname(this.targetFolder), { recursive: true });

        const args = ['clone'];
        if (this.branch) {
            args.push('--branch', this.branch, '--single-branch');
        }
        args.push(this.repoUrl, this.targetFolder);
        this.git(args);

        const currentSha = this.git(['-C', this.targetFolder, 'rev-parse', 'HEAD']);
        this.log('info', `Git clone complete at ${currentSha}`);

        return {
            action: 'clone',
            targetFolder: this.targetFolder,
            previousSha: null,
            currentSha,
            hasChanges: true,
            changedFiles: null,        // null = no filter, process everything
            affectedDirectories: null  // null = no filter
        };
    }

    /**
     * Subsequent run: fetch the remote, diff against the old HEAD, then
     * fast-forward the working tree to the fetched commit.
     * @returns {Object} sync result
     */
    fetch() {
        const folder = this.targetFolder;
        this.log('info', `Git fetch: ${redactUrl(this.repoUrl)} in ${folder}`);

        // Refresh the stored remote URL so a rotated token is always applied.
        this.git(['-C', folder, 'remote', 'set-url', 'origin', this.repoUrl]);

        const previousSha = this.git(['-C', folder, 'rev-parse', 'HEAD']);
        this.git(['-C', folder, 'fetch', 'origin']);

        // Resolve the ref being tracked, then its commit.
        const targetRef = this.branch
            ? `origin/${this.branch}`
            : this.git(['-C', folder, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
        const currentSha = this.git(['-C', folder, 'rev-parse', targetRef]);

        // No new commits — nothing to process, no tokens to spend.
        if (previousSha === currentSha) {
            this.log('info', `Git fetch: no new commits (${currentSha})`);
            return {
                action: 'fetch',
                targetFolder: folder,
                previousSha,
                currentSha,
                hasChanges: false,
                changedFiles: [],
                affectedDirectories: []
            };
        }

        // Files changed between the old and the new commit.
        const diff = this.git(['-C', folder, 'diff', '--name-only', previousSha, currentSha]);
        const changedFiles = diff ? diff.split('\n').filter(Boolean) : [];

        // Update the working tree to the fetched commit so callers read new code.
        this.git(['-C', folder, 'reset', '--hard', currentSha]);

        this.log('info',
            `Git fetch: ${changedFiles.length} file(s) changed `
            + `${previousSha.slice(0, 7)}..${currentSha.slice(0, 7)}`);

        return {
            action: 'fetch',
            targetFolder: folder,
            previousSha,
            currentSha,
            hasChanges: true,
            changedFiles,
            affectedDirectories: GitService.affectedDirectories(changedFiles)
        };
    }

    /**
     * List the files that differ between two commits.
     * @param {string} fromSha - Base commit
     * @param {string} toSha - Target commit
     * @param {?string} [diffFilter] - Optional git `--diff-filter` value, e.g.
     *   'D' to list only deletions. Omit for every change type.
     * @returns {string[]} Changed file paths, relative to the repo root
     */
    diffNames(fromSha, toSha, diffFilter = null) {
        const args = ['-C', this.targetFolder, 'diff', '--name-only'];
        if (diffFilter) args.push(`--diff-filter=${diffFilter}`);
        args.push(fromSha, toSha);
        const out = this.git(args);
        return out ? out.split('\n').filter(Boolean) : [];
    }

    /**
     * Path of the sidecar state file that records the last processed commit
     * for a clone. Lives beside the clone, never inside it, e.g.
     *   C:\repos\myrepo  ->  C:\repos\.myrepo.state.json
     * @param {string} targetFolder
     * @returns {string}
     */
    static statePath(targetFolder) {
        const folder = String(targetFolder).replace(/[\\/]+$/, '');
        return path.join(path.dirname(folder), `.${path.basename(folder)}.state.json`);
    }

    /**
     * Read the last successfully-processed commit SHA for a clone.
     * @param {string} targetFolder
     * @returns {?string} The SHA, or null if no state has been recorded
     */
    static readLastProcessedSha(targetFolder) {
        try {
            const raw = fs.readFileSync(GitService.statePath(targetFolder), 'utf-8');
            return JSON.parse(raw).lastProcessedSha || null;
        } catch (err) {
            return null;
        }
    }

    /**
     * Record the last successfully-processed commit SHA for a clone.
     * @param {string} targetFolder
     * @param {string} sha
     */
    static writeLastProcessedSha(targetFolder, sha) {
        const state = { lastProcessedSha: sha, updatedAt: new Date().toISOString() };
        fs.writeFileSync(
            GitService.statePath(targetFolder),
            JSON.stringify(state, null, 2),
            'utf-8'
        );
    }
}

module.exports = GitService;
