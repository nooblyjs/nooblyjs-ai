// @ts-check
// Phase F17: `factory dashboard [--port 11203]`. The dashboard on its own
// (`factory serve --dashboard` runs it next to the scheduler instead).
//
// It prints a URL with the token in its fragment: open that. Anyone with the token can
// press "Stop all", so it's kept in ~/.factory/dashboard-token (0600) and the server
// only listens on 127.0.0.1. `--no-auth` drops the token, for local testing only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { apiRoutes } from '../server/api.js';
import { createHttpServer } from '../server/http.js';
import { openStore } from '../store/events.js';
import { factoryHome } from '../util/paths.js';

export const DASHBOARD_DIR = fileURLToPath(new URL('../server/dashboard/', import.meta.url));

/** The dashboard's token, made once. */
export function dashboardToken(env = process.env) {
  if (env.FACTORY_DASHBOARD_TOKEN) return env.FACTORY_DASHBOARD_TOKEN;
  const file = path.join(factoryHome(env), 'dashboard-token');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const token = crypto.randomBytes(24).toString('base64url');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

/**
 * Start the dashboard on a store. Returns the server and its URL.
 * @param {{ store: import('../store/events.js').Store, port?: number, env?: NodeJS.ProcessEnv, extra?: any[], noAuth?: boolean }} options
 *   noAuth: anyone who can reach 127.0.0.1:port is the operator. For testing only.
 */
export async function startDashboard({ store, port = 11203, env = process.env, extra = [], noAuth = false }) {
  const token = noAuth ? '' : dashboardToken(env);
  const routes = apiRoutes({ store, env, extra });
  const server = noAuth
    ? createHttpServer({ routes, authorize: () => ({ role: 'operator' }), staticDir: DASHBOARD_DIR })
    : createHttpServer({ routes, token, staticDir: DASHBOARD_DIR });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { server, token, url: noAuth ? `http://127.0.0.1:${address.port}/` : `http://127.0.0.1:${address.port}/#token=${token}` };
}

/** @param {string[]} argv */
export async function dashboardCommand(argv) {
  const { values } = parseArgs({ args: argv, options: { port: { type: 'string' }, 'no-auth': { type: 'boolean' } } });
  const store = openStore();
  const noAuth = values['no-auth'] ?? false;
  const { url } = await startDashboard({ store, port: Number(values.port ?? 11203), noAuth });
  if (noAuth) console.log(`Dashboard: ${url}\n(NO TOKEN: anything on this machine can use it, including "Stop all". Testing only. Ctrl+C to stop)`);
  else console.log(`Dashboard: ${url}\n(only on this machine; the token is in the link. Ctrl+C to stop)`);
  await new Promise((resolve) => process.once('SIGINT', resolve));
  store.close();
  return 0;
}
