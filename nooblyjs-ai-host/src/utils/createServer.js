/**
 * @fileoverview HTTP / HTTPS server factory.
 *
 * Builds the Node server for an Express app, selecting the transport from the
 * HTTPS_ENABLED environment variable so the app can run over either protocol
 * without code changes:
 *
 *   HTTPS_ENABLED=false (or unset) → plain HTTP
 *   HTTPS_ENABLED=true             → HTTPS using the configured key/cert
 *
 *   HTTPS_KEY_PATH   path to the private key  (default: ./certs/server.key)
 *   HTTPS_CERT_PATH  path to the certificate  (default: ./certs/server.crt)
 *   HTTPS_CA_PATH    optional CA/chain bundle
 *   HTTPS_PASSPHRASE optional private-key passphrase
 *
 * Relative certificate paths are resolved against `baseDir` (the nooblyjs-ai-host folder).
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

/**
 * Create an HTTP or HTTPS server for the given Express app.
 *
 * @param {import('express').Express} app - The Express application.
 * @param {object} [options]
 * @param {string} [options.baseDir=process.cwd()] - Directory that relative
 *   certificate paths are resolved against (normally the backend/ folder).
 * @returns {{ server: import('http').Server, protocol: 'http'|'https',
 *   httpsEnabled: boolean }}
 */
export function createServer(app, options = {}) {
  const baseDir = options.baseDir || process.cwd();
  const httpsEnabled = process.env.HTTPS_ENABLED === 'true';

  const resolvePath = (p) => (path.isAbsolute(p) ? p : path.join(baseDir, p));

  if (!httpsEnabled) {
    return { server: http.createServer(app), protocol: 'http', httpsEnabled: false };
  }

  const keyPath = resolvePath(process.env.HTTPS_KEY_PATH || './certs/server.key');
  const certPath = resolvePath(process.env.HTTPS_CERT_PATH || './certs/server.crt');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    // Thrown, not process.exit(): app.js reports it and exits; tests can assert it.
    throw new Error(
      `HTTPS_ENABLED=true but the TLS certificate files were not found (key: ${keyPath}, cert: ${certPath}). `
      + 'Generate development certificates, or set HTTPS_KEY_PATH / HTTPS_CERT_PATH.'
    );
  }

  const httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };

  if (process.env.HTTPS_CA_PATH) {
    const caPath = resolvePath(process.env.HTTPS_CA_PATH);
    if (fs.existsSync(caPath)) {
      httpsOptions.ca = fs.readFileSync(caPath);
    }
  }

  if (process.env.HTTPS_PASSPHRASE) {
    httpsOptions.passphrase = process.env.HTTPS_PASSPHRASE;
  }

  return {
    server: https.createServer(httpsOptions, app),
    protocol: 'https',
    httpsEnabled: true
  };
}

/**
 * Create a lightweight HTTP server that 301-redirects every request to the
 * equivalent HTTPS URL. Intended to run alongside the HTTPS server so plain
 * HTTP clients are bounced to the secure endpoint.
 *
 * The redirect preserves the requested hostname and path, swapping only the
 * scheme and port. Listen port defaults to 80 (HTTP_REDIRECT_PORT to override).
 *
 * @param {object} [options]
 * @param {number|string} options.httpsPort - Port the HTTPS server listens on,
 *   used as the redirect target port.
 * @returns {{ server: import('http').Server, port: number }}
 */
export function createHttpRedirectServer(options = {}) {
  const httpsPort = Number(options.httpsPort);
  const port = Number(process.env.HTTP_REDIRECT_PORT || 80);

  const server = http.createServer((req, res) => {
    // Strip any port from the incoming Host header, then point at the HTTPS port.
    const hostHeader = req.headers.host || `localhost:${httpsPort}`;
    const hostname = hostHeader.split(':')[0];
    // Omit the port from the redirect when HTTPS runs on the standard 443.
    const portSuffix = httpsPort === 443 ? '' : `:${httpsPort}`;
    const location = `https://${hostname}${portSuffix}${req.url}`;

    res.writeHead(301, { Location: location });
    res.end();
  });

  return { server, port };
}

