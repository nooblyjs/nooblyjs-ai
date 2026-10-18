/**
 * @fileoverview WorkflowBridgeClient — the worker-thread half of a file-based
 * request/reply bridge to the LIVE WorkflowBridge running in the backend's main
 * process.
 *
 * Workflow steps execute inside an isolated `worker_threads` Worker, so they
 * cannot reach the main process's live `WorkflowBridge` (its in-memory schedule
 * list, cron activation, `global.*`). They used to reach it by calling the
 * backend's REST API over HTTP (`ScheduleApiClient`); in production the backend
 * sits behind HTTPS + Entra SSO on :443, so that self-call fails the TLS/cert
 * check and is redirected to the Entra login. This client removes the network
 * hop: it exchanges JSON files under `<appBaseDir>/workflow/.bridge/`, a
 * filesystem the worker and the backend already share (the same way steps read
 * `spaces.json`). No HTTP, no cert, no auth redirect.
 *
 * Drop-in for `ScheduleApiClient`: same `authenticate()` / `listSchedules()` /
 * `createSchedule()` surface, plus a generic `call(method, args)` for any other
 * allowlisted bridge operation.
 *
 * Protocol — keep in lockstep with the server in the sibling
 * digital-technologies-knowledge repo
 * (`backend/src/datasources/lib/workflowBridgeServer.js`):
 *   request : `<appBaseDir>/workflow/.bridge/requests/<id>.json`
 *             `{ v:1, id, method, args, createdAt }`
 *   response: `<appBaseDir>/workflow/.bridge/responses/<id>.json`
 *             `{ v:1, id, ok, result?, error?, completedAt }`
 * Both are written atomically (temp + rename); the client deletes each response
 * once read and its own request on completion/timeout.
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 */

'use strict';

const fsp = require('node:fs').promises;
const path = require('node:path');
const crypto = require('node:crypto');

const PROTOCOL_VERSION = 1;
const BRIDGE_DIR_REL = path.join('workflow', '.bridge');
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_POLL_MS = 100;

class WorkflowBridgeClient {

  /**
   * @param {Object} [options]
   * @param {string} [options.appBaseDir] - Application data dir holding `workflow/.bridge`.
   *   Defaults to `APP_BASE_DIR`, else the conventional sibling `<repos-parent>/.application`.
   * @param {Object} [options.logger] - Optional logger.
   * @param {number} [options.timeoutMs=30000] - Max wait for a response.
   * @param {number} [options.pollMs=100] - Response poll interval.
   */
  constructor(options = {}) {
    const base = options.appBaseDir
      || process.env.APP_BASE_DIR
      // common/bridge/ -> common/ -> workflows-repo/ -> repos parent (e.g. C:\work-dt)
      || path.resolve(__dirname, '../../..', '.application');
    // The .env APP_BASE_DIR is sometimes stored with escaped separators; normalise.
    this.appBaseDir = path.normalize(base);
    this.baseDir = path.join(this.appBaseDir, BRIDGE_DIR_REL);
    this.requestsDir = path.join(this.baseDir, 'requests');
    this.responsesDir = path.join(this.baseDir, 'responses');
    this.logger = options.logger || console;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.pollMs = options.pollMs || DEFAULT_POLL_MS;
  }

  /** No-op: the file bridge needs no auth (interface parity with ScheduleApiClient). */
  async authenticate() { /* nothing to do */ }

  /**
   * List the live schedules known to the running backend.
   * @returns {Promise<Array<Object>>} records including `name` and `lastRun`
   */
  async listSchedules() {
    return this.call('listSchedules', {});
  }

  /**
   * Create a recurring cron schedule that runs a named workflow (activated
   * immediately in the live bridge).
   * @param {Object} schedule
   * @param {string} schedule.workflowName
   * @param {string} schedule.cron - 5-field cron expression
   * @param {string} schedule.name
   * @param {Object} schedule.payload
   * @returns {Promise<Object>} `{ scheduleId, nextRun, ... }`
   */
  async createSchedule({ workflowName, cron, name, payload }) {
    return this.call('createSchedule', { workflowName, cron, name, payload: payload || {} });
  }

  /**
   * Send one request to the bridge and await its response.
   * @param {string} method - An allowlisted bridge method name.
   * @param {Object} [args] - Method arguments.
   * @returns {Promise<*>} The method result.
   * @throws {Error} On a bridge-reported failure or a response timeout.
   */
  async call(method, args = {}) {
    await fsp.mkdir(this.requestsDir, { recursive: true });
    await fsp.mkdir(this.responsesDir, { recursive: true });

    const id = crypto.randomUUID();
    const reqPath = path.join(this.requestsDir, `${id}.json`);
    const resPath = path.join(this.responsesDir, `${id}.json`);
    const body = JSON.stringify({
      v: PROTOCOL_VERSION,
      id,
      method,
      args,
      createdAt: new Date().toISOString(),
    });

    // Atomic publish so the server never reads a partial request.
    const tmp = `${reqPath}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, body, 'utf8');
    await fsp.rename(tmp, reqPath);

    const deadline = Date.now() + this.timeoutMs;
    try {
      while (Date.now() < deadline) {
        let raw;
        try {
          raw = await fsp.readFile(resPath, 'utf8');
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
          await this._delay(this.pollMs);
          continue;
        }
        // Got a response — consume it so it never lingers as an orphan.
        await this._unlink(resPath);
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          throw new Error(`Workflow bridge: unreadable response for "${method}": ${err.message}`);
        }
        if (!parsed.ok) {
          throw new Error(`Workflow bridge: "${method}" failed: ${parsed.error || 'unknown error'}`);
        }
        return parsed.result;
      }
      throw new Error(
        `Workflow bridge: timed out after ${this.timeoutMs}ms waiting for "${method}". `
        + 'Is the backend running with WorkflowBridgeServer started, and is '
        + `APP_BASE_DIR correct (${this.appBaseDir})?`
      );
    } finally {
      // Best-effort: never leave our request behind on timeout/error.
      await this._unlink(reqPath);
    }
  }

  /**
   * @private Resolve after `ms`. The timer is intentionally NOT unref()'d: while
   * a call is in flight the client must keep the event loop alive until the
   * response arrives or the timeout fires — otherwise a step whose only pending
   * work is this poll would exit before getting its answer.
   */
  _delay(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
  }

  /** @private */
  async _unlink(p) {
    try { await fsp.unlink(p); } catch (_) { /* already gone */ }
  }
}

module.exports = WorkflowBridgeClient;
