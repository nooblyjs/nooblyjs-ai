// @ts-check
// Phase F06: BUDGETS. Money, in layers.
//
//   run      ≤ its own limit (runBudgetUsd, or the run's --budget if lower)    enforced MID-RUN by the F01 watchdog
//   repo/day ≤ repos[slug].dailyBudgetUsd                                     enforced when STARTING a run
//   all/day  ≤ dailyBudgetUsd                                                 enforced when STARTING a run
//
// Starting a run RESERVES its whole run budget: what's spent today plus what
// running runs might still spend. Without reservations, ten runs could all
// start at $19 spent of $20 and together spend $39.
//
//   can start  ⇔  spent today + reserved by running runs + this run's budget ≤ daily cap
//
// And a run never gets more than what's left: its limit is min(run budget, remaining).
// "Today" is the UTC day of the injectable clock, so tests can move to tomorrow.
import { repoLimits } from '../config/factory-config.js';

/** Dollars spent today (UTC), by finished steps: everywhere, or for one repo slug. */
export function spentToday(store, now, slug) {
  const day = new Date(now).toISOString().slice(0, 10);
  const rows = store.db
    .prepare(`SELECT e.data AS data, r.data AS run FROM events e LEFT JOIN runs r ON r.id = json_extract(e.data, '$.runId')
              WHERE e.type = 'step.finished' AND substr(e.at, 1, 10) = ?`)
    .all(day);
  let sum = 0;
  for (const row of /** @type {any[]} */ (rows)) {
    if (slug && runSlug(JSON.parse(row.run ?? 'null')) !== slug) continue;
    sum += JSON.parse(row.data).result?.costUsd ?? 0;
  }
  return sum;
}

/** The budget one run gets: its own --budget if set and lower, else the operator's default. */
export function runBudget(run, config) {
  const own = run.request?.agent?.limits?.budgetUsd;
  return Math.min(own ?? Infinity, config.runBudgetUsd);
}

/**
 * May this run start now? And with how much money?
 * @param {object} run  a queued run
 * @param {{ running: object[], config: import('../config/factory-config.js').FactoryConfig, spentAll: number, spentBySlug: Record<string, number> }} state
 * @returns {{ ok: true, budgetUsd: number } | { ok: false, reason: string }}
 */
export function canStart(run, { running, config, spentAll, spentBySlug }) {
  const slug = runSlug(run);
  const want = runBudget(run, config);
  const reservedAll = running.reduce((sum, r) => sum + runBudget(r, config), 0);
  const leftAll = config.dailyBudgetUsd - spentAll - reservedAll;
  if (leftAll < want) return { ok: false, reason: `daily budget: $${spentAll.toFixed(2)} spent + $${reservedAll.toFixed(2)} reserved of $${config.dailyBudgetUsd}` };

  const repoCap = repoLimits(config, slug, run.request?.repo).dailyBudgetUsd;
  if (repoCap !== undefined) {
    const reservedRepo = running.filter((r) => runSlug(r) === slug).reduce((sum, r) => sum + runBudget(r, config), 0);
    const leftRepo = repoCap - (spentBySlug[slug] ?? 0) - reservedRepo;
    if (leftRepo < want) return { ok: false, reason: `repo daily budget (${slug}): $${(spentBySlug[slug] ?? 0).toFixed(2)} spent + $${reservedRepo.toFixed(2)} reserved of $${repoCap}` };
  }
  return { ok: true, budgetUsd: want };
}

export function runSlug(run) {
  return run?.slug ?? run?.itemId?.split('#')[0] ?? null;
}
