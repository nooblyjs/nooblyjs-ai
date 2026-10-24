// Phase 0: a tiny static server. The game itself runs entirely in the browser.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/** The Express app, exported so tests can start it on a random port. */
export const app = express();

app.disable('x-powered-by');
app.use((_req, res, next) => {
  // Everything (scripts, styles, sprites) comes from this server, so the
  // Content Security Policy can forbid anything from elsewhere.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
// Only public/ is served, so server.js, noobly/ and node_modules stay private.
app.use(express.static(path.join(root, 'public')));

// Start listening only when run directly (`node server.js`), not when a test imports this file.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Sandstone Depths is ready at http://localhost:${port}`);
  });
  server.on('error', (error) => {
    console.error(`Could not start the server: ${error.message}`);
    process.exitCode = 1;
  });
}
