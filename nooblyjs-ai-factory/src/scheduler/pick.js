// @ts-check
// Phase F06: WHICH queued runs start now? A pure function: state in, decision out.
//
// Keeping the decision free of I/O means every scheduling rule is a one-line
// table test: "3 slots, these queued runs, those running → start these".
//
// Order:
//   1. priority, high first
//   2. FAIRNESS: the repo with the fewest runs going right now first. Ten runs
//      queued for repo A must not starve the one for repo B.
//   3. oldest first (queuedAt), so equal runs go in the order they came
//
// Limits (skip, don't stop: the next run may fit):
//   global maxConcurrent · per-repo maxConcurrent · the budget (budgets.js)
import { repoLimits } from '../config/factory-config.js';
import { canStart, runSlug } from './budgets.js';

/**
 * @param {{ queued: any[], running: any[], config: import('../config/factory-config.js').FactoryConfig,
 *           spentAll: number, spentBySlug: Record<string, number>, stopped: boolean, campaignToday?: Record<string, number> }} state
 *   campaignToday (Phase F25): campaign runs already STARTED today, per repo slug
 * @returns {{ start: { runId: string, budgetUsd: number }[], waiting: { runId: string, reason: string }[] }}
 */
export function pickRuns({ queued, running, config, spentAll, spentBySlug, stopped, campaignToday = {} }) {
  if (stopped) return { start: [], waiting: queued.map((r) => ({ runId: r.id, reason: 'stopped (factory resume-all)' })) };

  const going = [...running]; // grows as we decide to start runs, so each decision sees the ones before it
  const perRepo = (slug) => going.filter((r) => runSlug(r) === slug).length;
  const better = (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || perRepo(runSlug(a)) - perRepo(runSlug(b)) || String(a.queuedAt).localeCompare(String(b.queuedAt)) || a.id.localeCompare(b.id);

  const start = [];
  const waiting = [];
  const campaignNow = { ...campaignToday }; // grows as campaign runs start this tick
  const remaining = [...queued];
  while (remaining.length) {
    // Sort AGAIN each time: starting a run changes how busy its repo is, and so who's next.
    // (Sorting once up front gave every slot to the repo that queued first.)
    remaining.sort(better);
    const run = /** @type {any} */ (remaining.shift());
    if (going.length >= config.maxConcurrent) {
      waiting.push({ runId: run.id, reason: `all ${config.maxConcurrent} slots busy` });
      continue;
    }
    const slug = runSlug(run);
    const repoMax = repoLimits(config, slug, run.request?.repo).maxConcurrent;
    if (repoMax !== undefined && perRepo(slug) >= repoMax) {
      waiting.push({ runId: run.id, reason: `repo ${slug}: ${repoMax} at a time` });
      continue;
    }
    // Phase F25: a campaign opens at most N PRs per repo per day, so it can't flood a repo's reviewers.
    const perDay = config.campaigns?.maxPrsPerRepoPerDay;
    if (run.request?.campaign && perDay !== undefined && (campaignNow[slug] ?? 0) >= perDay) {
      waiting.push({ runId: run.id, reason: `campaign limit: ${perDay} per repo per day (${slug}); tomorrow` });
      continue;
    }
    const money = canStart(run, { running: going, config, spentAll, spentBySlug });
    if (!money.ok) {
      waiting.push({ runId: run.id, reason: money.reason });
      continue;
    }
    start.push({ runId: run.id, budgetUsd: money.budgetUsd });
    if (run.request?.campaign) campaignNow[slug] = (campaignNow[slug] ?? 0) + 1;
    going.push(run);
  }
  return { start, waiting };
}
