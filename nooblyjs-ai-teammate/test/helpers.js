// Mounts the app on the stand-in NooblyJS host (test/fixtures/host.js) with a fresh seeded workspace, signs in as the
// owner through nooblyjs-core's login and returns small fetch helpers that send the session cookie and CSRF header.
//
// The nooblyjs-core serverManager is a process-wide singleton bound to one Express app, so each test process has one
// host, listening on a random port. Every startApp() mounts another Teammates app on it: the first at /teammates,
// then /teammates-2, … each with its own workspace and core service instances. `app.base` is the host
// (http://127.0.0.1:port, where /services lives); `app.url` is the app's own root (`app.base` + `app.mountPath`), and
// the call helpers take paths inside the app ('/api/v1/teammates').
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHost } from './fixtures/host.js';
import { register } from '../index.js';
import { createProviders } from '../src/services/providers/index.js';
import { MockProvider } from '../src/services/providers/mock.js';

export const OWNER_EMAIL = 'stevie@example.com';
export const OWNER_PASSWORD = 'Correct-Horse-Battery-9';
const quiet = { info() {}, warn() {}, error() {} };

// Tests sign in many times from 127.0.0.1; core's per-IP limit (10 per 15 minutes) would stop them. The per-account
// lockout after repeated wrong passwords still applies.
process.env.LOGIN_RATE_LIMIT_MAX ??= '10000';

let hostReady = null;
let mounted = 0;
let open = 0;

/** The process's test host: core's people, sessions and logs live in one temp folder, removed at exit. */
export function testHost() {
  hostReady ??= (async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tm-test-host-'));
    process.on('exit', () => rmSync(dataDir, { recursive: true, force: true }));
    const h = await createHost({ dataDir, consoleMode: 'none', sessionSecret: 'test-secret', cookieSecure: false, trustProxy: '' });
    const server = h.app.listen(0);
    return { ...h, dataDir, server, base: `http://127.0.0.1:${server.address().port}` };
  })();
  return hostReady;
}

/** Stops the host's core services (worker threads and timers), so the test process can exit. */
export async function closeHost() {
  if (!hostReady) return;
  const h = await hostReady;
  if (h.server.listening) {
    h.server.closeAllConnections();
    h.server.close();
  }
  await h.close();
}

/** Adds a core user (if missing) with the given core role. */
export async function ensureCoreUser(coreAuth, { email, fullName, password, role }) {
  const existing = await coreAuth.getUser(email).catch(() => null);
  if (!existing) await coreAuth.createUser({ email, fullName, password, role });
}

/** Signs in on core's login API. Returns the session cookie and CSRF token, or the failed response's status. */
export async function coreSignIn(app, email, password) {
  const res = await fetch(`${app.base}/services/authservice/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) return { status: res.status };
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const body = await res.json();
  const session = await (await fetch(`${app.url}/api/v1/session`, { headers: { Cookie: cookie } })).json();
  return { status: res.status, cookie, csrf: session.csrf, token: body.data.session.token, session };
}

export async function startApp({ login = true, ...options } = {}) {
  const h = await testHost();
  mounted += 1;
  const mountPath = mounted === 1 ? '/teammates' : `/teammates-${mounted}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-test-'));
  const { internals: ctx } = await register(h.app, h.serverManager, {
    host: h.hostFor({ dataDir }),
    mountPath,
    dataDir,
    now: () => '2026-10-01',
    providers: createProviders({ mode: 'mock', mock: new MockProvider({ delayMs: 0 }) }),
    log: quiet,
    sessionSecret: 'test-secret',
    core: { instanceName: `teammates-${mounted}` },
    scheduleIntervalMs: 0, // tests drive the scheduler with tick()
    ...options,
  });
  open += 1;
  const app = { base: h.base, url: h.base + mountPath };
  const session = { cookie: '', csrf: '' };

  const call = async (method, url, body, { headers = {}, auth = true } = {}) => {
    const hdrs = { 'Content-Type': 'application/json', ...headers };
    if (auth && session.cookie) {
      hdrs.Cookie = session.cookie;
      if (method !== 'GET') hdrs['X-CSRF-Token'] = session.csrf;
    }
    const res = await fetch(app.url + url, { method, headers: hdrs, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  };

  await ensureCoreUser(h.authservice, { email: OWNER_EMAIL, fullName: 'Stevie', password: OWNER_PASSWORD, role: 'owner' });
  const signIn = async (email = OWNER_EMAIL, password = OWNER_PASSWORD) => {
    const result = await coreSignIn(app, email, password);
    if (result.cookie) Object.assign(session, { cookie: result.cookie, csrf: result.csrf });
    return result;
  };
  if (login) await signIn();

  return {
    ...ctx,
    ...app,
    host: h,
    coreAuth: h.authservice,
    dataDir,
    session,
    call,
    signIn,
    get: (url, opts) => call('GET', url, undefined, opts),
    send: call,
    close: async () => {
      ctx.close();
      // The workspace is a throwaway copy of the seed: don't leave it behind in the temp folder.
      await fs.rm(dataDir, { recursive: true, force: true });
      // The last app out stops the host's server, so the test process can exit.
      open -= 1;
      if (open === 0 && h.server.listening) {
        h.server.closeAllConnections();
        h.server.close();
      }
    },
  };
}
