// @ts-check
// Phase F07: a LINE is data: the stations a run goes through, in order.
//
//   lines/default.json    triage → build → verify → deliver
//   lines/quick.json      build → verify → deliver
//   <repo>/.factory/lines/*.json   a repo's own lines (later phases)
//
//   { "id": "spec", "kind": "spec", "when": "triage.size != 'small'", "retries": 1, "optional": false }
//
//   id        unique name in this line (the step's name in the event log)
//   kind      which station code runs it (src/line/stations/<kind>.js)
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
import { compileCondition } from './conditions.js';

const BUILT_IN = fileURLToPath(new URL('../../lines/', import.meta.url));

/**
 * @typedef {{ id: string, kind: string, role?: string, gate?: string, when?: string, retries: number, optional: boolean, applies: (ctx: object) => boolean }} Station
 * @typedef {{ name: string, description?: string, stations: Station[] }} Line
 */

/**
 * @param {string} nameOrFile  'default', 'quick', or a path to a .json file
 * @param {string[]} kinds     the station kinds that exist
 * @returns {Line}
 */
export function loadLine(nameOrFile = 'default', kinds) {
  const file = nameOrFile.endsWith('.json') ? path.resolve(nameOrFile) : path.join(BUILT_IN, `${nameOrFile}.json`);
  if (!fs.existsSync(file)) throw new Error(`No line "${nameOrFile}". Built in: ${fs.readdirSync(BUILT_IN).map((f) => f.replace(/\.json$/, '')).join(', ')}.`);
  return parseLine(JSON.parse(fs.readFileSync(file, 'utf8')), kinds, file);
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
