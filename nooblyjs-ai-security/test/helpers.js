// Runs the app the way NooblyJS does, on a bare Express 5 app with the stand-in host, on port 0 and a temp data
// folder. A fallback after the app answers anything the app passes on, so tests can see it called next().
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { register } from '../index.js';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.js';

export const FALLBACK = 'host fallback';

export async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'nooblyjs-ai-security-'));
}

/**
 * @param {object} [o]
 * @param {string} [o.mountPath]
 * @param {Record<string, object>} [o.services]   partner apps' services
 * @param {(host: object) => object} [o.changeHost]   alter the host before register() (to test refusals)
 * @param {object} [o.serverManager]
 * @param {boolean} [o.seed]   write the seed story (PRD-031's findings) first
 * @param {object[]} [o.people]   replace the stand-in host's people
 * @param {(dataDir: string) => Promise<void>} [o.before]   writes files before register() runs (restart tests)
 * @param {{ now: () => number }} [o.clock]   the business clock
 */
export async function startApp({ mountPath = '/security', services, changeHost = (h) => h, serverManager = createTestServerManager(), seed = false, people, before, clock } = {}) {
  const rootDir = await tempDir();
  const dataDir = path.join(rootDir, mountPath.slice(1));
  await fs.mkdir(dataDir, { recursive: true });
  if (before) await before(dataDir);
  const stand = createHost({ rootDir, services, ...(people ? { people } : {}), ...(clock ? { clock } : {}) });
  const app = express();
  app.use(express.json());

  let hosted = null;
  let registerError = null;
  try {
    hosted = await register(app, serverManager, { mountPath, dataDir, host: changeHost(stand.hostFor(dataDir)), sweepEveryMs: 0 });
  } catch (err) {
    registerError = err;
  }
  if (seed && hosted) await hosted.seed({ reset: true });
  app.use((req, res) => res.status(404).type('text').send(FALLBACK));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** fetch as a person (by id), or signed out with `as: null`. JSON bodies are sent as JSON. */
  const call = async (method, url, { as = null, body, headers = {} } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(as ? { [PERSON_HEADER]: as } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { /* not JSON */ }
    return { status: res.status, json, text, etag: res.headers.get('etag') };
  };

  return {
    app,
    base,
    rootDir,
    dataDir,
    hosted,
    registerError,
    serverManager,
    auditLog: stand.auditLog,
    eventLog: stand.eventLog,
    stand,
    /** Emits an event as another app would (e.g. the lifecycle engine approval.decided). */
    emit: (type, payload, actor) => stand.events.emit(type, payload, { actor }),
    get: (url, o) => call('GET', url, o),
    post: (url, o) => call('POST', url, o),
    put: (url, o) => call('PUT', url, o),
    async close() {
      await hosted?.close();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

/** Every file under `dir`, as paths relative to it with forward slashes. */
export async function filesUnder(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).replaceAll(path.sep, '/'))
    .sort();
}
