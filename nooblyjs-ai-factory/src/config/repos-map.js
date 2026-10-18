// @ts-check
// NooblyJS Phase 7: WHICH FOLDER IS WHICH REPO. When NooblyJS hands work over, each work item
// names a repository by its short name ("slots-api"). This file is the operator's answer to
// "where is that repository on this machine?":
//
//   <FACTORY_HOME>/repos.yaml
//     # work item repo name: folder (relative to this file's folder, or absolute) or a clone URL
//     calc: repos/calc
//
// A work item whose repo isn't listed starts nothing: the factory never guesses a
// repository. One flat mapping, so it is read without a YAML library (Node built-ins only).
import fs from 'node:fs';
import path from 'node:path';
import { factoryHome } from '../utils/paths.js';

const NAME = /^[a-z0-9][a-z0-9._-]{0,62}$/i;

/**
 * @param {string} text
 * @returns {Record<string, string>}  repo name → what the file says (unresolved)
 */
export function parseReposMap(text) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf(':');
    const name = at > 0 ? line.slice(0, at).trim() : '';
    const where = at > 0 ? line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2') : '';
    if (!NAME.test(name) || !where) throw new Error(`repos.yaml line ${i + 1}: expected "name: folder", got "${raw.trim()}"`);
    map[name] = where;
  }
  return map;
}

/**
 * The repositories this factory may work on, by name. Folders are resolved against the
 * factory's home; URLs (https://…, git@…) are left as they are.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Record<string, string>}
 */
export function loadReposMap(env = process.env) {
  const home = factoryHome(env);
  let text;
  try {
    text = fs.readFileSync(path.join(home, 'repos.yaml'), 'utf8');
  } catch {
    return {};
  }
  const map = parseReposMap(text);
  for (const [name, where] of Object.entries(map)) {
    if (!/^[a-z][a-z0-9+.-]*:\/\/|^git@/i.test(where)) map[name] = path.resolve(home, where);
  }
  return map;
}
