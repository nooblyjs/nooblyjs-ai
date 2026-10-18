// @ts-check
// Phase F17: STATIC FILES, the dashboard page itself. They need no token: they hold no
// data, only code. Nothing outside `dir` is ever served ("/../package.json" is a 404).
import fs from 'node:fs';
import path from 'node:path';

export const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

/** The file under `dir` for a URL path, or null when there is none (or it would be outside `dir`). */
export function staticFile(dir, pathname) {
  if (!dir) return null;
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(dir, rel);
  if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
  return file;
}

/**
 * @param {string | undefined} dir
 * @param {string} pathname
 * @param {import('node:http').ServerResponse} res
 */
export function serveStatic(dir, pathname, res) {
  const file = staticFile(dir, pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com" });
  fs.createReadStream(file).pipe(res);
}
