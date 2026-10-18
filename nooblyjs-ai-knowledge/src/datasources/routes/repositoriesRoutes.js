/**
 * @fileoverview Repositories API Routes for Datasources Module
 *
 * Surfaces the git-backed filers registered on startup (see
 * src/shared/repositories/repositoryManager.js). Each repository in
 * .application/spaces/repositories.json is registered in the core service
 * registry as a filing service (provider 'git', keyed filing:git:<instance>),
 * so its per-filer analytics come straight from the core filing/git provider:
 *   - getGitStatus() → branch, ahead/behind, working-tree changes, pending
 *     commits, locked files,
 *   - getSettings()  → fetch/commit intervals + autoFetch/autoCommit flags.
 *
 * Endpoints:
 * - GET  /api/repositories                       List configured repositories (redacted)
 * - GET  /api/repositories/:instanceName         Analytics for one filer
 * - POST /api/repositories/:instanceName/sync    Run the configured sync NOW (admin)
 * - POST /api/repositories/:instanceName/reset    Discard local state, match the remote (admin)
 * - POST /api/repositories/:instanceName/compact Shrink this host's clone (admin, 202)
 * - GET  /api/repositories/:instanceName/compact Progress/result of the last compaction
 *
 * @author noobly Team
 * @version 1.3.0
 */

'use strict';

const { readRepositoryConfigs } = require('../../shared/repositories/repositoryManager');
const { actionsFor, syncRepository } = require('../../shared/repositories/repositorySync');
const { resetRepository, findCaseCollisions } = require('../../shared/repositories/repositoryReset');
const {
  startCompact, getCompactJob, readObjectStore, isShallow, DEFAULT_DEPTH
} = require('../../shared/repositories/repositoryCompact');
const { inspectIndexLock } = require('../../shared/repositories/gitLock');
const { isGlobalAdmin } = require('../../shared/spaces/spaceAuthority');

/**
 * Register repositories routes.
 * @param {string} type - Instance name (registry convention, unused here)
 * @param {Object} options - { 'express-app', dependencies }
 * @param {Object} eventEmitter - Global event emitter
 */
module.exports = function (type, options, eventEmitter) {
  const app = options.app || options['express-app'];
  const { dependencies = {} } = options;
  const { log, appBaseDir, serviceRegistry } = dependencies;

  const requireAuth = (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
  };

  /** Look up the live git filer for an instance name, or null. */
  const filerFor = (instanceName) => {
    try {
      return serviceRegistry?.getServiceInstance?.('filing', 'git', instanceName) || null;
    } catch {
      return null;
    }
  };

  /**
   * GET /api/repositories
   * List every configured repository with a `registered` flag indicating whether
   * its filer is live in the service registry. Lightweight (no git calls, two
   * stats per entry) so it is cheap to call for the sidebar. Each entry carries
   * `setup` (boot-time clone outcome) plus `localFolderExists` / `cloned`, so a
   * misconfigured repository is visible in the LIST rather than only after
   * clicking into its analytics.
   */
  app.get('/api/repositories', requireAuth, async (req, res) => {
    try {
      const configs = await readRepositoryConfigs(appBaseDir);
      const data = configs.map((c) => ({ ...c, registered: !!filerFor(c.instanceName) }));
      res.json({ success: true, data });
    } catch (error) {
      log?.error?.('Failed to list repositories:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/repositories/:instanceName
   * Per-filer analytics: config + git status + sync settings. Git calls are each
   * wrapped so a not-yet-cloned / unreachable repo still returns a useful payload
   * (with `error`) rather than a 500.
   */
  app.get('/api/repositories/:instanceName', requireAuth, async (req, res) => {
    try {
      const { instanceName } = req.params;
      const configs = await readRepositoryConfigs(appBaseDir);
      const config = configs.find((c) => c.instanceName === instanceName) || null;
      const filer = filerFor(instanceName);
      // Every write on this screen is admin-only; asked once, reported per action
      // so each button can be disabled with its own reason instead of 403-ing on
      // click.
      const admin = isGlobalAdmin(req.user, app.get('securityManager'));

      const data = {
        instanceName,
        config,
        registered: !!filer,
        // Which directions this repository is configured to sync, in execution
        // order. Derived here rather than in the browser so the sync button and
        // POST …/sync can never disagree about what pressing it will do.
        syncActions: actionsFor(config),
        // Same rule POST …/sync enforces, answered here so the button can be
        // disabled with a reason instead of 403-ing on click.
        canSync: admin,
        // Reset is NOT gated on syncActions: it repairs this host's clone rather
        // than synchronising in a configured direction, so a repository with both
        // directions off can still be reset — same as compaction.
        canReset: admin,
        initialized: false,
        // Outcome of the BOOT-TIME clone, which runs detached from startup and so
        // has nowhere to report a failure except here. Without it a repository
        // whose localFolder is wrong looks identical to a healthy one — registered,
        // auto-fetch On, an interval — because every one of those is read from the
        // config rather than from anything that actually ran. `config` also carries
        // localFolderExists / cloned, i.e. what is on disk NOW, which is what
        // distinguishes a stale failure from a live one after a config edit.
        setup: config ? config.setup : null,
        branch: config ? config.branch : null,
        git: null,
        settings: null,
        pendingCommits: 0,
        lockedFiles: [],
        // A leftover .git/index.lock stops EVERY sync, and the auto-commit timer
        // swallows the error it raises each hour — so unless it is reported here
        // a repository can sit unsynced indefinitely while this screen shows
        // auto-commit "On". Reported for a configured repository whether or not
        // its filer registered, since a lock is a property of the folder on disk.
        lock: await inspectIndexLock(config && config.localFolder),
        store: null,
        shallow: null,
        compact: getCompactJob(instanceName),
        // Tracked paths differing only in case, filled in below only when the
        // working tree is dirty. A permanently modified file on Windows is nearly
        // always this, and until it is named the screen just shows N local changes
        // that no sync, reset or clean ever removes.
        caseCollisions: null,
        error: null
      };

      if (!filer) {
        return res.json({ success: true, data });
      }

      // Git status (branch, ahead/behind, working tree, pending commits).
      try {
        const status = await filer.getGitStatus();
        data.initialized = true;
        data.git = status.git || null;
        data.pendingCommits = status.pendingCommits || 0;
        data.lockedFiles = status.lockedFiles || [];
        data.branch = status.branch || data.branch;
        data.autoFetch = status.autoFetch;
        data.fetchInterval = status.fetchInterval;
      } catch (e) {
        data.error = e.message;
      }

      // Object-store size + shallow state, so the screen can show what a
      // compaction would act on. One `count-objects -v`; best-effort, because
      // analytics must still render for a repository git cannot answer for.
      try {
        const git = filer.provider && filer.provider.git;
        if (git) {
          data.store = await readObjectStore(git);
          data.shallow = await isShallow(git);

          // Only for a dirty tree: on a clean one there is nothing to explain, and
          // this costs a full `ls-files`.
          const dirty = Array.isArray(data.git && data.git.files) ? data.git.files : [];
          if (dirty.length) {
            const groups = await findCaseCollisions(git);
            if (groups.length) {
              const dirtyKeys = new Set(dirty.map((f) => String(f.path || '').toLowerCase()));
              const stuck = groups.filter((group) => dirtyKeys.has(group[0].toLowerCase()));
              data.caseCollisions = {
                total: groups.length,
                stuck: stuck.length,
                groups: (stuck.length ? stuck : groups).slice(0, 50)
              };
            }
          }
        }
      } catch (e) {
        /* store stats and collision detection are best-effort */
      }

      // Sync settings (fetch/commit intervals + auto flags).
      try {
        const settings = await filer.getSettings();
        // getSettings() returns the provider settings object; expose the resolved
        // values the UI needs (skip the internal `list`/`description`).
        if (settings) {
          data.settings = {
            fetchInterval: settings.fetchInterval,
            autoFetch: settings.autoFetch,
            autoCommit: settings.autoCommit,
            commitInterval: settings.commitInterval,
            commitMessage: settings.commitMessage,
            conflictThreshold: settings.conflictThreshold
          };
        }
      } catch (e) {
        /* settings are best-effort */
      }

      res.json({ success: true, data });
    } catch (error) {
      log?.error?.('Failed to get repository analytics:', error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/repositories/:instanceName/sync
   *
   * Run the repository's CONFIGURED synchronisation immediately — commit + push
   * when `synchronization.commit` is true, fetch + pull when
   * `synchronization.fetch` is true, both (commit first) when both are. There is
   * no direction parameter on purpose: the button offers what the repository is
   * set up for, so a fetch-only mirror can never be pushed to from the UI.
   *
   * Admin only. Unlike everything else on this route file it writes — it creates
   * commits and pushes them to a remote whose credentials live in .env.
   *
   * Status codes are distinct because the fixes differ: 403 wrong user, 404 no
   * such entry in repositories.json, 409 either "not a live filer" (needs a
   * restart) or "a sync is already running" (needs a moment), 400 the entry syncs
   * in neither direction, 500 git itself failed — and that body carries `partial`
   * when some of the run did land (e.g. committed locally, push rejected).
   */
  app.post('/api/repositories/:instanceName/sync', requireAuth, async (req, res) => {
    const { instanceName } = req.params;
    try {
      if (!isGlobalAdmin(req.user, app.get('securityManager'))) {
        return res.status(403).json({
          success: false,
          error: 'Administrator access required to synchronise a repository.'
        });
      }

      const configs = await readRepositoryConfigs(appBaseDir);
      const config = configs.find((c) => c.instanceName === instanceName) || null;
      if (!config) {
        return res.status(404).json({
          success: false,
          error: `Unknown repository "${instanceName}".`
        });
      }

      const filer = filerFor(instanceName);
      if (!filer) {
        return res.status(409).json({
          success: false,
          error: 'This repository is not registered as a live filer — check '
            + 'synchronization.enabled in repositories.json and restart the backend.'
        });
      }

      const actions = actionsFor(config);
      if (!actions.length) {
        return res.status(400).json({
          success: false,
          error: 'Synchronisation is not configured for this repository — set '
            + 'synchronization.fetch and/or synchronization.commit in repositories.json.'
        });
      }

      const data = await syncRepository({
        filer,
        instanceName,
        actions,
        log,
        actor: req.user?.email || req.user?.username || req.user?.id || null
      });
      res.json({ success: true, data });
    } catch (error) {
      if (error.code === 'REPOSITORY_BUSY') {
        return res.status(409).json({ success: false, error: error.message });
      }
      log?.error?.(`Repository sync failed for "${instanceName}":`, error.message);
      res.status(500).json({
        success: false,
        error: error.message,
        partial: error.partial || null
      });
    }
  });

  /**
   * POST /api/repositories/:instanceName/reset
   *
   * Discard this host's local state and match the remote exactly — fetch,
   * `reset --hard origin/<branch>`, `clean -fd`. See repositoryReset.js for what
   * that destroys (uncommitted changes, unpushed commits, untracked files) and
   * what it deliberately spares (ignored files, and the remote itself).
   *
   * `{ confirm: true }` IS REQUIRED IN THE BODY. The browser already asks, so this
   * is not the user's confirmation — it is a guard on the endpoint. Reset sits on
   * the same URL shape as sync and compact, both of which take an empty body and
   * neither of which loses data, and this one is one mistyped path segment away
   * from either in a script, a saved request, or a retry loop. An explicit flag
   * means the destructive call cannot be reached by accident.
   *
   * Admin only. Answers 200 (not 202 like compaction): the three git commands are
   * fast even on a large clone — no repack, no object walk — so there is nothing to
   * poll. Status codes follow …/sync: 403 wrong user, 404 no such entry, 409 not a
   * live filer or the repository is busy, 400 the configured branch is not on the
   * remote (or `confirm` is missing), 500 git itself failed.
   */
  app.post('/api/repositories/:instanceName/reset', requireAuth, async (req, res) => {
    const { instanceName } = req.params;
    try {
      if (!isGlobalAdmin(req.user, app.get('securityManager'))) {
        return res.status(403).json({
          success: false,
          error: 'Administrator access required to reset a repository.'
        });
      }

      if (req.body?.confirm !== true) {
        return res.status(400).json({
          success: false,
          error: 'Reset discards all local commits, changes and untracked files in this '
            + 'clone. Send { "confirm": true } to proceed.'
        });
      }

      const configs = await readRepositoryConfigs(appBaseDir);
      const config = configs.find((c) => c.instanceName === instanceName) || null;
      if (!config) {
        return res.status(404).json({ success: false, error: `Unknown repository "${instanceName}".` });
      }

      const filer = filerFor(instanceName);
      if (!filer) {
        return res.status(409).json({
          success: false,
          error: 'This repository is not registered as a live filer — check '
            + 'synchronization.enabled in repositories.json and restart the backend.'
        });
      }

      const data = await resetRepository({
        filer,
        instanceName,
        log,
        actor: req.user?.email || req.user?.username || req.user?.id || null
      });
      res.json({ success: true, data });
    } catch (error) {
      if (error.code === 'REPOSITORY_BUSY') {
        return res.status(409).json({ success: false, error: error.message });
      }
      if (error.code === 'RESET_NO_REMOTE_BRANCH') {
        // A configuration fault, not a server fault — and nothing was reset.
        return res.status(400).json({ success: false, error: error.message });
      }
      log?.error?.(`Repository reset failed for "${instanceName}":`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * POST /api/repositories/:instanceName/compact
   *
   * Shrink this host's clone by dropping history: shallow-fetch to `depth`,
   * expire the reflog, garbage-collect. The REMOTE is untouched — no rewrite, no
   * force-push, nothing for other clones to notice — and `git fetch --unshallow`
   * reverses it. Roughly a third to a half of a large clone, measured on the live
   * content roots.
   *
   * Answers 202, not 200: `gc` on a repository this size runs for minutes, well
   * past any reverse proxy's idle timeout. The client polls GET on the same path.
   * Admin only, like sync.
   */
  app.post('/api/repositories/:instanceName/compact', requireAuth, async (req, res) => {
    const { instanceName } = req.params;
    try {
      if (!isGlobalAdmin(req.user, app.get('securityManager'))) {
        return res.status(403).json({
          success: false,
          error: 'Administrator access required to compact a repository.'
        });
      }

      const configs = await readRepositoryConfigs(appBaseDir);
      const config = configs.find((c) => c.instanceName === instanceName) || null;
      if (!config) {
        return res.status(404).json({ success: false, error: `Unknown repository "${instanceName}".` });
      }

      const filer = filerFor(instanceName);
      if (!filer) {
        return res.status(409).json({
          success: false,
          error: 'This repository is not registered as a live filer — check '
            + 'synchronization.enabled in repositories.json and restart the backend.'
        });
      }

      // Per-request depth, else the repository's configured clone depth, else the
      // module default — so a repo asking for 10 commits keeps 10 when compacted.
      const depth = Number(req.body?.depth) > 0
        ? Number(req.body.depth)
        : (config.depth > 0 ? config.depth : DEFAULT_DEPTH);

      const job = startCompact({
        filer,
        instanceName,
        depth,
        log,
        actor: req.user?.email || req.user?.username || req.user?.id || null
      });
      res.status(202).json({ success: true, data: job });
    } catch (error) {
      if (error.code === 'REPOSITORY_BUSY') {
        return res.status(409).json({ success: false, error: error.message });
      }
      log?.error?.(`Repository compact could not start for "${instanceName}":`, error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  /**
   * GET /api/repositories/:instanceName/compact
   * Progress/result of the last compaction on this host. `null` when none has run
   * since the backend started — the job record is in memory, so a restart loses
   * the REPORT but never the work.
   */
  app.get('/api/repositories/:instanceName/compact', requireAuth, (req, res) => {
    res.json({ success: true, data: getCompactJob(req.params.instanceName) });
  });

  log?.info?.('✓ Repositories routes registered (/api/repositories)');
};
