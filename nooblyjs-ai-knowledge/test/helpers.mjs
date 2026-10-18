// Runs the hosted app the way NooblyJS does, on a bare Express 5 app with the stand-in host, on port 0 and a temp data
// folder. These tests cover the hosted-app contract, so the platform's API modules are left out (platform: false):
// they need a real nooblyjs-core registry, which test/platform.test.mjs starts. A fallback after the app answers
// anything the app passes on, so tests can see it called next().
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express5';
import { register } from '../index.mjs';
import { createHost, createTestServerManager, PERSON_HEADER } from './fixtures/host.mjs';

export const FALLBACK = 'host fallback';

/**
 * @param {object} [o]
 * @param {string} [o.mountPath]
 * @param {(host: object) => object} [o.changeHost]   alter the host before register() (to test refusals)
 * @param {object} [o.serverManager]
 */
export async function startApp({ mountPath = '/wiki', changeHost = (h) => h, serverManager = createTestServerManager() } = {}) {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nooblyjs-ai-knowledge-'));
  const dataDir = path.join(rootDir, mountPath.slice(1));
  await fs.mkdir(dataDir, { recursive: true });
  const stand = createHost({ rootDir });
  const app = express();
  app.use(express.json());

  let hosted = null;
  let registerError = null;
  try {
    hosted = await register(app, serverManager, { mountPath, dataDir, platform: false, host: changeHost(stand.hostFor(dataDir)) });
  } catch (err) {
    registerError = err;
  }
  app.use((req, res) => res.status(404).type('text').send(FALLBACK));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** fetch as a person (by id), or signed out with `as: null`. */
  const get = async (url, { as = null } = {}) => {
    const res = await fetch(base + url, { headers: as ? { [PERSON_HEADER]: as } : {}, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { /* not JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };

  return {
    app, base, hosted, registerError, serverManager, stand, rootDir, dataDir, get,
    async close() {
      await hosted?.close();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

/** Every file under a folder, as paths relative to it. */
export async function filesUnder(dir) {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}
