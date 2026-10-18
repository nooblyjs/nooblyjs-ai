/**
 * @fileoverview Git Repositories bootstrap.
 *
 * On startup this reads `<APP_BASE_DIR>/spaces/repositories.json` and, for every
 * enabled entry, registers a Git filing service in the digital-technologies-core
 * service registry (provider 'git', keyed filing:git:<instanceName>). Because the
 * filer is a first-class registry service it is monitored by the core services
 * module alongside every other service.
 *
 * The GitFilingProvider does the heavy lifting:
 *   - clone-if-missing: initialize() only clones when the target has no .git, so a
 *     repository that is already cloned is left untouched (no re-clone),
 *   - periodic fetch: when `synchronization.fetch` is true it fetches (and pulls
 *     with conflict resolution) on the configured interval,
 *   - periodic commit + push: when `synchronization.commit` is true it stages all
 *     local changes, commits and pushes on the configured interval.
 *
 * repositories.json entry shape:
 * {
 *   "id": 1,
 *   "name": "Engineering Collaboration Space",
 *   "repository": "https://{BITBUCKET_USERNAME}:{BITBUCKET_API_TOKEN}@bitbucket.org/org/repo",
 *   "localFolder": "C:\\path\\to\\local\\clone",
 *   "branch": "main",                      // optional (default: main)
 *   "depth": 1,                            // optional; shallow clone, 0/absent = full
 *   "synchronization": {
 *     "enabled": true,                     // false → entry skipped entirely
 *     "interval": 3600,                    // seconds; used for BOTH fetch & commit timers
 *     "fetch": false,                      // periodic fetch/pull
 *     "commit": true                       // periodic commit + push of local changes
 *   }
 * }
 *
 * `{PLACEHOLDER}` tokens in `repository` / `localFolder` are expanded from
 * process.env (e.g. {BITBUCKET_API_TOKEN}), so credentials stay in .env.
 *
 * A RELATIVE `localFolder` is resolved against APP_BASE_DIR, never against
 * `process.cwd()`. This used to be a bare `path.resolve(localFolder)`, which is
 * the same trap CLAUDE.md documents for the settings service: a second implicit
 * root that drifts from APP_BASE_DIR. It resolved correctly only while the app was
 * started from the repository root, so the SAME repositories.json described
 * different folders depending on how the process was launched — and a wrong answer
 * here does not fail loudly, it silently clones a second copy somewhere else while
 * the real clone goes unsynced. An ABSOLUTE localFolder is unaffected (path.resolve
 * ignores the base), which is the recommended form for a production host.
 *
 * A slow clone must never delay the HTTP server binding its port, so each filer is
 * REGISTERED synchronously (fast) and its clone + timer start runs in the
 * background; failures are logged per-repository and never abort startup.
 *
 * Because that background work is the ONLY place a clone can fail, its outcome is
 * recorded per instance in `setupState` and served to the Repositories screen —
 * see recordSetup() below.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fsp = require('node:fs').promises;
const { execFile } = require('node:child_process');

const { startup } = require('../startup/startupRunner');

/**
 * `git clone --depth`, run directly rather than through the filing provider.
 *
 * The core provider's `_cloneRepository` takes no options — it is a bare
 * `git.clone(url, path)` — so a shallow clone cannot be requested through it. It
 * does not need to be: `initialize()` only clones when `.git` is ABSENT, so
 * putting a shallow clone in place first is enough, and the provider then adopts
 * it exactly as it would a folder cloned by hand.
 *
 * `execFile`, never `exec`: the URL carries `user:token@` credentials, and an
 * argument array can never be re-parsed by a shell. Failures are returned rather
 * than thrown so the caller can fall back to the provider's full clone.
 *
 * @param {Object} params
 * @param {string} params.repoUrl Credentialed clone URL.
 * @param {string} params.localPath Clone destination.
 * @param {string} params.branch
 * @param {number} params.depth
 * @param {number=} params.timeoutMs
 * @return {Promise<{ok: boolean, error: ?string}>}
 */
function shallowClone({ repoUrl, localPath, branch, depth, timeoutMs = 15 * 60 * 1000 }) {
  const args = [
    'clone',
    `--depth=${depth}`,
    '--single-branch',
    '--branch', branch,
    repoUrl,
    localPath
  ];
  return new Promise((resolve) => {
    execFile('git', args, { timeout: timeoutMs, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) {
        // stderr can echo the URL, so redact before it reaches a log.
        resolve({ ok: false, error: redactUrl(String(stderr || err.message).trim()) });
        return;
      }
      resolve({ ok: true, error: null });
    });
  });
}

/**
 * Expand `{VAR}` placeholders in a string using process.env. Unknown variables
 * are left as-is (so the failure surfaces visibly rather than silently blanking).
 * @param {string} value
 * @returns {string}
 */
function expandEnvPlaceholders(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
    const resolved = process.env[name];
    return resolved === undefined ? match : resolved;
  });
}

/**
 * Resolve a configured `localFolder` to an absolute path.
 *
 * THE BASE IS APP_BASE_DIR, NOT process.cwd() — see the file header. Placeholder
 * expansion happens here too so every caller resolves a path the same way; two
 * callers doing it separately is how the analytics screen came to report a folder
 * the manager was not actually using.
 *
 * @param {string} localFolder Raw `localFolder` from repositories.json.
 * @param {string} appBaseDir Resolved APP_BASE_DIR.
 * @returns {?string} Absolute path, or null when localFolder is empty.
 */
function resolveLocalFolder(localFolder, appBaseDir) {
  const expanded = expandEnvPlaceholders(localFolder);
  if (!expanded) return null;
  // An absolute `expanded` wins outright — path.resolve ignores the base then.
  return path.resolve(appBaseDir, expanded);
}

/**
 * Redact embedded `user:token@` credentials in a URL for safe logging.
 * @param {string} url
 * @returns {string}
 */
function redactUrl(url) {
  try {
    return String(url).replace(/\/\/[^/@]+@/, '//***@');
  } catch {
    return '***';
  }
}

/**
 * Build a stable registry instance name for a repository entry.
 * @param {object} repo
 * @returns {string}
 */
function instanceNameFor(repo) {
  const slug = String(repo.name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return `repo-${slug}`;
  if (repo.id !== undefined && repo.id !== null) return `repo-${repo.id}`;
  return 'repo-unnamed';
}

/**
 * Outcome of a repository's background clone + timer start.
 *
 * WHY THIS EXISTS. The clone runs detached from startup so a slow one cannot hold
 * the port, which means its failure has nowhere to be returned TO — it was only
 * ever logged (`Git repositories: "<name>" setup failed:`). A misconfigured
 * `localFolder` therefore presented as a repository that simply never synced:
 * the screen showed it registered, auto-fetch "On", and an interval, because all
 * three are read from the config rather than from anything that ran. Observed
 * live — two entries pointed one directory above their real clones and sat
 * unsynced for three weeks with nothing on screen to say so.
 *
 * In memory only, and keyed by instance name. A restart re-runs every clone, so
 * there is no state here worth persisting — only state worth REPORTING.
 * @enum {string}
 */
const SetupStatus = {
  /** Registered; the background clone/init has not finished yet. */
  PENDING: 'pending',
  /** initialize() completed — the filer is live. */
  READY: 'ready',
  /** initialize() threw. `error` says why. */
  FAILED: 'failed',
  /** Deliberately not attempted (target is non-empty and has no .git). */
  SKIPPED: 'skipped'
};

/** instanceName → { status, error, at, localPath, name }. */
const setupState = new Map();

/**
 * Record (or update) one repository's setup outcome.
 * @param {string} instanceName
 * @param {Object} patch Fields to merge; `status` should be a SetupStatus.
 * @returns {void}
 */
function recordSetup(instanceName, patch) {
  const current = setupState.get(instanceName) || {};
  setupState.set(instanceName, { ...current, ...patch, at: new Date().toISOString() });
}

/**
 * @param {string} instanceName
 * @returns {?Object} Setup outcome, or null when this instance never registered
 *   (entry absent from repositories.json, or `synchronization.enabled: false`).
 */
function getSetupState(instanceName) {
  return setupState.get(instanceName) || null;
}

/**
 * @param {string} target
 * @returns {Promise<boolean>} true when the path exists.
 */
async function pathExists(target) {
  try {
    await fsp.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} localPath
 * @returns {Promise<boolean>} true when the folder already contains a git clone.
 */
async function hasGitRepo(localPath) {
  try {
    await fsp.access(path.join(localPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} localPath
 * @returns {Promise<boolean>} true when the target is safe to clone into
 *   (missing, or an empty directory).
 */
async function isCleanTarget(localPath) {
  try {
    const entries = await fsp.readdir(localPath);
    return entries.length === 0;
  } catch (err) {
    if (err.code === 'ENOENT') return true; // missing → clean
    throw err;
  }
}

/**
 * Register + start git filing services for every enabled repository.
 *
 * @param {object} context
 * @param {object} context.serviceRegistry - digital-technologies-core registry
 * @param {string} context.appBaseDir      - resolved APP_BASE_DIR
 * @param {object} context.log             - structured logger
 * @param {import('events').EventEmitter} [context.eventEmitter]
 * @returns {Promise<Array<object>>} summary of registered repositories
 */
async function initializeRepositories(context) {
  const { serviceRegistry, appBaseDir, log, eventEmitter } = context;
  const configPath = path.join(appBaseDir, 'spaces', 'repositories.json');

  let raw;
  try {
    raw = await fsp.readFile(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      log.info(`Git repositories: no config at ${configPath} — bootstrap skipped.`);
      return [];
    }
    log.error(`Git repositories: failed to read ${configPath}: ${err.message}`);
    return [];
  }

  let repos;
  try {
    repos = JSON.parse(raw);
  } catch (err) {
    log.error(`Git repositories: ${configPath} is not valid JSON: ${err.message}`);
    return [];
  }
  if (!Array.isArray(repos)) {
    log.error('Git repositories: repositories.json must be a JSON array.');
    return [];
  }

  const summary = [];

  for (const repo of repos) {
    const name = (repo && repo.name) || `repo-${repo && repo.id}`;
    try {
      const sync = (repo && repo.synchronization) || {};

      if (sync.enabled === false) {
        log.info(`Git repositories: "${name}" disabled (synchronization.enabled=false) — skipped.`);
        continue;
      }

      const repoUrl = expandEnvPlaceholders(repo.repository);
      const localPath = resolveLocalFolder(repo.localFolder, appBaseDir);
      if (!repoUrl || !localPath) {
        log.warn(`Git repositories: "${name}" missing repository URL or localFolder — skipped.`);
        continue;
      }

      const intervalSeconds = Number(sync.interval) > 0 ? Number(sync.interval) : 3600;
      const intervalMs = intervalSeconds * 1000;
      const autoFetch = sync.fetch === true;
      const autoCommit = sync.commit === true;
      const instanceName = instanceNameFor(repo);
      // `depth` (per repo, or REPOSITORY_CLONE_DEPTH for all) clones only the
      // most recent commits. On these content repositories history is roughly
      // half the clone — machine-written documents whose bodies are single-line
      // base64 images, re-rendered and re-committed hourly — so a new host that
      // clones shallow never downloads it. Absent/0 keeps the full clone.
      const cloneDepth = Number(repo.depth) > 0
        ? Math.floor(Number(repo.depth))
        : (Number(process.env.REPOSITORY_CLONE_DEPTH) > 0
          ? Math.floor(Number(process.env.REPOSITORY_CLONE_DEPTH))
          : 0);
      const branch = repo.branch || 'main';

      // Register the git filer in the core service registry (synchronous, fast).
      // Keyed filing:git:<instanceName> so multiple repos coexist and each is
      // monitored by the core services module.
      const filer = serviceRegistry.getService('filing', 'git', {
        instanceName,
        repoUrl,
        localPath,
        branch,
        autoFetch,
        fetchInterval: intervalMs,
        autoCommit,
        commitInterval: intervalMs,
        commitMessage: repo.commitMessage || `Auto-sync: ${name}`,
        userName: repo.userName || process.env.GIT_COMMIT_NAME || 'noobly Wiki Sync',
        userEmail: repo.userEmail || process.env.GIT_COMMIT_EMAIL || 'sync@noobly.local'
      });

      summary.push({ name, instanceName, localPath, autoFetch, autoCommit, intervalSeconds, cloneDepth });
      recordSetup(instanceName, { status: SetupStatus.PENDING, name, localPath, error: null });

      // Clone (only when needed) + start the fetch/commit timers in the
      // background so a large clone never blocks the server from listening.
      // Timed per repository so the startup profile shows which clone is slow.
      startup.track(`repositories:clone:${instanceName}`, async () => {
        try {
          if (await hasGitRepo(localPath)) {
            log.info(`Git repositories: "${name}" already cloned at ${localPath} — skipping initial clone.`);
          } else if (!(await isCleanTarget(localPath))) {
            const reason = `Target ${localPath} is not empty and has no .git, so it was not cloned `
              + 'into — that would overwrite whatever is already there. Point localFolder at the '
              + 'existing clone, at an empty directory, or remove it, then restart.';
            log.warn(`Git repositories: "${name}" ${reason} (Service is registered but not started.)`);
            recordSetup(instanceName, { status: SetupStatus.SKIPPED, error: reason });
            return;
          } else if (cloneDepth > 0) {
            // Shallow clone FIRST, so initialize() finds .git present and adopts
            // it instead of running its own full clone. A failure here is not
            // fatal — fall through and let the provider clone in full, because a
            // repository that is present and large beats one that is absent.
            log.info(
              `Git repositories: cloning "${name}" SHALLOW (depth=${cloneDepth}) → ${localPath} `
              + `(${redactUrl(repoUrl)})`
            );
            const outcome = await shallowClone({ repoUrl, localPath, branch, depth: cloneDepth });
            if (!outcome.ok) {
              log.warn(
                `Git repositories: shallow clone of "${name}" failed (${outcome.error}) — `
                + 'falling back to a full clone.'
              );
              // git leaves a partial directory behind on a failed clone, and the
              // provider refuses to clone into a non-empty target.
              await fsp.rm(localPath, { recursive: true, force: true }).catch(() => {});
            }
          } else {
            log.info(`Git repositories: cloning "${name}" → ${localPath} (${redactUrl(repoUrl)})`);
          }

          // initialize(): clones iff .git is absent, then starts auto-fetch /
          // auto-commit timers per the options above.
          await filer.initialize();

          recordSetup(instanceName, { status: SetupStatus.READY, error: null });
          log.info(
            `✓ Git repositories: "${name}" ready [instance=${instanceName}] ` +
            `fetch=${autoFetch} commit=${autoCommit} interval=${intervalSeconds}s ` +
            `depth=${cloneDepth > 0 ? cloneDepth : 'full'}`
          );
          eventEmitter?.emit?.('repositories:ready', { name, instanceName, localPath });
        } catch (err) {
          // REDACT: a failing `git clone` echoes the URL it was given, and this
          // message is served to a browser by the Repositories screen.
          const error = redactUrl(err.message);
          recordSetup(instanceName, { status: SetupStatus.FAILED, error });
          log.error(`Git repositories: "${name}" setup failed: ${error}`);
          eventEmitter?.emit?.('repositories:error', { name, instanceName, error });
        }
      });
    } catch (err) {
      log.error(`Git repositories: "${name}" could not be registered: ${err.message}`);
    }
  }

  if (summary.length) {
    log.info(`✓ Git repositories: ${summary.length} filer(s) registered in the service registry.`);
  }
  eventEmitter?.emit?.('repositories:initialized', { repositories: summary });
  return summary;
}

/**
 * Read repositories.json and return a browser-safe, normalised view of every
 * configured repository. The `repository` URL is REDACTED (embedded credentials
 * stripped) so this list can be sent to the frontend. Each entry carries the
 * derived `instanceName` used to look the live filer up in the service registry.
 *
 * Each entry also reports what is ACTUALLY on disk at `localFolder` right now
 * (`localFolderExists` / `cloned`) alongside `setup`, the recorded outcome of the
 * boot-time clone. The two answer different questions and both are needed: `setup`
 * explains why a repository never started, while the disk check catches a
 * repositories.json that has been CORRECTED but not yet restarted into — where the
 * stored outcome is a stale failure describing a path no longer configured.
 *
 * @param {string} appBaseDir - resolved APP_BASE_DIR
 * @returns {Promise<Array<object>>}
 */
async function readRepositoryConfigs(appBaseDir) {
  const configPath = path.join(appBaseDir, 'spaces', 'repositories.json');

  let raw;
  try {
    raw = await fsp.readFile(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }

  const repos = JSON.parse(raw);
  if (!Array.isArray(repos)) return [];

  return Promise.all(repos.map(async (repo) => {
    const sync = (repo && repo.synchronization) || {};
    const instanceName = instanceNameFor(repo);
    const localFolder = resolveLocalFolder(repo.localFolder, appBaseDir);
    return {
      id: repo.id ?? null,
      name: repo.name || (repo.id != null ? `repo-${repo.id}` : 'Repository'),
      instanceName,
      localFolder,
      // Cheap (two stats per entry) and the single most useful thing to show when
      // a repository is not syncing — a localFolder pointing one directory off is
      // otherwise indistinguishable from a healthy one on this screen.
      localFolderExists: localFolder ? await pathExists(localFolder) : false,
      cloned: localFolder ? await hasGitRepo(localFolder) : false,
      setup: getSetupState(instanceName),
      // NEVER expose credentials to the client — redact user:token@ in the URL.
      repository: redactUrl(expandEnvPlaceholders(repo.repository || '')),
      branch: repo.branch || 'main',
      // 0 = full clone. Only describes how this host CLONED; an existing clone is
      // shallowed on demand by repositoryCompact, which reports the live state.
      depth: Number(repo.depth) > 0 ? Math.floor(Number(repo.depth)) : 0,
      synchronization: {
        enabled: sync.enabled !== false,
        interval: Number(sync.interval) > 0 ? Number(sync.interval) : 3600,
        fetch: sync.fetch === true,
        commit: sync.commit === true
      }
    };
  }));
}

module.exports = {
  initializeRepositories,
  readRepositoryConfigs,
  expandEnvPlaceholders,
  resolveLocalFolder,
  instanceNameFor,
  redactUrl,
  getSetupState,
  SetupStatus,
  // Exported for tests.
  recordSetup
};
