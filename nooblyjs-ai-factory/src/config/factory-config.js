// @ts-check
// Phase F06: the OPERATOR's settings: ~/.factory/config.json.
//
// Not to be confused with a target repo's .factory/config.json (gates, setup:
// what the REPO says about itself). This file is what YOU say about the
// factory: how much it may do at once, and how much it may spend.
//
//   {
//     "maxConcurrent": 3,                  runs at the same time, across all repos
//     "dailyBudgetUsd": 20,                total spend per day (UTC); the scheduler stops starting runs past it
//     "runBudgetUsd": 2,                   default limit for one run (a run's own --budget wins if lower)
//     "leaseTtlMs": 60000,                 a worker that hasn't renewed its lease for this long has lost the run
//     "heartbeatMs": 15000,                how often workers renew (and check for stop/cancel)
//     "maxAttempts": 3,                    automatic requeues after a lost lease
//     "models": { "fast": "claude-haiku-4-5", "balanced": "claude-sonnet-5-5", "strong": "claude-opus-5-5" },
//                                          Phase F09: the model for each role TIER (roles say fast/balanced/strong)
//     "roles": { "builder": { "tier": "strong", "maxTurns": 80 } },   Phase F09: your overrides for a role
//     "repos": {
//       "my-app": { "maxConcurrent": 1, "dailyBudgetUsd": 5 }     by repo slug or folder name
//     }
//   }
import fs from 'node:fs';
import path from 'node:path';
import { factoryHome } from '../util/paths.js';

export const DEFAULTS = Object.freeze({
  maxConcurrent: 3,
  dailyBudgetUsd: 20,
  runBudgetUsd: 2,
  leaseTtlMs: 60_000,
  heartbeatMs: 15_000,
  tickMs: 1_000,
  maxAttempts: 3,
  taskConcurrency: 3, // Phase F10: a spec's tasks built at the same time, per run
  repairAttempts: 2, // Phase F13: fixer attempts per run before a person is asked
  repos: {},
  // Phase F09: tiers → models. Cheap and fast for triage, strong for specs, balanced for building.
  models: { fast: 'claude-haiku-4-5', balanced: 'claude-sonnet-5-5', strong: 'claude-opus-5-5' },
  roles: {},
});

/** @typedef {typeof DEFAULTS & { repos: Record<string, { maxConcurrent?: number, dailyBudgetUsd?: number }> }} FactoryConfig */

/** @returns {FactoryConfig} */
export function loadFactoryConfig(env = process.env) {
  const file = path.join(factoryHome(env), 'config.json');
  if (!fs.existsSync(file)) return { ...DEFAULTS };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  return { ...DEFAULTS, ...raw, repos: { ...(raw.repos ?? {}) }, models: { ...DEFAULTS.models, ...(raw.models ?? {}) }, roles: { ...(raw.roles ?? {}) } };
}

/**
 * The settings for one repo. Matched by its slug, or by the last part of its folder
 * name (so "calc" matches /tmp/work/calc).
 */
export function repoLimits(config, slug, repoPath = '') {
  const name = path.basename(repoPath);
  return config.repos?.[slug] ?? config.repos?.[name] ?? {};
}
