// @ts-check
// Phase F17: a small HTTP layer on node:http. A router, JSON in and out, a bearer token, static files.
//
//   routes: [['GET', '/api/runs/:id', handler], …]
//   handler({ params, query, body, req, res, principal }) → { status?, json } | { stream: true } (it wrote res itself)
//
// Security, in order of importance:
//   1. bind to 127.0.0.1 (the caller's job): the dashboard is not on the network
//   2. every /api/ and /worker/ route needs a token (src/middleware/auth.js)
//   3. POST bodies are JSON, ≤ 100 KB (src/middleware/body.js)
// Everything else is a static file (src/middleware/static.js).
import http from 'node:http';
import { singleToken, tokenFrom } from '../middleware/auth.js';
import { readJson } from '../middleware/body.js';
import { serveStatic } from '../middleware/static.js';

/** Compile '/api/runs/:id' into a matcher: path → params, or null. */
export function compile(pattern) {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/\/:(\w+)/g, (_, n) => (names.push(n), '/([^/]+)'))}$`);
  return (p) => {
    const m = p.match(re);
    return m && Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
  };
}

/**
 * @param {{ routes: Array<[string, string, (ctx: any) => any]>, token?: string, staticDir?: string, authorize?: (given: string | null) => any }} options
 *   authorize (Phase F23): who is this token? (a principal, or null). Instead of the single `token`.
 */
export function createHttpServer({ routes, token, staticDir, authorize }) {
  if (!token && !authorize) throw new Error('The dashboard needs a token.');
  const who = authorize ?? singleToken(token);
  const table = routes.map(([method, pattern, handler]) => ({ method, match: compile(pattern), handler }));

  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/worker/')) return serveStatic(staticDir, url.pathname, res);

      const principal = who(tokenFrom(req, url));
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
