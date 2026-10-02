// @ts-check
// Phase F17: a small HTTP layer on node:http. A router, JSON in and out, a bearer token, static files.
//
//   routes: [['GET', '/api/runs/:id', handler], …]
//   handler({ params, query, body, req, res }) → { status?, json } | { stream: true } (it wrote res itself)
//
// Security, in order of importance:
//   1. bind to 127.0.0.1 (the caller's job): the dashboard is not on the network
//   2. every /api/ route needs the token: `Authorization: Bearer <t>`, `X-Factory-Token: <t>`
//      (what the dashboard sends: proxies like Cloud Shell's web preview claim `Authorization`
//      for their own login), or `?token=` for EventSource, which can't send headers.
//      Compared in constant time.
//   3. POST bodies are JSON, ≤ 100 KB, and a POST must carry the token in the HEADER: a
//      query token alone could be replayed by any page that learned the URL (CSRF-ish)
// Static files (the page itself) need no token: they hold no data, only code.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const MAX_BODY = 100_000;

/** Compile '/api/runs/:id' into a matcher. */
function compile(pattern) {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/\/:(\w+)/g, (_, n) => (names.push(n), '/([^/]+)'))}$`);
  return (p) => {
    const m = p.match(re);
    return m && Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
  };
}

function tokenOk(expected, got) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(got ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * @param {{ routes: Array<[string, string, (ctx: any) => any]>, token?: string, staticDir?: string, authorize?: (given: string | null) => any }} options
 *   authorize (Phase F23): who is this token? (a principal, or null). Instead of the single `token`.
 */
export function createHttpServer({ routes, token, staticDir, authorize }) {
  if (!token && !authorize) throw new Error('The dashboard needs a token.');
  const table = routes.map(([method, pattern, handler]) => ({ method, match: compile(pattern), handler }));

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/worker/')) return serveStatic(staticDir, url.pathname, res);

      const header = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : (/** @type {string | undefined} */ (req.headers['x-factory-token']) ?? null);
      const given = header ?? (req.method === 'GET' ? url.searchParams.get('token') : null);
      const principal = authorize ? authorize(given) : tokenOk(token, given) ? { role: 'operator' } : null;
      if (!principal) return json(401, { error: 'A token is needed (the URL factory printed has it).' });

      for (const route of table) {
        if (route.method !== req.method) continue;
        const params = route.match(url.pathname);
        if (!params) continue;
        const body = req.method === 'POST' ? await readJson(req) : undefined;
        const out = await route.handler({ params, query: Object.fromEntries(url.searchParams), body, req, res, principal });
        if (out?.stream) return; // the handler owns the response (SSE)
        return json(out?.status ?? 200, out?.json ?? {});
      }
      json(404, { error: `No route ${req.method} ${url.pathname}` });
    } catch (error) {
      const status = /** @type {any} */ (error).status ?? 400;
      if (!res.headersSent) json(status, { error: error instanceof Error ? error.message : String(error) });
      else res.end();
    }
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('The body must be JSON.'));
      }
    });
  });
}

function serveStatic(dir, pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = dir && path.resolve(dir, rel);
  if (!file || !file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com" });
  fs.createReadStream(file).pipe(res);
}
