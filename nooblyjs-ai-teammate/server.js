import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from './src/app.js';
import { shutdownCore, ADMIN_EMAIL } from './src/core/index.js';

const port = Number(process.env.PORT ?? 11202);
const host = process.env.HOST ?? '127.0.0.1';
const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const SHUTDOWN_GRACE_MS = 10000;

const { app, log, core, invocation, close } = await createApp({ dataDir });
const server = app.listen(port, host, () => {
  const url = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  log.info(`Teammates running at ${url} (data: ${dataDir})`);
  announceSignIn(url).catch(() => {});
});

/** Says how to sign in (with nooblyjs-core's authservice), once it has created its admin account. */
async function announceSignIn(url) {
  const exists = (file) => fs.access(file).then(() => true, () => false);
  const hasAdmin = () => fs.readFile(path.join(core.authDir, 'users.json'), 'utf8').then((t) => t.includes(ADMIN_EMAIL), () => false);
  for (let i = 0; i < 50 && !(await hasAdmin()); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 100)); // the password file is written just after the user
  const where = (await exists(core.adminPasswordFile))
    ? `password in ${core.adminPasswordFile} (generated on first start; delete the file once you have signed in and changed it)`
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
  close(); // no new scheduled runs or webhook retries
  server.close();
  server.closeIdleConnections?.();
  // Give running tasks and queued webhooks a moment to finish, then stop core (log files, workers, timers).
  await Promise.race([invocation.idle(), new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref())]);
  await shutdownCore();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
