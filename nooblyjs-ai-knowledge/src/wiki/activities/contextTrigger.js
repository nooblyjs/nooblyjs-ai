/**
 * @fileoverview Debounced, serialized trigger for on-demand AI context regeneration.
 *
 * Lifted out of `fileWatcher.js` when document DELETES became a second caller: the
 * watcher schedules rebuilds for added/changed documents, and `artifactCleanup.js`
 * (driven off the event bus) schedules them for deleted ones. Both must share ONE
 * instance — the whole point of this class is that a single serialized queue keeps
 * concurrent runs off the (often local, slow) AI, and two instances would defeat it.
 * The shared instance is created by `startFileWatcher` and hung on `services.contextTrigger`.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');

/**
 * On-demand AI context rebuild. When a document is added, changed or deleted, its
 * folder's `.system/context/` sidecars (and the folder roll-up) need regenerating. The
 * sibling `system-context` workflow group exposes an overwrite build under this name
 * (workflow-definition-ondemand.json) that we resolve by name and execute with a
 * `files` / `removedFiles` list (targeted mode: only those files + their folder roll-up).
 */
const CONTEXT_WORKFLOW_NAME = 'Context: Overwrite Context (On-Demand)';

/** Env kill-switch (default on) for the whole on-demand rebuild pipeline. */
const CONTEXT_ON_CHANGE_ENABLED = String(process.env.CONTEXT_ON_CHANGE || 'true').toLowerCase() !== 'false';

/** Per-folder debounce, so a burst of changes coalesces into one targeted rebuild. */
const CONTEXT_DEBOUNCE_MS = Number(process.env.CONTEXT_ON_CHANGE_DEBOUNCE_MS) || 8000;

// The build step's own default is aiTimeoutMs:0 (no timeout — fine for a standalone
// manual/scheduled sweep). Here it drives a SERIALIZED queue (_drain runs one folder at
// a time): an unbounded call for one file would block every other queued folder behind
// it indefinitely, with nothing to show for it in the executions log until (if ever) it
// resolves. Bound it explicitly so a stalled/slow AI call fails that one job and lets
// the queue keep draining, instead of the whole on-demand pipeline looking "stuck".
const CONTEXT_ON_CHANGE_AI_TIMEOUT_MS = Number(process.env.CONTEXT_ON_CHANGE_AI_TIMEOUT_MS) || 120000;

/**
 * Debounced, serialized trigger for on-demand AI context regeneration.
 *
 * When a context-relevant document is added, changed or deleted, its folder's
 * `.system/context/` sidecar (and the folder's roll-up) needs regenerating. This class:
 *   - accumulates changed and removed FILES per folder and debounces, so a burst of
 *     activity in one folder settles into a single job carrying exactly those paths;
 *   - drains the queue ONE job at a time, so many touched folders never stampede the
 *     (often local, slow) AI with concurrent runs;
 *   - files touched again after a job is queued re-accumulate under a fresh pending
 *     entry and produce a follow-up job — nothing is lost mid-flight.
 *
 * The actual work is the sibling `system-context` group's overwrite workflow, resolved
 * by name off the datasources workflow bridge and run in space mode
 * ({ space, folder, files, removedFiles, force:true }) — the build step's TARGETED mode
 * re-summarises only the changed files, prunes the sidecars of the removed ones, and
 * rebuilds their folder roll-up, writing each folder's own `<folder>/.system/context/`.
 */
class ContextTrigger {
  constructor(services, { debounceMs = CONTEXT_DEBOUNCE_MS } = {}) {
    this.services = services;
    this.debounceMs = debounceMs;
    this.timers = new Map();  // folderKey -> debounce timer
    this.pending = new Map(); // folderKey -> { spaceName, folder, files:Set, removed:Set } (accumulating)
    this.queue = [];          // [{ spaceName, folder, files:[], removedFiles:[] }] (settled jobs)
    this.running = false;
  }

  _key(spaceName, folder) {
    return `${spaceName}\u0000${folder}`;
  }

  /**
   * Schedule (debounced) a context rebuild for a document that was added or changed.
   * The file is accumulated into its folder's pending set, so a burst of changes in one
   * folder settles into a single TARGETED rebuild of exactly those files (the build
   * step's `files` mode re-summarises only them + the folder roll-up).
   * @param {Object} space - The space descriptor (needs `name`).
   * @param {string} fileRel - Changed file's path relative to the space root.
   */
  schedule(space, fileRel) {
    this._accumulate(space, fileRel, 'files');
  }

  /**
   * Schedule (debounced) a context rebuild for a document or folder that was DELETED.
   *
   * Takes the path of the thing that went away — a file (`Sell/Old.md`) or a folder
   * (`Sell/Archive`) — and rebuilds the roll-up of the folder that CONTAINED it, which
   * is the one whose context still describes it (a file through its `## Files` bullet,
   * a subfolder through its `## Subfolders` section).
   *
   * The removed path is carried through to the build step as `removedFiles` rather than
   * `files`: it must not be summarised (there is nothing left to read), but it is what
   * tells the step this is a targeted, roll-up-only rebuild. A job with an empty `files`
   * list and nothing else would otherwise read as FOLDER mode — a full recursive walk of
   * the subtree with force:true, minutes of AI for a single delete.
   *
   * @param {Object} space - The space descriptor (needs `name`).
   * @param {string} removedRel - Deleted file/folder path relative to the space root.
   */
  scheduleRemoval(space, removedRel) {
    this._accumulate(space, removedRel, 'removed');
  }

  /**
   * Accumulate a path into its folder's pending entry and (re)start that folder's
   * debounce timer.
   * @param {Object} space - The space descriptor (needs `name`).
   * @param {string} itemRel - Space-relative path of the touched file/folder.
   * @param {'files'|'removed'} bucket - Which set the path belongs in.
   * @private
   */
  _accumulate(space, itemRel, bucket) {
    const rel = String(itemRel).replace(/\\/g, '/');
    const dir = path.posix.dirname(rel);
    const folder = dir === '.' ? '' : dir;

    // Belt-and-braces: context belongs to real content folders only. A hidden folder
    // (`.aicontext`, `.system`, …) is app plumbing — building context for it wastes an
    // AI run and writes artifacts into a folder the tree never shows. Callers already
    // gate on eligibility; this stops a future one from re-introducing the bug.
    if (folder.split('/').some(segment => segment.startsWith('.'))) {
      return;
    }

    const key = this._key(space.name, folder);

    let entry = this.pending.get(key);
    if (!entry) {
      entry = { spaceName: space.name, folder, files: new Set(), removed: new Set() };
      this.pending.set(key, entry);
    }
    entry[bucket].add(rel);

    if (this.timers.has(key)) clearTimeout(this.timers.get(key));
    const timer = setTimeout(() => this._fire(key), this.debounceMs);
    // Don't keep the event loop alive on this timer alone.
    if (typeof timer.unref === 'function') timer.unref();
    this.timers.set(key, timer);
  }

  _fire(key) {
    this.timers.delete(key);
    const entry = this.pending.get(key);
    if (!entry) return;
    this.pending.delete(key);
    if (entry.files.size === 0 && entry.removed.size === 0) return;
    // Snapshot the accumulated paths into a settled job. Changes that arrive AFTER this
    // fire re-accumulate under a fresh pending entry/timer and produce a follow-up job,
    // so nothing is lost even while a run is in flight.
    this.queue.push({
      spaceName: entry.spaceName,
      folder: entry.folder,
      files: [...entry.files],
      removedFiles: [...entry.removed]
    });
    this._drain();
  }

  async _drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        try {
          await this._runContextWorkflow(job);
        } catch (error) {
          this.services.log.warn(
            `[ContextTrigger] Context rebuild failed for ${job.spaceName}/${job.folder || '(root)'}: ${error.message}`
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  async _runContextWorkflow(job) {
    const { log, app, appBaseDir } = this.services;
    const workflowBridge = app && typeof app.get === 'function' ? app.get('workflowBridge') : null;
    const workflow = workflowBridge && typeof workflowBridge.resolveWorkflowByName === 'function'
      ? workflowBridge.resolveWorkflowByName(CONTEXT_WORKFLOW_NAME)
      : null;
    if (!workflowBridge || !workflow) {
      // Not fatal — the sibling workflow group may not be deployed here.
      if (typeof log.debug === 'function') {
        log.debug(`[ContextTrigger] "${CONTEXT_WORKFLOW_NAME}" not available; skipping context rebuild`);
      }
      return;
    }

    if (workflowBridge.initialized === false && typeof workflowBridge.whenReady === 'function') {
      await workflowBridge.whenReady();
    }

    // The build step reads spaces.json under appBaseDir to resolve the space's on-disk
    // root; pass the absolute path so the worker doesn't fall back to a wrong sibling
    // guess. (executeWorkflow ignores defaultInput once we supply a non-empty input, so
    // appBaseDir must be provided explicitly.)
    const resolvedAppBaseDir = appBaseDir
      ? path.resolve(appBaseDir)
      : path.join(process.cwd(), '.application');

    const changed = Array.isArray(job.files) ? job.files.length : 0;
    const removed = Array.isArray(job.removedFiles) ? job.removedFiles.length : 0;
    log.info(
      `[ContextTrigger] Rebuilding context for ${job.spaceName}/${job.folder || '(root)'} `
      + `(${changed} changed, ${removed} removed)`
    );
    // `files`/`removedFiles` trigger the build step's TARGETED mode: re-summarise only
    // the changed files, prune the removed ones' sidecars, and rebuild their folder
    // roll-up (not the whole subtree). folder is passed too for logging/back-compat; the
    // step derives it from the paths.
    const execution = await workflowBridge.executeWorkflow(workflow.id, {
      space: job.spaceName,
      folder: job.folder,
      files: job.files,
      removedFiles: job.removedFiles,
      force: true,
      appBaseDir: resolvedAppBaseDir,
      // Bound per-attempt AI wait so one slow/stalled call can't wedge the serialized
      // queue forever — see CONTEXT_ON_CHANGE_AI_TIMEOUT_MS above.
      aiTimeoutMs: CONTEXT_ON_CHANGE_AI_TIMEOUT_MS
    });
    if (execution && execution.outcome && execution.outcome !== 'success') {
      throw new Error(execution.error || `workflow outcome ${execution.outcome}`);
    }
    log.info(`[ContextTrigger] Context rebuilt for ${job.spaceName}/${job.folder || '(root)'} (execution ${execution?.id})`);
  }
}

module.exports = {
  ContextTrigger,
  CONTEXT_WORKFLOW_NAME,
  CONTEXT_ON_CHANGE_ENABLED,
  CONTEXT_DEBOUNCE_MS,
  CONTEXT_ON_CHANGE_AI_TIMEOUT_MS
};
