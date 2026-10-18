/**
 * @fileoverview Configurable reverse-proxy layer.
 *
 * Reads `<APP_BASE_DIR>/configuration/proxies/proxies.json` and mounts one
 * transparent reverse proxy per entry at `/proxies/<name>`, forwarding every
 * request — method, path, query, headers, cookies and body — to `host`.
 *
 * proxies.json is a JSON array:
 *
 *   [
 *     { "name": "servicesproxy",    "host": "https://localhost:9101/services" },
 *     { "name": "datasourcesproxy", "host": "https://localhost:9101/applications/datasources" }
 *   ]
 *
 * Required per entry: `name` (a single URL path segment) and `host` (an
 * absolute http/https URL, optionally including a base path).
 * Optional: `enabled` (default true), `ws` (default true — proxy websocket
 * upgrades), `secure` (default false — do NOT verify the target's TLS
 * certificate, so self-signed localhost targets work), `changeOrigin`
 * (default true — rewrite the Host header to the target).
 *
 * A path under the target is preserved and prepended, so with the config above:
 *
 *   GET /proxies/servicesproxy/authservice/api/roles
 *     -> GET https://localhost:9101/services/authservice/api/roles
 *
 * TRANSPARENCY: these proxies are mounted as the FIRST middleware on the app,
 * ahead of helmet, CORS, the session and the body parser. That is deliberate:
 *   - the response carries only the target's headers, not this app's security
 *     headers (helmet's CSP / X-Frame-Options would otherwise be bolted onto
 *     content this app did not generate),
 *   - the request body stream reaches the target untouched, so POST/PUT/PATCH
 *     work. (`fixRequestBody` is still wired as a belt-and-braces measure in
 *     case the mount point ever moves after a body parser.)
 *
 * AUTHENTICATION is deliberately NOT enforced here — credentials are forwarded
 * verbatim, so the target applies its own. Note the corollary: an entry in
 * proxies.json exposes its host through this server to anyone who can reach
 * /proxies/<name>. The file is operator-owned configuration; treat adding an
 * entry with the same care as opening a firewall rule.
 *
 * Config is read once at startup — edits require a restart, exactly like
 * `spaces/repositories.json`. A malformed file or entry is logged and skipped;
 * it never aborts startup.
 *
 * @author noobly Team
 * @version 1.0.0
 */

'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { createProxyMiddleware, fixRequestBody } = require('http-proxy-middleware');

/** Public mount root. Every proxy lives at `${PROXY_MOUNT_ROOT}/<name>`. */
const PROXY_MOUNT_ROOT = '/proxies';

/**
 * `name` becomes a URL path segment, so restrict it to characters that cannot
 * escape the mount point or introduce a second segment.
 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * @param {string} appBaseDir
 * @returns {string} absolute path to proxies.json
 */
function configPath(appBaseDir) {
  return path.join(appBaseDir, 'configuration', 'proxies', 'proxies.json');
}

/**
 * Validate and normalise one raw config entry.
 *
 * @param {object} raw
 * @param {number} index - position in the file, for error messages
 * @returns {{ok: true, entry: object}|{ok: false, reason: string}}
 */
function normaliseEntry(raw, index) {
  const label = raw && raw.name ? `"${raw.name}"` : `entry #${index + 1}`;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: `${label}: not a JSON object` };
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return { ok: false, reason: `${label}: missing "name"` };
  if (!SAFE_NAME.test(name)) {
    return {
      ok: false,
      reason: `${label}: "name" must be a single path segment matching ${SAFE_NAME} ` +
        '(letters, digits, dot, dash, underscore)'
    };
  }

  const host = typeof raw.host === 'string' ? raw.host.trim() : '';
  if (!host) return { ok: false, reason: `${label}: missing "host"` };

  let target;
  try {
    target = new URL(host);
  } catch {
    return { ok: false, reason: `${label}: "host" is not an absolute URL (got "${host}")` };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, reason: `${label}: "host" must be http or https (got "${target.protocol}")` };
  }

  return {
    ok: true,
    entry: {
      name,
      host,
      mountPath: `${PROXY_MOUNT_ROOT}/${name}`,
      enabled: raw.enabled !== false,
      // Default false: targets are typically localhost with a self-signed
      // certificate, which strict verification would reject.
      secure: raw.secure === true,
      changeOrigin: raw.changeOrigin !== false,
      ws: raw.ws !== false
    }
  };
}

/**
 * Read and validate proxies.json. Never throws — a missing file yields an empty
 * list, and unusable entries are reported in `problems`.
 *
 * @param {string} appBaseDir
 * @returns {{file: string, entries: Array<object>, problems: Array<string>}}
 */
function readProxyConfigs(appBaseDir) {
  const file = configPath(appBaseDir);
  const problems = [];

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') problems.push(`Failed to read ${file}: ${err.message}`);
    return { file, entries: [], problems };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    problems.push(`${file} is not valid JSON: ${err.message}`);
    return { file, entries: [], problems };
  }

  if (!Array.isArray(parsed)) {
    problems.push(`${file} must contain a JSON array of { name, host } objects.`);
    return { file, entries: [], problems };
  }

  const entries = [];
  const seen = new Set();

  parsed.forEach((rawEntry, index) => {
    const result = normaliseEntry(rawEntry, index);
    if (!result.ok) {
      problems.push(result.reason);
      return;
    }
    if (seen.has(result.entry.name)) {
      problems.push(`"${result.entry.name}": duplicate name — only the first is mounted`);
      return;
    }
    seen.add(result.entry.name);
    entries.push(result.entry);
  });

  return { file, entries, problems };
}

/**
 * Mount every enabled proxy onto the Express app.
 *
 * Call this BEFORE helmet / CORS / session / body-parser — see the transparency
 * note in the file header.
 *
 * @param {object} context
 * @param {import('express').Express} context.app
 * @param {string} context.appBaseDir
 * @param {object} [context.log] - structured logger; falls back to console
 * @returns {Array<object>} summary of mounted proxies
 */
function registerProxies(context) {
  const { app, appBaseDir, log = console } = context;
  const { file, entries, problems } = readProxyConfigs(appBaseDir);

  for (const problem of problems) log.warn(`Proxies: ${problem}`);

  if (!entries.length) {
    log.info(`Proxies: no proxies mounted (config: ${file}).`);
    return [];
  }

  const mounted = [];

  for (const entry of entries) {
    if (!entry.enabled) {
      log.info(`Proxies: "${entry.name}" disabled (enabled=false) — skipped.`);
      continue;
    }

    app.use(createProxyMiddleware({
      target: entry.host,
      changeOrigin: entry.changeOrigin,
      secure: entry.secure,
      ws: entry.ws,
      // Add X-Forwarded-For / -Proto / -Host so the target can see the original
      // client rather than this server.
      xfwd: true,

      // Exact segment match. A plain string pathFilter is a prefix test, which
      // would make "/proxies/api" also capture "/proxies/apidocs".
      pathFilter: (pathname) =>
        pathname === entry.mountPath || pathname.startsWith(`${entry.mountPath}/`),

      // Strip the mount prefix; whatever path the target URL carries is
      // prepended by http-proxy (prependPath defaults to true).
      pathRewrite: (reqPath) => {
        const rest = reqPath.slice(entry.mountPath.length);
        if (!rest) return '/';
        return rest.startsWith('/') ? rest : `/${rest}`;
      },

      on: {
        // No-op unless something upstream has already parsed the body; see the
        // transparency note in the file header.
        proxyReq: fixRequestBody,
        error: (err, req, res) => {
          log.error(`Proxy "${entry.name}" error for ${req && req.url} -> ${entry.host}: ${err.message}`);
          if (res && typeof res.writeHead === 'function' && !res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end(`Proxy "${entry.name}" unavailable — could not reach ${entry.host}`);
          } else if (res && typeof res.destroy === 'function') {
            res.destroy();
          }
        }
      }
    }));

    mounted.push({ name: entry.name, mountPath: entry.mountPath, host: entry.host, ws: entry.ws });
    log.info(`✓ Proxy mounted: ${entry.mountPath}/* -> ${entry.host} (ws=${entry.ws}, verifyTls=${entry.secure})`);
  }

  log.info(`✓ Proxies: ${mounted.length} mounted from ${file}`);
  return mounted;
}

module.exports = {
  registerProxies,
  readProxyConfigs,
  configPath,
  normaliseEntry,
  PROXY_MOUNT_ROOT
};
