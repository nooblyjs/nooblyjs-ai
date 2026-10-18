/**
 * @fileoverview Thin HTTP client for the running knowledge backend's schedule
 * API.
 *
 * @deprecated 2026-07-23 — NO LONGER USED. `discover-repos.js` now reaches the
 * live WorkflowBridge through the file-based bridge (`common/bridge/
 * workflowBridgeClient.js`) instead of calling the backend's REST API. That HTTP
 * self-call failed in production, where the backend is fronted by HTTPS + Entra
 * SSO on :443 (the request was redirected to the Entra login / rejected on the
 * dev cert). Do NOT wire this client back in — extend the bridge instead. Kept
 * only for reference; safe to delete once no environment depends on it.
 *
 * Workflow steps execute inside an isolated worker thread (see
 * `configuration/activities/run-workflow.js`), so they cannot reach the live
 * `WorkflowBridge` instance or its in-memory schedule list. At runtime the
 * bridge also OWNS `workflows.schedules.json` and rewrites it from memory on
 * every run, so a step that edited that file directly would be clobbered and a
 * newly added schedule would not activate until the next backend restart.
 *
 * The correct, side-effect-safe way to create a schedule is therefore to call
 * the same REST API the UI uses, against the locally running backend. That
 * mutates the live bridge, which then persists and activates the schedule.
 *
 * Endpoints used:
 *   POST /api/auth/login          -> obtain a bearer token (data.session.token)
 *   GET  /api/schedules           -> list live schedules (with lastRun)
 *   POST /api/workflows/schedule  -> create a cron schedule for a named workflow
 *
 * @author Digital Technologies Team
 * @version 1.0.0
 * @since 2026-06-08
 */

'use strict';

const http = require('node:http');
const https = require('node:https');

/** Hosts we treat as the local backend and therefore trust a self-signed cert for. */
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i;

class ScheduleApiClient {

   /**
    * @param {Object} options
    * @param {string} options.baseUrl  - e.g. `http://localhost:11001`
    * @param {string} [options.token]  - pre-shared service token (WORKFLOW_API_TOKEN).
    *   When set, it is used directly and no login is performed.
    * @param {string} [options.username] - service-account email (WORKFLOW_API_USER)
    * @param {string} [options.password] - service-account password (WORKFLOW_API_PASSWORD)
    * @param {Object} [options.logger] - optional logger
    */
   constructor(options = {}) {
      this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
      this.staticToken = options.token || null;
      this.username = options.username;
      this.password = options.password;
      this.logger = options.logger || console;
      this.token = null;
   }

   /**
    * Ensure the client holds a usable bearer token. Prefers a pre-shared service
    * token (WORKFLOW_API_TOKEN) and falls back to a username/password login.
    * Throws a clear, credential-free message when neither is configured.
    *
    * @returns {Promise<string>} the bearer token
    */
   async authenticate() {
      if (!this.baseUrl) throw new Error('Schedule API: baseUrl is not configured');
      if (this.staticToken) {
         this.token = this.staticToken;
         return this.token;
      }
      if (this.username && this.password) {
         return this.login();
      }
      throw new Error(
         'Schedule API: set WORKFLOW_API_TOKEN (preferred) — or WORKFLOW_API_USER and '
         + 'WORKFLOW_API_PASSWORD — in the platform .env so the discovery step can '
         + 'authenticate to the schedule API'
      );
   }

   /**
    * Authenticate the service account by username/password and cache the bearer
    * token. Throws with a clear, credential-free message when login fails so a
    * misconfiguration is obvious rather than surfacing later as a 401.
    *
    * @returns {Promise<string>} the bearer token
    */
   async login() {
      if (!this.baseUrl) throw new Error('Schedule API: baseUrl is not configured');
      if (!this.username || !this.password) {
         throw new Error(
            'Schedule API: WORKFLOW_API_USER and WORKFLOW_API_PASSWORD must be set in the platform .env '
            + 'so the discovery step can authenticate to the schedule API'
         );
      }

      const res = await this._fetch(`${this.baseUrl}/api/auth/login`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ email: this.username, password: this.password }),
      });

      const body = await this._json(res);
      if (!res.ok || !body || body.success === false) {
         const msg = (body && body.message) || `HTTP ${res.status}`;
         throw new Error(`Schedule API: login failed for ${this.username} (${msg})`);
      }

      const token = body.data && body.data.session && body.data.session.token;
      if (!token) {
         throw new Error('Schedule API: login succeeded but no bearer token was returned');
      }
      this.token = token;
      return token;
   }

   /**
    * List the live schedules known to the running backend.
    *
    * @returns {Promise<Array<Object>>} schedule records (include `name`, `lastRun`)
    */
   async listSchedules() {
      const res = await this._fetch(`${this.baseUrl}/api/schedules?limit=1000`, {
         method: 'GET',
         headers: this._headers(),
      });
      const body = await this._json(res);
      if (!res.ok || !body || body.success === false) {
         throw new Error(`Schedule API: failed to list schedules (HTTP ${res.status})`);
      }
      return Array.isArray(body.data) ? body.data : [];
   }

   /**
    * Create a recurring cron schedule that runs a named workflow.
    *
    * @param {Object} schedule
    * @param {string} schedule.workflowName - human workflow name to run
    * @param {string} schedule.cron - 5-field cron expression
    * @param {string} schedule.name - schedule name (matched back to the repo)
    * @param {Object} schedule.payload - input passed to the workflow each run
    * @returns {Promise<Object>} the created schedule summary (id, nextRun, ...)
    */
   async createSchedule({ workflowName, cron, name, payload }) {
      const res = await this._fetch(`${this.baseUrl}/api/workflows/schedule`, {
         method: 'POST',
         headers: this._headers(),
         body: JSON.stringify({ workflowName, cron, name, payload: payload || {} }),
      });
      const body = await this._json(res);
      if (!res.ok || !body || body.success === false) {
         const msg = (body && body.error) || `HTTP ${res.status}`;
         throw new Error(`Schedule API: failed to create schedule "${name}" (${msg})`);
      }
      return body;
   }

   /**
    * @private
    * Minimal `fetch`-shaped HTTP client built on `node:http`/`node:https`.
    *
    * The local backend runs HTTPS with a self-signed dev certificate. Node's
    * global `fetch` (undici) rejects that with `DEPTH_ZERO_SELF_SIGNED_CERT`
    * and cannot be told to trust it without the `undici` package (not exposed
    * to `require`). Using the built-in `https` module lets us disable cert
    * verification for loopback hosts ONLY — never for a remote backend — so a
    * dev cert is trusted without weakening TLS for anything else.
    *
    * @param {string} url
    * @param {{ method?: string, headers?: Object, body?: string }} [options]
    * @returns {Promise<{ ok: boolean, status: number, json: () => Promise<any> }>}
    */
   _fetch(url, options = {}) {
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const transport = isHttps ? https : http;

      const reqOptions = {
         method: options.method || 'GET',
         headers: options.headers || {},
      };
      if (isHttps && LOOPBACK_HOST.test(parsed.hostname)) {
         reqOptions.agent = new https.Agent({ rejectUnauthorized: false });
      }

      return new Promise((resolve, reject) => {
         const req = transport.request(url, reqOptions, (res) => {
            let raw = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
               resolve({
                  ok: res.statusCode >= 200 && res.statusCode < 300,
                  status: res.statusCode,
                  json: async () => JSON.parse(raw),
               });
            });
         });
         req.on('error', reject);
         if (options.body) req.write(options.body);
         req.end();
      });
   }

   /** @private */
   _headers() {
      const headers = { 'Content-Type': 'application/json' };
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      return headers;
   }

   /** @private Read a JSON body without throwing on an empty/non-JSON response. */
   async _json(res) {
      try {
         return await res.json();
      } catch (error) {
         return null;
      }
   }
}

module.exports = ScheduleApiClient;
