/**
 * @fileoverview Loopback client for the wiki's own public HTTP API.
 *
 * The MCP tools deliberately go back through HTTP rather than reaching into
 * DataManager / the filing services directly. That is the whole security
 * design: every read then traverses `spacePaths.js` with visibility ON, so a
 * curated-away path answers 404 (never 403), pass-through containers behave,
 * and shared content roots stay curated per space. Bypassing HTTP would mean
 * re-implementing that boundary in a second place — see the shared-content-root
 * guards note in CLAUDE.md for how that went the first time.
 *
 * Three traps this module exists to absorb:
 *
 * 1. **Never call the public hostname.** A self-call to the external URL goes
 *    back through the reverse proxy and the Entra SSO guard, which answers a
 *    302 to the login page rather than data. (Same failure the workflow bridge
 *    hit before it moved to file IPC.) We always target 127.0.0.1.
 *
 * 2. **The loopback port and protocol are read off the live request**, not from
 *    config. `req.socket.localPort` is literally the port this request arrived
 *    on and `req.socket.encrypted` whether it was TLS — so this keeps working
 *    when PORT changes, and under both the HTTP and HTTPS boot paths (app.js
 *    binds HTTPS on PORT and only 301-redirects from the HTTP port, so guessing
 *    `http://127.0.0.1:9101` would silently follow a redirect in production).
 *
 * 3. **TLS verification is off for loopback only.** The HTTPS boot path uses
 *    self-signed certs, and we are talking to ourselves over 127.0.0.1 — there
 *    is no man in the middle to protect against on a loopback socket.
 *
 * @author noobly Team
 * @version 1.0.0
 * @since 2026-08-19
 */

'use strict';

const http = require('node:http');
const https = require('node:https');

/** Wall-clock cap for one internal call. Search on a cold index is the slow one. */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Derive the loopback origin from the request currently being served.
 *
 * @param {Object} req - Express request the MCP call arrived on
 * @returns {string} e.g. `https://127.0.0.1:9101`
 */
function originFor(req) {
  // Escape hatch for deployments that terminate TLS oddly or bind the app in a
  // container where the socket's local port is not reachable from itself.
  if (process.env.WIKI_MCP_INTERNAL_ORIGIN) {
    return process.env.WIKI_MCP_INTERNAL_ORIGIN.replace(/\/+$/, '');
  }

  const socket = req.socket || {};
  const secure = Boolean(socket.encrypted);
  const port = socket.localPort || process.env.PORT || 9101;
  return `${secure ? 'https' : 'http'}://127.0.0.1:${port}`;
}

/**
 * Build a space-relative document path safe to interpolate into a route.
 *
 * The document routes are declared as `:documentPath(*)`, so the `/` separators
 * must survive while every other character is escaped. Encoding the whole path
 * in one go would turn the separators into `%2F` and the route would not match.
 *
 * @param {string} relPath - Space-relative path, `/` separated
 * @returns {string} Path with each segment percent-encoded
 */
function encodePath(relPath) {
  return String(relPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
}

/**
 * Perform one GET against the loopback origin.
 *
 * Returns the raw pieces rather than throwing on a non-2xx: the tools turn an
 * error status into a message the model can act on ("not found", "no access"),
 * which is far more useful to it than a thrown stack.
 *
 * @param {Object} params
 * @param {string} params.origin - Loopback origin
 * @param {string} params.path - Absolute request path incl. query string
 * @param {Object} params.headers - Headers to send (auth is forwarded here)
 * @param {number} [params.timeoutMs]
 * @returns {Promise<{status:number, contentType:string, buffer:Buffer, text:string, json:Object|null}>}
 */
function get({ origin, path, headers, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const url = new URL(path, origin);
  const transport = url.protocol === 'https:' ? https : http;

  // MUST be the two-argument `request(options, callback)` form.
  //
  // `passport-azure-ad` (pulled in by the Entra SSO wiring) depends on
  // `agent-base`, which MONKEY-PATCHES `https.request` process-wide with a
  // legacy signature that accepts only `(options[, callback])`. Call the modern
  // three-argument `(url, options, callback)` form and the patch binds our
  // options object as the callback, and Node throws deep inside ClientRequest:
  // `The "listener" argument must be of type function. Received an instance of
  // Object`. The failure is invisible outside a full boot — a standalone script
  // never loads passport-azure-ad and works fine — so it only shows up in the
  // running app.
  const options = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers,
    // Loopback + self-signed certs. See the file header.
    rejectUnauthorized: false
  };

  return new Promise((resolve, reject) => {
    const request = transport.request(
      options,
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const contentType = String(response.headers['content-type'] || '');
          const isJson = contentType.includes('application/json');
          // Only decode as text when it actually is text — a PDF or image body
          // must stay a Buffer, and `.toString()` on one is a lot of garbage
          // tokens if it ever reached the model.
          const text = isJson || contentType.startsWith('text/') ? buffer.toString('utf8') : '';

          let json = null;
          if (isJson) {
            try {
              json = JSON.parse(text);
            } catch {
              // A JSON content-type carrying non-JSON is a server bug; surface
              // it as an empty parse rather than killing the tool call.
              json = null;
            }
          }

          resolve({ status: response.statusCode, contentType, buffer, text, json });
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Internal API request timed out after ${timeoutMs}ms: ${path}`));
    });
    request.on('error', reject);
    request.end();
  });
}

/**
 * Bind a client to one incoming MCP request.
 *
 * The caller's `Authorization` header is forwarded verbatim, so the internal
 * call re-runs the real bearer middleware and acts as the real user with their
 * live roles. Nothing here elevates: an expired or revoked `dtk_` token gets
 * exactly the access an anonymous caller would.
 *
 * @param {Object} req - Express request the MCP call arrived on
 * @returns {{get: Function, origin: string}}
 */
function forRequest(req) {
  const origin = originFor(req);

  const headers = {
    Accept: 'application/json',
    // Marks internal traffic in the access log so a slow MCP consumer is
    // distinguishable from a slow browser.
    'User-Agent': 'wiki-mcp/1.0 (internal)'
  };
  if (req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  return {
    origin,
    get: (path, options = {}) => get({ origin, path, headers, ...options })
  };
}

module.exports = { forRequest, encodePath, originFor, DEFAULT_TIMEOUT_MS };
