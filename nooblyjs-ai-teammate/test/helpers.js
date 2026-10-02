// Starts the app on a random port with a fresh seeded workspace, signs in as the owner and
// returns small fetch helpers that send the session cookie and CSRF header.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { createProviders } from '../src/providers/index.js';
import { MockProvider } from '../src/providers/mock.js';

export const OWNER_PASSWORD = 'correct horse battery';
const quiet = { info() {}, warn() {}, error() {} };

export async function startApp({ login = true, ...options } = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-test-'));
  const ctx = await createApp({
    dataDir,
    now: () => '2026-10-01',
    providers: createProviders({ mode: 'mock', mock: new MockProvider({ delayMs: 0 }) }),
    log: quiet,
    ownerPassword: OWNER_PASSWORD,
    sessionSecret: 'test-secret',
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

  const signIn = async (password = OWNER_PASSWORD) => {
    const res = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (res.ok) {
      session.cookie = res.headers.get('set-cookie').split(';')[0];
      session.csrf = (await res.json()).csrf;
    }
    return res;
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
      ctx.scheduler.stop();
      server.closeAllConnections();
      server.close();
      // The workspace is a throwaway copy of the seed: don't leave it behind in the temp folder.
      return fs.rm(dataDir, { recursive: true, force: true });
    },
  };
}
