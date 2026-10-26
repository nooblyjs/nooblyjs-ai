// @ts-check
// NooblyJS Phase 27: WHICH LINE A RUN TAKES. When NooblyJS hands work over, each work item's run follows a line
// (src/models/line.js). This file is the operator's answer, by repository and by the kind of item:
//
//   <FACTORY_HOME>/lines.yaml   (data/factory/lines.yaml when hosted)
//     default: default            the line when nothing below names one
//     repositories:               a repository's line (by its short name, as in repos.yaml)
//       web-storefront: quick
//     itemTypes:                  the line for an item of this type (story, defect, finding…)
//       defect: quick
//
// A repository's line wins over its item type's. No file: every run takes `default`. A line named here that doesn't
// exist (or doesn't read) refuses the work item when it is taken in, saying so: nothing starts on a line nobody wrote.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { factoryHome } from '../utils/paths.js';

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ default: string, repositories: Record<string, string>, itemTypes: Record<string, string> }}
 */
export function loadLineChoice(env = process.env) {
  const file = path.join(factoryHome(env), 'lines.yaml');
  let doc = null;
  try {
    doc = yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.CORE_SCHEMA });
  } catch (error) {
    if (/** @type {any} */ (error)?.code !== 'ENOENT') throw new Error(`lines.yaml doesn't read: ${error instanceof Error ? error.message : error}`);
  }
  const map = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)])) : {});
  return { default: typeof doc?.default === 'string' ? doc.default : 'default', repositories: map(doc?.repositories), itemTypes: map(doc?.itemTypes) };
}

/** The line for a work item on `repo` (its short name) of an item of `itemType`. */
export function lineFor(choice, { repo, itemType = null }) {
  return choice.repositories[repo] ?? (itemType ? choice.itemTypes[itemType] : undefined) ?? choice.default;
}
