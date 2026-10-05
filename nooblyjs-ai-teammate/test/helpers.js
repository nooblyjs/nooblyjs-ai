// Starts the app on a random port with a fresh seeded workspace, signs in as the owner through nooblyjs-core's
// login and returns small fetch helpers that send the session cookie and CSRF header.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { createProviders } from '../src/providers/index.js';
import { MockProvider } from '../src/providers/mock.js';

export const OWNER_EMAIL = 'stevie@example.com';
export const OWNER_PASSWORD = 'Correct-Horse-Battery-9';
const quiet = { info() {}, warn() {}, error() {} };

// Core's authservice is shared by every app in a process (its login routes and Passport belong to the first one),
// so its users live in one folder per test process rather than in each app's throwaway workspace.
const AUTH_DIR = mkdtempSync(path.join(os.tmpdir(), 'tm-test-auth-'));
// Tests sign in many times from 127.0.0.1; core's per-IP limit (10 per 15 minutes) would stop them. The per-account
// lockout after repeated wrong passwords still applies.
process.env.LOGIN_RATE_LIMIT_MAX ??= '10000';
process.on('exit', () => rmSync(AUTH_DIR, { recursive: true, force: true }));

/** Adds a core user (if missing) with the given core role. */
export async function ensureCoreUser(coreAuth, { email, fullName, password, role }) {
  const existing = await coreAuth.getUser(email).catch(() => null);
  if (!existing) await coreAuth.createUser({ email, fullName, password, role });
}

/** Signs in on core's login API. Returns the session cookie and CSRF token, or the failed response's status. */
export async function coreSignIn(base, email, password) {
  const res = await fetch(`${base}/services/authservice/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) return { status: res.status };
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const body = await res.json();
  const session = await (await fetch(`${base}/api/session`, { headers: { Cookie: cookie } })).json();
  return { status: res.status, cookie, csrf: session.csrf, token: body.data.session.token, session };
}

export async function startApp({ login = true, ...options } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-test-'));
  const ctx = await createApp({
    dataDir,
    now: () => '2026-10-01',
    providers: createProviders({ mode: 'mock', mock: new MockProvider({ delayMs: 0 }) }),
    log: quiet,
    sessionSecret: 'test-secret',
    core: { authDir: AUTH_DIR },
    scheduleIntervalMs: 0, // tests drive the scheduler with tick()
    ...options,
  });
  const server = ctx.app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = { cookie: '', csrf: '' };

  const call = async (method, url, body, { headers = {}, auth = true } = {}) => {
    const h = { 'Content-Type': 'application/json', ...headers };
    if (auth && session.cookie) {
      h.Cookie = session.cookie;
      if (method !== 'GET') h['X-CSRF-Token'] = session.csrf;
    }
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  };

  await ensureCoreUser(ctx.core.auth, { email: OWNER_EMAIL, fullName: 'Stevie', password: OWNER_PASSWORD, role: 'owner' });
  const signIn = async (email = OWNER_EMAIL, password = OWNER_PASSWORD) => {
    const result = await coreSignIn(base, email, password);
    if (result.cookie) Object.assign(session, { cookie: result.cookie, csrf: result.csrf });
    return result;
  };
  if (login) await signIn();

  return {
    ...ctx,
    dataDir,
    base,
    session,
    call,
    signIn,
    get: (url, opts) => call('GET', url, undefined, opts),
    send: call,
    close: () => {
      ctx.close();
      server.closeAllConnections();
      server.close();
      // The workspace is a throwaway copy of the seed: don't leave it behind in the temp folder.
      return fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
