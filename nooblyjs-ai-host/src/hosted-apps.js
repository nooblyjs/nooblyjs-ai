// Loads the child apps listed in data/config/hosted-apps.yaml and calls each one's
// register(app, serverManager, options) (structure.md §2a). A failing app is logged and listed as unavailable;
// it never stops NooblyJS from starting.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEmptyDir } from './seed/index.js';
import { SUITE_APPS } from './built-in-apps.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
// Paths NooblyJS keeps for itself. /product is allowed: nooblyjs-ai-product serves /product/api/v1 under it.
const RESERVED = new Set(['/api', '/services', '/ui', '/login', '/logout', '/healthz', '/onboarding', '/platform', '/home', '/dev', '/internal', '/workflows']);

/** Checks one entry of hosted-apps.yaml. Returns the entry with its display name, or throws. */
function checkEntry(entry, { production }) {
  if (!entry || typeof entry !== 'object') throw new Error('each app needs package (or path) and mountPath');
  const { mountPath } = entry;
  if (!MOUNT.test(mountPath ?? '')) throw new Error(`mountPath must look like /factory, not ${JSON.stringify(mountPath)}`);
  if (RESERVED.has(mountPath)) throw new Error(`${mountPath} is reserved for NooblyJS itself`);
  if (Boolean(entry.package) === Boolean(entry.path)) throw new Error(`${mountPath}: give either package or path`);
  if (entry.path && production) throw new Error(`${mountPath}: path: entries are for development only`);
  return { ...entry, name: entry.package ?? path.basename(entry.path) };
}

async function importApp(entry) {
  if (entry.package) return import(entry.package);
  const dir = path.resolve(REPO_ROOT, entry.path);
  if (dir !== REPO_ROOT && !dir.startsWith(REPO_ROOT + path.sep)) throw new Error(`${entry.path} is outside the nooblyjs-ai-host folder`);
  return import(pathToFileURL(path.join(dir, 'index.js')).href);
}

function checkHosted(hosted, entry) {
  if (!hosted || typeof hosted !== 'object') throw new Error('register() must return the HostedApp description');
  if (typeof hosted.name !== 'string' || !hosted.name) throw new Error('the HostedApp needs a name');
  if (hosted.mountPath !== entry.mountPath) throw new Error(`register() mounted at ${hosted.mountPath}, not ${entry.mountPath}`);
  if (typeof hosted.close !== 'function') throw new Error('the HostedApp needs a close() function');
}

/**
 * @param {object} o
 * @param {import('express').Express} o.app
 * @param {object} o.serverManager   the initialised nooblyjs-core registry
 * @param {object} o.config
 * @param {object} o.store           FsStore rooted at DATA_DIR
 * @param {object} o.shell           from createShell()
 * @param {(appDir: string) => object} o.hostFor   builds the `host` object for one app
 * @param {object} o.log
 */
export async function loadHostedApps({ app, serverManager, config, store, shell, hostFor, services, log, sampleData = true }) {
  const listed = (await store.readYaml(['config', 'hosted-apps.yaml']))?.apps ?? [];
  const loaded = [];
  const seen = new Set();

  for (const raw of listed) {
    // The lifecycle engine was the hosted app nooblyjs-ai-workflows until 2026-10-10. It is part of NooblyJS now (src/lifecycle/),
    // so an entry left in an older hosted-apps.yaml is not an app to load.
    if (raw?.package === 'nooblyjs-ai-workflows') {
      log.info('hosted-apps.yaml: nooblyjs-ai-workflows is part of NooblyJS now (src/lifecycle/); its entry is ignored and can be removed');
      continue;
    }
    let entry;
    try {
      entry = checkEntry(raw, config);
      if (seen.has(entry.mountPath)) throw new Error(`${entry.mountPath} is listed twice`);
      seen.add(entry.mountPath);
    } catch (err) {
      log.error(`hosted-apps.yaml: ${err.message}`);
      continue;
    }
    const meta = SUITE_APPS[entry.package] ?? { name: entry.name, label: entry.name };
    if (raw.enabled !== true) {
      shell.notInstalled(entry, meta);
      continue;
    }
    try {
      const mod = await importApp(entry);
      if (typeof mod.register !== 'function') throw new Error('its index.js does not export register()');
      const appDir = path.join(config.dataDir, entry.mountPath.slice(1));
      await fs.mkdir(appDir, { recursive: true });
      const firstStart = await isEmptyDir(appDir);
      const hosted = await mod.register(app, serverManager, { mountPath: entry.mountPath, dataDir: appDir, host: hostFor(appDir) });
      checkHosted(hosted, entry);
      if (hosted.services) services.set(hosted.name, hosted.services);
      // An app may also be asked for by what it provides, not only by its name: the wiki is 'knowledge' to the
      // Product Factory and Teammates (structure.md §2a). The first app to provide a name keeps it.
      if (hosted.services) for (const alias of Array.isArray(hosted.provides) ? hosted.provides : []) if (typeof alias === 'string' && !services.has(alias)) services.set(alias, hosted.services);
      // A blank data folder asks each app for its system files only (host.sampleData is false).
      if (typeof hosted.seed === 'function' && firstStart) await hosted.seed({ reset: false, content: sampleData });
      shell.add(hosted, entry);
      loaded.push(hosted);
      log.info(`mounted ${hosted.name} at ${entry.mountPath}`);
    } catch (err) {
      log.error(`could not mount ${entry.name} at ${entry.mountPath}: ${err.message}`);
      shell.unavailable(entry, meta);
    }
  }

  return {
    apps: loaded,
    /** Closes the apps in reverse order. One failing close doesn't stop the others. */
    async close() {
      for (const hosted of [...loaded].reverse()) {
        try {
          await hosted.close();
        } catch (err) {
          log.error(`closing ${hosted.name} failed: ${err.message}`);
        }
      }
    },
  };
}

/** The FsStore class, for building each app's store. */
export { FsStore };
