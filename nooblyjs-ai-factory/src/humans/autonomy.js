// @ts-check
// Phase F12: AUTONOMY. How much may the factory do before a human says yes?
//
//   level           plan gate (after spec)       PR gate                          typical use
//   L0 suggest      STOP: the spec is the output —                                exploring a new repo
//   L1 supervised   a human approves the spec    a human merges                   features (the default)
//   L2 gated        automatic                    a human merges                   bugs, chores in trusted repos
//   L3 autopilot    automatic                    automatic, if green, no blocking  docs, dependency bumps
//                                                findings and no protected paths
//
// Trust is the OPERATOR's to give, so the level comes from:
//   ~/.factory/config.json   "autonomy": "L1",  "repos": { "calc": { "autonomy": "L2" } }
//   the command line          factory run … --autonomy L2   (the operator, again)
// and an issue may only LOWER it (a label "autonomy:L0"): a repo, or someone filing an
// issue, must not be able to give the factory more freedom than the operator did.
import { repoLimits } from '../config/factory-config.js';

export const LEVELS = ['L0', 'L1', 'L2', 'L3'];

/** What each level means at each gate: 'human' | 'auto' | 'stop'. */
export const GATES = {
  plan: { L0: 'stop', L1: 'human', L2: 'auto', L3: 'auto' },
  merge: { L0: 'human', L1: 'human', L2: 'human', L3: 'auto' },
};

/**
 * The run's level: the operator's (config, then --autonomy), lowered (never raised) by the issue's labels.
 * @param {{ config: any, slug: string, repo?: string, requested?: string, labels?: string[] }} input
 * @returns {{ level: string, why: string }}
 */
export function autonomyFor({ config, slug, repo, requested, labels = [] }) {
  const valid = (l) => LEVELS.includes(String(l));
  let level = valid(requested) ? String(requested) : valid(repoLimits(config, slug, repo).autonomy) ? String(repoLimits(config, slug, repo).autonomy) : valid(config.autonomy) ? String(config.autonomy) : 'L1';
  let why = valid(requested) ? '--autonomy' : valid(repoLimits(config, slug, repo).autonomy) ? `config: repos.${slug}` : valid(config.autonomy) ? 'config' : 'default';
  for (const label of labels) {
    const asked = String(label).match(/^autonomy:(L[0-3])$/)?.[1];
    if (asked && LEVELS.indexOf(asked) < LEVELS.indexOf(level)) {
      level = asked;
      why = `issue label ${label} (labels can only lower it)`;
    }
  }
  return { level, why };
}

/** @returns {'human' | 'auto' | 'stop'} */
export function gateMode(gate, level) {
  return /** @type {any} */ (GATES[gate]?.[level] ?? 'human');
}
