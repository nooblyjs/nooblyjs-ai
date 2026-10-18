// Test helpers: a temp DATA_DIR, the whole app on port 0, and a fetch client that keeps cookies.
// nooblyjs-core's registry is one per process, so each test file starts at most one app.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadConfig } from '../src/config.js';
import { createApp } from '../app.js';
import { seedFiles } from '../src/seed/index.js';
import { ANCHOR } from '../src/lifecycle/seed/index.js';

const require = createRequire(import.meta.url);
export const { FsStore, StoreError } = require('nooblyjs-core/src/store/fs-store.js');

export const tempDir = () => fs.mkdtemp(path.join(os.tmpdir(), 'noobly-test-'));

const WEEK = 7 * 86_400_000;
/**
 * The next moment at the seed story's weekday and time of day (its ANCHOR, Friday 10:00 UTC), now or later. The
 * story was written as of then: "three decided this week" and "26 h waiting" are both true only on that weekday,
 * so a test that ran on a Monday found this week's work in last week (BUG-001).
 */
export function storyTime(now = Date.now()) {
  const anchor = new Date(ANCHOR).getTime();
  return anchor + Math.max(0, Math.ceil((now - anchor) / WEEK)) * WEEK;
}

/**
 * Moves the dev clock in a data folder forward to storyTime() (data/dev/clock.yaml, read when NooblyJS starts), so the
 * app, its events and the seed all run on the story's weekday whatever day the tests run. Resolves with that time.
 */
export async function pinClock(store) {
  const at = storyTime();
  const movedTo = new Date(at).toISOString();
  await store.writeYaml(['dev', 'clock.yaml'], { offsetMs: at - Date.now(), movedTo, note: 'Tests run on the seed story\'s weekday (test/helpers.js pinClock).' });
  return movedTo;
}

export const testConfig = (dataDir, env = {}) => loadConfig({
  DATA_DIR: dataDir, NODE_ENV: 'test', NOOBLY_DEV_LOGIN: 'true', LOG_LEVEL: 'error', PORT: '0', ...env,
});

/**
 * Starts NooblyJS on port 0. `hostedApps` replaces data/config/hosted-apps.yaml (the seed is written first, so
 * the people still exist). It defaults to none, so a test only starts the hosted apps it is about.
 * Returns { base, noobly, dataDir, client(), stop() }.
 */
export async function startApp({ env = {}, hostedApps = [], devtoolsFetch, devtoolsGitRemote, teamsFetch, graphFetch } = {}) {
  const dataDir = await tempDir();
  const store = new FsStore(dataDir);
  await seedFiles(store, { now: await pinClock(store) });
  await store.writeYaml(['config', 'hosted-apps.yaml'], { apps: hostedApps });
  const noobly = await createApp({ config: testConfig(dataDir, env), devtoolsFetch, devtoolsGitRemote, teamsFetch, graphFetch });
  const server = noobly.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    noobly,
    dataDir,
    store,
    client: () => client(base),
    async stop() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
      await noobly.close();
      await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** A fetch client with a cookie jar. Redirects are not followed, so tests can see them. */
export function client(base) {
  const jar = new Map();
  async function request(pathname, { method = 'GET', headers = {}, json, form, csrf = true } = {}) {
    const h = { ...headers };
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) h.cookie = cookie;
    let body;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      h['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    if (csrf && method !== 'GET' && jar.has('noobly.csrf')) h['x-csrf-token'] = jar.get('noobly.csrf');
    const res = await fetch(base + pathname, { method, headers: h, body, redirect: 'manual' });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/expires=Thu, 01 Jan 1970/i.test(line) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  }
  return {
    jar,
    request,
    get: (p, o) => request(p, o),
    post: (p, o) => request(p, { ...o, method: 'POST' }),
    async json(p, o) {
      const res = await request(p, o);
      return { status: res.status, body: await res.json() };
    },
    /** Signs in through the dev person picker. */
    async signIn(personId) {
      await request('/login');
      const res = await request('/login', { method: 'POST', form: { personId, _csrf: jar.get('noobly.csrf') } });
      if (res.status !== 302) throw new Error(`sign-in as ${personId} failed: ${res.status} ${await res.text()}`);
      return res;
    },
  };
}

/** Today's records from a daily YAML stream (events or audit). */
/** The app's "now" (ms): the real time plus the dev clock's offset in data/dev/clock.yaml, as NooblyJS reads it. */
export async function clockNow(store) {
  return Date.now() + (Number((await store.readYaml(['dev', 'clock.yaml']))?.offsetMs) || 0);
}

/** The app's "today" as YYYY-MM-DD: the day file its events and audit records are written to. */
export const clockDay = async (store) => new Date(await clockNow(store)).toISOString().slice(0, 10);

export async function today(store, kind) {
  return store.readYamlStream([kind, ...dayParts(new Date(await clockNow(store)).toISOString())]);
}

const dayParts = (iso) => [iso.slice(0, 4), iso.slice(5, 7), `${iso.slice(0, 10)}.yaml`];

/**
 * Retries `check` until it passes or `ms` runs out. Audit records are written when the response finishes, so
 * they can land a moment after the client has its answer.
 */
export async function eventually(check, { ms = 2000, every = 25 } = {}) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      return await check();
    } catch (err) {
      if (Date.now() > until) throw err;
      await new Promise((resolve) => setTimeout(resolve, every));
    }
  }
}
