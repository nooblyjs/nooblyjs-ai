// @ts-check
// Phase F07: a LINE is data: the stations a run goes through, in order.
//
//   lines/default.json    triage → build → verify → deliver
//   lines/quick.json      build → verify → deliver
//   <FACTORY_HOME>/lines/*.json   NooblyJS Phase 27: the operator's own lines (data/factory/lines/ when hosted). One
//                         there wins over a built-in line of the same name. Never a repository's own: a repository
//                         would then change its own gates (decided 2026-10-26).
//
// A run keeps the line it started with: the line as it was is saved in the run's request (`lineDef`), so editing a
// line file changes the runs that start after it, never one under way (lineForRequest).
//
//   { "id": "spec", "kind": "spec", "when": "triage.size != 'small'", "retries": 1, "optional": false }
//
//   id        unique name in this line (the step's name in the event log)
//   kind      which station code runs it (src/services/line/stations/<kind>.js)
//   when      a condition (conditions.js); false → the station is skipped
//   retries   how many times to try again after an error (not after a "no": see stop)
//   optional  its failure doesn't fail the run
//   gate      which human gate an approval station is (Phase F12: plan)
//   role      which role an agent station uses, when the kind allows several (review: reviewer | security-reviewer)
//
// Loading VALIDATES everything up front: unknown kinds, duplicate ids, bad
// conditions. A broken line fails when you load it, not halfway through a run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCondition } from '../services/line/conditions.js';
import { factoryHome } from '../utils/paths.js';

const BUILT_IN = fileURLToPath(new URL('../../lines/', import.meta.url));
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Where the operator's lines are: <FACTORY_HOME>/lines (data/factory/lines when hosted in NooblyJS). */
export const dataLines = (env = process.env) => path.join(factoryHome(env), 'lines');

/** Every line by name: the built-in ones, and the operator's (which win). */
export function lineNames(env = process.env) {
  const names = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')) : []);
  return [...new Set([...names(BUILT_IN), ...names(dataLines(env))])].sort();
}

/**
 * @typedef {{ id: string, kind: string, role?: string, gate?: string, when?: string, retries: number, optional: boolean, applies: (ctx: object) => boolean }} Station
 * @typedef {{ name: string, description?: string, stations: Station[] }} Line
 */

/**
 * @param {string} nameOrFile  'default', 'quick', or a path to a .json file
 * @param {string[]} kinds     the station kinds that exist
 * @returns {Line}
 */
export function loadLine(nameOrFile = 'default', kinds, env = process.env) {
  let file;
  if (nameOrFile.endsWith('.json')) file = path.resolve(nameOrFile);
  else {
    if (!NAME.test(nameOrFile)) throw new Error(`"${nameOrFile}" is not a line's name (lower case, digits and dashes).`);
    const own = path.join(dataLines(env), `${nameOrFile}.json`);
    file = fs.existsSync(own) ? own : path.join(BUILT_IN, `${nameOrFile}.json`);
  }
  if (!fs.existsSync(file)) {
    const builtIn = fs.readdirSync(BUILT_IN).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
    const own = lineNames(env).filter((n) => !builtIn.includes(n));
    throw new Error(`No line "${nameOrFile}". Built in: ${builtIn.join(', ')}${own.length ? `; your own: ${own.join(', ')}` : ''}.`);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  return { ...parseLine(raw, kinds, file), raw };
}

/**
 * The line a run follows: the one saved in its request when it was queued (NooblyJS Phase 27), else its line by name
 * (a run from before).
 * @param {{ line?: string, lineDef?: object }} [request]
 * @param {string[]} kinds
 * @returns {Line}
 */
export function lineForRequest(request, kinds) {
  if (request?.lineDef) return parseLine(request.lineDef, kinds, `the line "${request.line ?? request.lineDef.name}" this run started with`);
  return loadLine(request?.line ?? 'default', kinds);
}

/** @returns {Line} */
export function parseLine(raw, kinds, where = 'line') {
  const problems = [];
  if (typeof raw?.name !== 'string') problems.push('"name" is missing');
  if (!Array.isArray(raw?.stations) || !raw.stations.length) problems.push('"stations" must be a non-empty list');
  const seen = new Set();
  const stations = (raw?.stations ?? []).map((s, i) => {
    const label = `station ${i + 1}${s?.id ? ` ("${s.id}")` : ''}`;
    if (typeof s?.id !== 'string' || !s.id) problems.push(`${label}: "id" is missing`);
    else if (seen.has(s.id)) problems.push(`${label}: the id "${s.id}" is used twice`);
    seen.add(s?.id);
    if (!kinds.includes(s?.kind)) problems.push(`${label}: unknown kind "${s?.kind}" (known: ${kinds.join(', ')})`);
    let applies = () => true;
    if (s?.when !== undefined) {
      try {
        applies = compileCondition(String(s.when));
      } catch (error) {
        problems.push(`${label}: ${error instanceof Error ? error.message : error}`);
      }
    }
    return { id: s?.id, kind: s?.kind, role: s?.role, gate: s?.gate, when: s?.when, retries: Number(s?.retries ?? 0), optional: Boolean(s?.optional), applies };
  });
  if (problems.length) throw new Error(`${where} is not a valid line:\n  - ${problems.join('\n  - ')}`);
  return { name: raw.name, description: raw.description, stations };
}
