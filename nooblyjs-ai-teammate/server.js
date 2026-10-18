// Standalone mode (../nooblyjs-ai-host/.claude/steering/structure.md §2a, standalone mode): Teammates on its own. It
// builds what the NooblyJS AI host would (an Express 5 app, the nooblyjs-core serverManager, the shell and the /ui/
// kit), with people signing in through nooblyjs-core's authservice (src/services/standalone-host.js), and then calls the same
// register() the host calls. Hosted, the host loads index.js instead.
//
//   npm start      http://127.0.0.1:11202 (the app at /teammates, the service dashboards at /services/)
//
// On the first start core creates admin@localhost; the log says where its password is.
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import express from 'express';
import { register } from './index.js';
import { createHost, ADMIN_EMAIL, LOGIN_PATH } from './src/services/standalone-host.js';

const require = createRequire(import.meta.url);
const { createShell, UI_DIR } = require('nooblyjs-core/src/shell');

const MOUNT_PATH = '/teammates';
const STATIC = { index: false, redirect: false };
const SHUTDOWN_GRACE_MS = 10000;
const port = Number(process.env.PORT ?? 11202);
const listenHost = process.env.HOST ?? '127.0.0.1';
const dataRoot = path.resolve(process.env.DATA_DIR ?? './data');
const dataDir = path.join(dataRoot, MOUNT_PATH.slice(1));
await fs.mkdir(dataDir, { recursive: true });

const stand = await createHost({ dataDir: dataRoot, publicBaseUrl: process.env.PUBLIC_BASE_URL ?? '' });
const { app, serverManager } = stand;
const log = serverManager.logger(serverManager.getDefaultProviderType('logging'), { instanceName: 'standalone' });
const shell = createShell({ express, auth: stand.pageAuth, can: stand.can, permissionsFor: stand.permissionsFor, log });

// The host's order: CSRF → shell and UI kit → sign-in and sign-out → the app → 404.
app.use(stand.csrf);
app.use(shell.router);
app.use('/ui', express.static(UI_DIR, STATIC));
app.get('/login', (req, res) => res.redirect(302, `${LOGIN_PATH}?returnUrl=${encodeURIComponent(MOUNT_PATH)}`));
app.post('/logout', express.urlencoded({ extended: false }), async (req, res) => {
  await stand.signOut(req, res);
  res.redirect(303, '/login');
});

const hosted = await register(app, serverManager, {
  mountPath: MOUNT_PATH,
  dataDir,
  host: stand.hostFor({ dataDir, frame: shell.frame, checksCsrf: true }),
});
shell.add(hosted, { name: hosted.name, mountPath: MOUNT_PATH });

app.get('/', (req, res) => res.redirect(302, MOUNT_PATH));
app.use((req, res) => {
  if (req.originalUrl.includes('/api/')) return res.status(404).json({ error: { code: 'not_found', message: 'No such API route.' } });
  res.status(404).type('text').send('Not found.');
});

const server = app.listen(port, listenHost, () => {
  const url = `http://${listenHost === '0.0.0.0' ? 'localhost' : listenHost}:${port}`;
  log.info(`Teammates running at ${url}${MOUNT_PATH} (data: ${dataRoot})`);
  announceSignIn(url).catch(() => {});
});

/** Says how to sign in, once core's authservice has created its admin account. */
async function announceSignIn(url) {
  const passwordFile = path.join(stand.authDir, 'INITIAL_ADMIN_PASSWORD.txt');
  const exists = (file) => fs.access(file).then(() => true, () => false);
  await new Promise((r) => setTimeout(r, 200)); // the password file is written just after the user
  const where = (await exists(passwordFile))
    ? `password in ${passwordFile} (generated on first start; delete the file once you have signed in and changed it)`
    : process.env.DEFAULT_ADMIN_PASSWORD ? 'password from DEFAULT_ADMIN_PASSWORD' : 'password as already set';
  log.info(`Sign in at ${url}/login as ${ADMIN_EMAIL} (${where}). Service dashboards: ${url}/services/`);
}

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info(`[server] ${signal}: shutting down`);
  const force = setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS + 5000);
  force.unref();
  server.close();
  server.closeIdleConnections?.();
  // close() waits for running tasks and queued webhooks (up to its grace period); then core stops.
  await hosted.close();
  await stand.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
