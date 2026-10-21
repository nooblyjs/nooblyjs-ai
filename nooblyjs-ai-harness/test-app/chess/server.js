import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
export const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
});
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use(express.static(path.join(root, 'public')));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Isometric Chess is ready at http://localhost:${port}`);
  });
  server.on('error', (error) => {
    console.error(`Could not start the server: ${error.message}`);
    process.exitCode = 1;
  });
}
