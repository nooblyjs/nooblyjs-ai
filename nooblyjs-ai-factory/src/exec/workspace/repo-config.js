// @ts-check
// Phase F02: `.factory/config.json`, the target repo's instructions to the factory.
//
//   {
//     "network": ["registry.npmjs.org"],            // what the agent's sandbox may reach ("none" by default)
//     "setup": {
//       "command": "npm ci",                        // run once per workspace… unless cached
//       "cacheKey": ["package-lock.json"],          // …the cache is reused while these files don't change
//       "cachePaths": ["node_modules"]              // …and these folders are what gets cached
//     }
//     "gates": {                                     // Phase F04: checks the factory runs after the agent,
//       "lint": "npm run lint",                     //   IN THIS ORDER, stopping at the first failure
//       "test": { "command": "npm test", "timeoutMs": 300000 },
//       "e2e":  { "command": "npm run e2e", "fast": false }   // fast: false → not run by the Stop hook
//     },
//     "timeoutMs": 600000,                          // default time limit per gate
//     "scope": "strict",                            // Phase F14: "warn" records scope violations without failing
//     "review": {                                   // Phase F11
//       "sensitive": ["src/auth/**", "*.sql"],       //   changes here also get the SECURITY reviewer…
//       "dependencies": true                        //   …and so do dependency changes (package.json, lockfiles)
//     }
//   }
//
// It is read from the PINNED base commit, through the mirror, never from the
// operator's working copy. Later phases add gates (F04), autonomy (F12)…
import { readFileAt } from './mirror.js';

export const CONFIG_FILE = '.factory/config.json';
export const DEFAULT_GATE_TIMEOUT_MS = 10 * 60_000;

/**
 * @typedef {Object} RepoConfig
 * @property {'none' | 'allow' | string[]} network
 * @property {{ command: string, cacheKey: string[], cachePaths: string[] } | null} setup
 * @property {Gate[]} gates
 * @property {{ sensitive: string[], dependencies: boolean }} review   Phase F11
 * @property {'strict' | 'warn'} scope   Phase F14
 * @property {string[]} warnings
 */

/**
 * @typedef {Object} Gate
 * @property {string} name
 * @property {string} command
 * @property {boolean} fast       also run by the agent's Stop hook (default true)
 * @property {number} timeoutMs
 */

/** @returns {Promise<RepoConfig>} */
export async function loadRepoConfig(mirrorDir, sha) {
  const text = await readFileAt(mirrorDir, sha, CONFIG_FILE);
  return parseRepoConfig(text);
}

/** @param {string | null} text  @returns {RepoConfig} */
export function parseRepoConfig(text) {
  const warnings = [];
  if (text === null) return { network: 'none', setup: null, gates: [], review: { sensitive: [], dependencies: true }, scope: 'strict', warnings };
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }

  let network = raw.network ?? 'none';
  if (!(network === 'none' || network === 'allow' || (Array.isArray(network) && network.every((d) => typeof d === 'string')))) {
    warnings.push(`${CONFIG_FILE}: "network" must be "none", "allow" or a list of domains. Using "none".`);
    network = 'none';
  }

  let setup = null;
  if (raw.setup !== undefined) {
    const s = typeof raw.setup === 'string' ? { command: raw.setup } : raw.setup;
    if (typeof s?.command !== 'string' || !s.command.trim()) warnings.push(`${CONFIG_FILE}: "setup.command" must be a command. Ignoring setup.`);
    else setup = { command: s.command, cacheKey: strings(s.cacheKey), cachePaths: strings(s.cachePaths).filter(safeRelative) };
  }

  const defaultTimeout = positive(raw.timeoutMs) ?? DEFAULT_GATE_TIMEOUT_MS;
  /** @type {Gate[]} */
  const gates = [];
  if (raw.gates !== undefined && (typeof raw.gates !== 'object' || raw.gates === null || Array.isArray(raw.gates))) {
    warnings.push(`${CONFIG_FILE}: "gates" must be an object of name → command. Ignoring it.`);
  } else {
    // Object keys keep their written order (for non-numeric keys), and the order is the order gates run in.
    for (const [name, value] of Object.entries(raw.gates ?? {})) {
      const g = typeof value === 'string' ? { command: value } : value;
      if (typeof g?.command !== 'string' || !g.command.trim()) {
        warnings.push(`${CONFIG_FILE}: gate "${name}" has no command. Skipping it.`);
        continue;
      }
      gates.push({ name, command: g.command, fast: g.fast !== false, timeoutMs: positive(g.timeoutMs) ?? defaultTimeout });
    }
  }

  const review = { sensitive: strings(raw.review?.sensitive), dependencies: raw.review?.dependencies !== false };

  const scope = raw.scope === 'warn' ? 'warn' : 'strict';
  if (raw.scope !== undefined && !['warn', 'strict'].includes(raw.scope)) warnings.push(`${CONFIG_FILE}: "scope" must be "strict" or "warn". Using "strict".`);

  for (const key of Object.keys(raw)) if (!['network', 'setup', 'gates', 'timeoutMs', 'review', 'scope'].includes(key)) warnings.push(`${CONFIG_FILE}: "${key}" isn't used yet. Ignoring it.`);
  return { network, setup, gates, review, scope, warnings };
}

const positive = (value) => (typeof value === 'number' && value > 0 ? value : undefined);
const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : []);
// A cached folder must stay inside the workspace: no "../", no absolute paths.
const safeRelative = (p) => !p.startsWith('/') && !p.split(/[\\/]/).includes('..');
