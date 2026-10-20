// Loads the child apps listed in data/config/hosted-apps.yaml and calls each one's
// register(app, serverManager, options) (structure.md §2a). A failing app is logged and listed as unavailable;
// it never stops NooblyJS from starting.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { isEmptyDir } from './seed/index.js';
import { SUITE_APPS } from './built-in-apps.js';

const require = createRequire(import.meta.url);
const { FsStore } = require('nooblyjs-core/src/store/fs-store.js');

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOUNT = /^\/[a-z0-9][a-z0-9-]{0,62}$/;
// Paths NooblyJS keeps for itself.
const RESERVED = new Set(['/api', '/services', '/ui', '/login', '/logout', '/healthz', '/onboarding', '/platform', '/home', '/dev', '/internal', '/workflows']);

/**
 * Apps that are part of another now. An older hosted-apps.yaml may still list them: the entry is skipped, and the data
 * folder they had moves into the app that took them in, once (foldData). nooblyjs-ai-workflows became part of NooblyJS
 * itself (src/lifecycle/) on 2026-10-10; Product became a section of the Software Factory on 2026-10-19.
 */
export const FOLDED = {
  'nooblyjs-ai-workflows': { into: 'NooblyJS (src/lifecycle/)' },
  'nooblyjs-ai-product': { into: 'nooblyjs-ai-factory (its Product section, /factory/product)', from: ['product'], to: ['factory', 'product'] },
};

/**
 * Apps that were part of another for a while and are apps of their own again. Their data moves back out, once
 * (foldData), and an install that had them gets their entry in hosted-apps.yaml back. Infrastructure was a section of
 * the Software Factory from 2026-10-19 to 2026-10-20 (CHG-007): provisioning is not part of the factory.
 */
export const UNFOLDED = {
  'nooblyjs-ai-infrastructure': { was: 'a section of the Software Factory', from: ['factory', 'infrastructure'], to: ['infrastructure'], mountPath: '/infrastructure' },
};

const has = async (dir) => Boolean(await fs.stat(dir).catch(() => null));

/**
 * Moves one data folder. Only when the old folder exists and the new one is missing or empty: an install that has
 * both is left for a person to look at, and said so in the log. True when it moved.
 */
async function moveData(name, from, to, log) {
  if (!(await has(from))) return false;
  if (await has(to) && !(await isEmptyDir(to))) {
    log.warn(`${name}: both ${from} and ${to} exist; nothing was moved. Keep one and remove the other.`);
    return false;
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rm(to, { recursive: true, force: true }); // an empty folder only (checked above)
  await fs.rename(from, to);
  return true;
}

/**
 * Adds an app's entry to hosted-apps.yaml when it isn't listed, as a line at the end so the comments people wrote stay.
 * An install seeded while the app was part of another has no entry for it.
 */
async function listApp(dataDir, name, mountPath, log) {
  const file = path.join(dataDir, 'config', 'hosted-apps.yaml');
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return;
  const listed = yaml.load(text)?.apps;
  if (!Array.isArray(listed) || listed.some((a) => a?.package === name || a?.mountPath === mountPath)) return;
  await fs.writeFile(file, `${text.replace(/\n*$/, '\n')}  - { package: ${name}, mountPath: ${mountPath}, enabled: true }\n`);
  log.info(`hosted-apps.yaml: added ${name} at ${mountPath}`);
}

/**
 * Moves the data folder of each folded app to where the app that took it in keeps it (data/product →
 * data/factory/product), and of each unfolded app back to its own (data/factory/infrastructure → data/infrastructure),
 * before any app is loaded. Returns what moved.
 */
export async function foldData(dataDir, log) {
  const moved = [];
  for (const [name, fold] of Object.entries(FOLDED)) {
    if (!fold.from) continue;
    const from = path.join(dataDir, ...fold.from);
    const to = path.join(dataDir, ...fold.to);
    if (!(await moveData(name, from, to, log))) continue;
    log.info(`${name} is part of ${fold.into}: moved its data from ${from} to ${to}`);
    moved.push({ name, from, to });
  }
  for (const [name, unfold] of Object.entries(UNFOLDED)) {
    const from = path.join(dataDir, ...unfold.from);
    const to = path.join(dataDir, ...unfold.to);
    if (!(await moveData(name, from, to, log))) continue;
    log.info(`${name} was ${unfold.was} and is an app of its own again: moved its data from ${from} to ${to}`);
    await listApp(dataDir, name, unfold.mountPath, log);
    moved.push({ name, from, to });
  }
  return moved;
}

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
    // An app that is part of another now (FOLDED): an entry left in an older hosted-apps.yaml is not an app to load.
    if (FOLDED[raw?.package]) {
      log.info(`hosted-apps.yaml: ${raw.package} is part of ${FOLDED[raw.package].into} now; its entry is ignored and can be removed`);
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
      // An app may also be asked for by what it provides, not only by its name (structure.md §2a). The first app to
      // provide a name keeps it. As a list, each name is another name for its services: the wiki is 'knowledge' to
      // the Product Factory and Teammates. As an object, each name has services of its own: the Software Factory
      // provides 'product', its section.
      if (Array.isArray(hosted.provides)) {
        if (hosted.services) for (const alias of hosted.provides) if (typeof alias === 'string' && !services.has(alias)) services.set(alias, hosted.services);
      } else if (hosted.provides && typeof hosted.provides === 'object') {
        for (const [alias, provided] of Object.entries(hosted.provides)) if (provided && typeof provided === 'object' && !services.has(alias)) services.set(alias, provided);
      }
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
