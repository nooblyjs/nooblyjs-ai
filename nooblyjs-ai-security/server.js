// Standalone mode (stack.md §5): runs this app on its own, for development. It builds what NooblyJS would (an
// Express 5 app, the nooblyjs-core serverManager, the shell and the /ui/ kit), a stand-in `host` with a dev sign-in
// (test/fixtures/host.js), and then calls the same register() that NooblyJS calls. NooblyJS loads index.js instead.
//
//   npm start                      the API on PORT (default 11009): the screens at /security, the API at /security/api/v1
//   npm run seed [-- --reset]      writes the seed story into data/security/ and exits
//
// Sign in at /login, or send the X-Dev-Person header (e.g. curl -H "X-Dev-Person: lerato-m" …).
// Development only: it refuses to start when NODE_ENV=production.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { register } from './index.js';
import { createHost, PERSON_COOKIE, CSRF_COOKIE } from './test/fixtures/host.js';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MOUNT_PATH = '/security';
const DEFAULT_PORT = 11009;
const STATIC = { index: false, redirect: false };
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

if (process.env.NODE_ENV === 'production') {
  console.error('server.js is for development only (dev sign-in). In production, NooblyJS hosts this app.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const dataRoot = path.resolve(ROOT, process.env.DATA_DIR ?? 'data');
const dataDir = path.join(dataRoot, MOUNT_PATH.slice(1));
await fs.mkdir(dataDir, { recursive: true });
const firstStart = (await fs.readdir(dataDir)).length === 0;

// nooblyjs-core: the host owns the serverManager and initialises it once.
const serverManager = require('nooblyjs-core');
const { createShell, UI_DIR } = require('nooblyjs-core/src/shell');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
serverManager.initialize(app, undefined, {
  security: { apiKeyAuth: { requireApiKey: false, apiKeys: [] }, servicesAuth: { requireLogin: false } },
});
const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: 'standalone' });

let shell;
const stand = createHost({ rootDir: dataRoot, persist: true, frame: (req, res, next) => shell.frame(req, res, next) });
shell = createShell({ express, auth: stand.auth, can: stand.can, permissionsFor: stand.permissionsFor, log });

// ---------- dev sign-in ----------
const cookie = (name, value, { httpOnly = true } = {}) =>
  `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}`;
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');

app.get('/login', (req, res) => {
  const next = safeNext(req.query.next);
  const rows = stand.people.map((p) => `
      <form method="post" action="/login?next=${encodeURIComponent(next)}">
        <input type="hidden" name="person" value="${escapeHtml(p.id)}">
        <button type="submit">${escapeHtml(p.name)}</button> ${escapeHtml(p.accessRole)} · ${escapeHtml(p.workRole)}
      </form>`).join('');
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in · NooblyJS Security (standalone)</title></head>
    <body><h1>Sign in as</h1><p>Development sign-in for the standalone app.</p>${rows}</body></html>`);
});
app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const person = stand.people.find((p) => p.id === req.body?.person);
  if (!person) return res.status(400).type('text').send('Pick a person.');
  // The CSRF cookie is readable by the page, which sends it back as X-CSRF-Token (NooblyJS's /ui/js/api.js does this).
  res.setHeader('Set-Cookie', [cookie(PERSON_COOKIE, person.id), cookie(CSRF_COOKIE, crypto.randomBytes(24).toString('base64url'), { httpOnly: false })]);
  res.redirect(303, safeNext(req.query.next));
});
app.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', [`${PERSON_COOKIE}=; Path=/; Max-Age=0`, `${CSRF_COOKIE}=; Path=/; Max-Age=0`]);
  res.redirect(303, '/login');
});

// ---------- the host's order: CSRF → shell and UI kit → hosted app → frame → 404 ----------
app.use(stand.csrf);
app.use(shell.router);
app.use('/ui', express.static(UI_DIR, STATIC));

let hosted;
try {
  hosted = await register(app, serverManager, { mountPath: MOUNT_PATH, dataDir, host: stand.hostFor(dataDir) });
  shell.add(hosted, { name: hosted.name, mountPath: MOUNT_PATH });
  log.info(`mounted ${hosted.name} at ${MOUNT_PATH}`);
} catch (err) {
  log.error(`could not mount nooblyjs-ai-security at ${MOUNT_PATH}: ${err.message}`);
  process.exit(1);
}

if (args.has('--seed')) {
  await hosted.seed({ reset: args.has('--reset') });
  log.info(`seeded ${path.relative(ROOT, dataDir)}${args.has('--reset') ? ' (reset)' : ''}`);
  await hosted.close();
  await serverManager.shutdown?.();
  process.exit(0);
}
if (firstStart) await hosted.seed({ reset: false });

// The home page is Security; its pages are this app's module in the frame.
app.get('/', (req, res) => res.redirect(302, MOUNT_PATH));
app.use((req, res) => {
  if (req.originalUrl.includes('/api/')) return res.status(404).json({ error: { code: 'not_found', message: 'No such API route.' } });
  res.status(404).type('text').send('Not found.');
});

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const server = app.listen(port, () => {
  log.info(`nooblyjs-ai-security standalone on http://localhost:${port} (API at ${MOUNT_PATH}/api/v1, data in ${path.relative(ROOT, dataDir)})`);
});

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`${signal}: stopping`);
  server.close();
  await hosted.close();
  await serverManager.shutdown?.();
  process.exit(0);
}
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
