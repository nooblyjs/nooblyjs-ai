/**
 * @fileoverview Tests for the configurable proxy layer
 * (src/shared/proxies/proxyManager.js).
 *
 * Covers config parsing/validation and the actual mounting behaviour: a real
 * upstream HTTP server is started and driven through a real Express app, so the
 * path rewriting, header pass-through and body forwarding are exercised end to
 * end rather than asserted against mocks.
 */

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const express = require('express');

const {
  registerProxies,
  readProxyConfigs,
  configPath,
  normaliseEntry
} = require('../../../src/shared/proxies/proxyManager');

/** Write a proxies.json into a throwaway APP_BASE_DIR and return that dir. */
function writeConfig(contents) {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxycfg-'));
  const file = configPath(baseDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return baseDir;
}

const silentLog = { info() {}, warn() {}, error() {} };

/** @returns {Promise<{server: http.Server, port: number}>} */
function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/** Minimal request helper — returns status, headers and body. */
function request(port, reqPath, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: reqPath, method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('proxyManager config parsing', () => {
  it('returns an empty list when proxies.json does not exist', () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxycfg-'));
    const result = readProxyConfigs(baseDir);

    expect(result.entries).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it('parses the documented { name, host } shape and derives the mount path', () => {
    const baseDir = writeConfig([
      { name: 'servicesproxy', host: 'https://localhost:9101/services' },
      { name: 'datasourcesproxy', host: 'https://localhost:9101/applications/datasources' }
    ]);

    const { entries, problems } = readProxyConfigs(baseDir);

    expect(problems).toEqual([]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      name: 'servicesproxy',
      host: 'https://localhost:9101/services',
      mountPath: '/proxies/servicesproxy',
      enabled: true,
      ws: true,
      secure: false,        // self-signed localhost targets must work by default
      changeOrigin: true
    });
    expect(entries[1].mountPath).toBe('/proxies/datasourcesproxy');
  });

  it('honours the optional flags', () => {
    const baseDir = writeConfig([
      { name: 'p', host: 'http://x.test', enabled: false, ws: false, secure: true, changeOrigin: false }
    ]);

    expect(readProxyConfigs(baseDir).entries[0]).toMatchObject({
      enabled: false, ws: false, secure: true, changeOrigin: false
    });
  });

  it.each([
    [{ host: 'http://x.test' }, /missing "name"/],
    [{ name: 'p' }, /missing "host"/],
    [{ name: 'a/b', host: 'http://x.test' }, /single path segment/],
    [{ name: '../evil', host: 'http://x.test' }, /single path segment/],
    [{ name: 'p', host: '/relative/path' }, /not an absolute URL/],
    [{ name: 'p', host: 'ftp://x.test' }, /must be http or https/]
  ])('rejects invalid entry %p', (entry, expected) => {
    const baseDir = writeConfig([entry]);
    const { entries, problems } = readProxyConfigs(baseDir);

    expect(entries).toEqual([]);
    expect(problems.join('\n')).toMatch(expected);
  });

  it('keeps valid entries when a sibling entry is invalid', () => {
    const baseDir = writeConfig([
      { name: 'good', host: 'http://x.test' },
      { name: 'bad' }
    ]);
    const { entries, problems } = readProxyConfigs(baseDir);

    expect(entries.map((e) => e.name)).toEqual(['good']);
    expect(problems).toHaveLength(1);
  });

  it('mounts only the first of a duplicated name', () => {
    const baseDir = writeConfig([
      { name: 'dup', host: 'http://first.test' },
      { name: 'dup', host: 'http://second.test' }
    ]);
    const { entries, problems } = readProxyConfigs(baseDir);

    expect(entries).toHaveLength(1);
    expect(entries[0].host).toBe('http://first.test');
    expect(problems.join()).toMatch(/duplicate name/);
  });

  it.each([
    ['not json at all', /not valid JSON/],
    ['{"name":"p"}', /must contain a JSON array/]
  ])('reports malformed config %p without throwing', (contents, expected) => {
    const baseDir = writeConfig(contents);
    const { entries, problems } = readProxyConfigs(baseDir);

    expect(entries).toEqual([]);
    expect(problems.join()).toMatch(expected);
  });

  it('normaliseEntry reports the entry position when name is absent', () => {
    expect(normaliseEntry({}, 3)).toMatchObject({ ok: false, reason: expect.stringContaining('entry #4') });
  });
});

describe('proxyManager mounting', () => {
  let upstream;
  let upstreamPort;
  let received;
  let proxyServer;
  let proxyPort;

  beforeEach(async () => {
    received = [];
    const started = await listen((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        received.push({ url: req.url, method: req.method, headers: req.headers, body });
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Upstream': 'yes' });
        res.end(JSON.stringify({ sawUrl: req.url }));
      });
    });
    upstream = started.server;
    upstreamPort = started.port;
  });

  afterEach(async () => {
    if (proxyServer) await closeServer(proxyServer);
    if (upstream) await closeServer(upstream);
    proxyServer = null;
  });

  /** Build an Express app with proxies mounted first, then start it. */
  async function startProxyApp(entries) {
    const baseDir = writeConfig(entries);
    const app = express();
    registerProxies({ app, appBaseDir: baseDir, log: silentLog });
    app.use(express.json());
    app.get('/not-proxied', (req, res) => res.json({ local: true }));

    const started = await listen(app);
    proxyServer = started.server;
    proxyPort = started.port;
  }

  it('forwards the sub-path, preserving the base path of the target', async () => {
    await startProxyApp([{ name: 'servicesproxy', host: `http://127.0.0.1:${upstreamPort}/services` }]);

    const res = await request(proxyPort, '/proxies/servicesproxy/authservice/api/roles');

    expect(res.status).toBe(200);
    expect(received[0].url).toBe('/services/authservice/api/roles');
  });

  it('preserves the query string', async () => {
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}/base` }]);

    await request(proxyPort, '/proxies/p/thing?a=1&b=two');

    expect(received[0].url).toBe('/base/thing?a=1&b=two');
  });

  it('maps a bare mount path to the target root', async () => {
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}/base` }]);

    await request(proxyPort, '/proxies/p');

    expect(received[0].url).toBe('/base/');
  });

  it('forwards arbitrary request headers, cookies and authorization', async () => {
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}` }]);

    await request(proxyPort, '/proxies/p/x', {
      headers: {
        authorization: 'Bearer abc123',
        cookie: 'sid=xyz; other=1',
        'x-custom-header': 'kept'
      }
    });

    expect(received[0].headers.authorization).toBe('Bearer abc123');
    expect(received[0].headers.cookie).toBe('sid=xyz; other=1');
    expect(received[0].headers['x-custom-header']).toBe('kept');
  });

  it('adds X-Forwarded-* so the target can see the original client', async () => {
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}` }]);

    await request(proxyPort, '/proxies/p/x');

    expect(received[0].headers['x-forwarded-proto']).toBe('http');
    expect(received[0].headers['x-forwarded-for']).toBeDefined();
  });

  it('forwards the request body on POST', async () => {
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}` }]);

    await request(proxyPort, '/proxies/p/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' })
    });

    expect(received[0].method).toBe('POST');
    expect(JSON.parse(received[0].body)).toEqual({ hello: 'world' });
  });

  it('returns the target response headers to the client', async () => {
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}` }]);

    const res = await request(proxyPort, '/proxies/p/x');

    expect(res.headers['x-upstream']).toBe('yes');
  });

  it('does not capture a name that merely shares a prefix', async () => {
    await startProxyApp([{ name: 'api', host: `http://127.0.0.1:${upstreamPort}` }]);

    const res = await request(proxyPort, '/proxies/apidocs/x');

    expect(received).toHaveLength(0);
    expect(res.status).toBe(404);
  });

  it('leaves non-proxied routes alone', async () => {
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}` }]);

    const res = await request(proxyPort, '/not-proxied');

    expect(JSON.parse(res.body)).toEqual({ local: true });
    expect(received).toHaveLength(0);
  });

  it('skips disabled entries', async () => {
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}`, enabled: false }]);

    const res = await request(proxyPort, '/proxies/p/x');

    expect(received).toHaveLength(0);
    expect(res.status).toBe(404);
  });

  it('answers 502 when the target is unreachable', async () => {
    await closeServer(upstream);
    upstream = null;
    await startProxyApp([{ name: 'p', host: `http://127.0.0.1:${upstreamPort}` }]);

    const res = await request(proxyPort, '/proxies/p/x');

    expect(res.status).toBe(502);
    expect(res.body).toMatch(/Proxy "p" unavailable/);
  });
});
