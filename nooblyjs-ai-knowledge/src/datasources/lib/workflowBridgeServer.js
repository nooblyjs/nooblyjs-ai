/**
 * @fileoverview WorkflowBridgeServer — the main-process half of a file-based
 * request/reply bridge that lets workflow STEPS invoke operations on the LIVE
 * WorkflowBridge without an HTTP self-call.
 *
 * Why this exists: a scheduled/triggered workflow runs its steps inside a
 * `worker_threads` Worker (core `working` service). That worker gets its OWN
 * service registry, so it cannot see the main process's `app.get('workflowBridge')`,
 * its in-memory schedule list, or `global.*`. Steps used to reach the live bridge
 * by calling the backend's own REST API over HTTP (ScheduleApiClient). In
 * production the backend is fronted by HTTPS + Entra SSO on :443, so that
 * self-call fails the TLS/cert check and is redirected to the Entra login. This
 * bridge removes the network hop entirely: the worker and the main process
 * already share the `<appBaseDir>` filesystem (that is how steps read
 * `spaces.json` / `settings-agents.json`), so they exchange request/response
 * JSON files under `<appBaseDir>/workflow/.bridge/`.
 *
 * Protocol — MUST stay in lockstep with the client in this repo's
 * workflows/ folder
 * (`common/bridge/workflowBridgeClient.js`):
 *   request : `<appBaseDir>/workflow/.bridge/requests/<id>.json`
 *             `{ v:1, id, method, args, createdAt }`
 *   response: `<appBaseDir>/workflow/.bridge/responses/<id>.json`
 *             `{ v:1, id, ok, result?, error?, completedAt }`
 * Both files are written atomically (temp file + rename) so a reader never sees a
 * partial file, and `.tmp` files are ignored. The server deletes each request
 * after answering; the client deletes each response after reading; a periodic
 * sweep removes orphans past their TTL (e.g. a client that died mid-call).
 *
 * Only an explicit ALLOWLIST of bridge methods is reachable — the request file
 * carries a method name, never code — so a stray file can never invoke anything
 * beyond the operations wired below.
 *
 * SINGLE CONSUMER: this assumes ONE backend process owns a given `<appBaseDir>`
 * (the platform is file-based / single-instance — no DB). Two servers polling the
 * same requests dir could both handle a request and double-apply it; that is also
 * already true of the in-memory schedule list itself, so if the platform ever
 * goes multi-instance both need a claim/lock (e.g. atomic-rename to claim), not
 * just this bridge.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const fsp = require('node:fs').promises;
const path = require('node:path');

const PROTOCOL_VERSION = 1;
const BRIDGE_DIR_REL = path.join('workflow', '.bridge');
const REQUESTS_SUBDIR = 'requests';
const RESPONSES_SUBDIR = 'responses';
// Poll cadence for new requests. Deliberately NOT fs.watch: on Windows fs.watch
// can miss events, throw EPERM, or crash the process with a libuv assertion on
// certain paths (e.g. 8.3 short-name components). A tight directory poll is a
// little busier but crash-proof and predictable — and scheduling calls are rare.
const SCAN_INTERVAL_MS = 200;
const CLEANUP_INTERVAL_MS = 60 * 1000; // orphan sweep cadence
const ORPHAN_TTL_MS = 5 * 60 * 1000;   // drop unclaimed responses / stuck requests after 5 min

/**
 * File-based request/reply server bound to a live WorkflowBridge instance.
 */
class WorkflowBridgeServer {
  /**
   * @param {Object} options
   * @param {Object} options.bridge - The live WorkflowBridge instance.
   * @param {string} [options.appBaseDir] - Application data dir (defaults to the bridge's).
   * @param {Object} [options.logger] - Logger with info/warn.
   */
  constructor({ bridge, appBaseDir, logger } = {}) {
    if (!bridge) throw new Error('WorkflowBridgeServer: a live bridge is required');
    this.bridge = bridge;
    this.logger = logger || console;
    this.appBaseDir = appBaseDir || bridge.appBaseDir || path.join(process.cwd(), '.application');

    this.baseDir = path.join(this.appBaseDir, BRIDGE_DIR_REL);
    this.requestsDir = path.join(this.baseDir, REQUESTS_SUBDIR);
    this.responsesDir = path.join(this.baseDir, RESPONSES_SUBDIR);

    this._inFlight = new Set();   // request filenames currently being handled
    this._scanTimer = null;
    this._cleanupTimer = null;
    this._scanning = false;       // reentrancy guard for _scan
    this._started = false;

    // Allowlisted operations. A request naming anything else is rejected. Each
    // handler receives the request's `args` object and returns a JSON-safe value.
    this.handlers = {
      listSchedules: async () => {
        const list = this.bridge.listSchedules() || [];
        return list.map((s) => ({
          id: s.id,
          name: s.name,
          workflowId: s.workflowId,
          enabled: s.enabled,
          cronExpression: s.cronExpression || null,
          lastRun: s.lastRun || null,
          nextRun: s.nextRun || null,
        }));
      },
      createSchedule: async (args = {}) => {
        const { workflowName, cron, name, payload } = args;
        if (!workflowName || typeof workflowName !== 'string') {
          throw new Error('createSchedule requires a workflowName');
        }
        if (!cron || typeof cron !== 'string') {
          throw new Error('createSchedule requires a cron expression');
        }
        const schedule = await this.bridge.scheduleWorkflowByName(
          workflowName, cron, payload || {}, name
        );
        return {
          scheduleId: schedule.id,
          name: schedule.name,
          workflowId: schedule.workflowId,
          cron: schedule.cronExpression || null,
          nextRun: schedule.nextRun || null,
          enabled: schedule.enabled,
        };
      },
      startWorkflow: async (args = {}) => {
        const { workflowName, payload } = args;
        if (!workflowName || typeof workflowName !== 'string') {
          throw new Error('startWorkflow requires a workflowName');
        }
        return this.bridge.startWorkflowByName(workflowName, payload || {});
      },
      getExecution: async (args = {}) => {
        const { executionId } = args;
        if (!executionId) throw new Error('getExecution requires an executionId');
        return this.bridge.getExecution(executionId);
      },
      // NooblyJS Phase 24: hosted, a workflow step's prompt runs here as a teammate task (shared/ai/agentTasks.js).
      // Standalone there is no runner, and a worker never asks: it calls its provider itself.
      agentPrompt: async (args = {}) => {
        const run = global.nooblyAgentTasks;
        if (typeof run !== 'function') throw new Error('The wiki is not hosted in NooblyJS: there is no teammate to run this prompt.');
        const { agent, text, options } = args;
        if (typeof text !== 'string' || !text.trim()) throw new Error('agentPrompt requires the prompt text');
        return run({ agent: String(agent || 'workflow'), text, options: options || {}, via: 'workflow' });
      },
    };
  }

  /**
   * Create the bridge directories, drain anything already waiting, and start
   * polling for new requests. Safe to call once.
   */
  async start() {
    if (this._started) return;
    await fsp.mkdir(this.requestsDir, { recursive: true });
    await fsp.mkdir(this.responsesDir, { recursive: true });
    this._started = true;

    // Process anything already queued (e.g. a request written while the backend
    // was restarting), then poll for new ones.
    this._scan().catch(() => {});
    this._scanTimer = setInterval(() => {
      this._scan().catch((err) => {
        this.logger.warn && this.logger.warn(`[WorkflowBridgeServer] scan failed: ${err.message}`);
      });
    }, SCAN_INTERVAL_MS);
    if (this._scanTimer.unref) this._scanTimer.unref();

    this._cleanupTimer = setInterval(() => {
      this._cleanupOrphans().catch(() => {});
    }, CLEANUP_INTERVAL_MS);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();

    this.logger.info && this.logger.info(
      `[WorkflowBridgeServer] listening on ${this.requestsDir} `
      + `(methods: ${Object.keys(this.handlers).join(', ')})`
    );
  }

  /** Stop polling and cleanup. */
  stop() {
    if (this._scanTimer) { clearInterval(this._scanTimer); this._scanTimer = null; }
    if (this._cleanupTimer) { clearInterval(this._cleanupTimer); this._cleanupTimer = null; }
    this._started = false;
  }

  /** Read the requests dir and dispatch any new, complete request files. */
  async _scan() {
    if (this._scanning || !this._started) return; // avoid overlapping passes
    this._scanning = true;
    try {
      let names;
      try {
        names = await fsp.readdir(this.requestsDir);
      } catch (err) {
        if (err.code === 'ENOENT') return;
        throw err;
      }
      for (const name of names) {
        if (!name.endsWith('.json')) continue;   // ignore `.tmp` and stray files
        if (this._inFlight.has(name)) continue;
        this._inFlight.add(name);
        // Handle concurrently; bridge writes are serialised by its own mutexes.
        this._handle(name).finally(() => this._inFlight.delete(name));
      }
    } finally {
      this._scanning = false;
    }
  }

  /** Process one request file end-to-end: parse → dispatch → respond → delete. */
  async _handle(name) {
    const reqPath = path.join(this.requestsDir, name);
    const fallbackId = name.replace(/\.json$/, '');
    let req;
    try {
      req = JSON.parse(await fsp.readFile(reqPath, 'utf8'));
    } catch (err) {
      // Unreadable/partial/corrupt — answer with an error so the caller stops
      // polling, then drop the request.
      await this._writeResponse(fallbackId, { ok: false, error: `bad request file: ${err.message}` });
      await this._unlink(reqPath);
      return;
    }

    const id = (req && req.id) || fallbackId;
    const method = req && req.method;
    const handler = this.handlers[method];
    let response;
    if (!handler) {
      response = { ok: false, error: `unknown bridge method: ${method}` };
    } else {
      try {
        if (this.bridge.initialized === false && typeof this.bridge.whenReady === 'function') {
          await this.bridge.whenReady();
        }
        const result = await handler(req.args || {});
        response = { ok: true, result };
      } catch (err) {
        response = { ok: false, error: err && err.message ? err.message : String(err) };
      }
    }

    await this._writeResponse(id, response);
    await this._unlink(reqPath);
  }

  /** Atomically publish a response file (temp + rename). */
  async _writeResponse(id, payload) {
    const body = JSON.stringify({
      v: PROTOCOL_VERSION,
      id,
      completedAt: new Date().toISOString(),
      ...payload,
    });
    const finalPath = path.join(this.responsesDir, `${id}.json`);
    const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmpPath, body, 'utf8');
    await fsp.rename(tmpPath, finalPath); // atomic on the same filesystem
  }

  async _unlink(p) {
    try { await fsp.unlink(p); } catch (_) { /* already gone */ }
  }

  /** Remove responses a (dead) client never claimed, and any stuck requests. */
  async _cleanupOrphans() {
    const now = Date.now();
    for (const [dir, isRequest] of [[this.responsesDir, false], [this.requestsDir, true]]) {
      let names;
      try { names = await fsp.readdir(dir); } catch (_) { continue; }
      for (const name of names) {
        if (isRequest && this._inFlight.has(name)) continue;
        const p = path.join(dir, name);
        try {
          const st = await fsp.stat(p);
          if (now - st.mtimeMs > ORPHAN_TTL_MS) await this._unlink(p);
        } catch (_) { /* raced with a delete */ }
      }
    }
  }
}

module.exports = WorkflowBridgeServer;
