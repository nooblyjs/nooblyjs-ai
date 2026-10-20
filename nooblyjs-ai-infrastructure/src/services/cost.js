// Cloud cost (product.md §3.5): what the environments have cost this month, by kind, against the monthly budget.
// This is cloud spend only; what the agent's model calls cost is on the teammate's timesheet (stack.md §4).
import { KINDS, KIND_LABEL } from '../util/ids.js';
import { money, monthName } from './views.js';

const PLURAL = { preview: 'Previews' };

export function createCost({ repos, host = null, now }) {
  const thisMonth = () => new Date(now()).toISOString().slice(0, 7);

  /**
   * This month's cloud spend only, from the ledger. It never asks Platform for the budget, because Platform asks
   * this for its cloud budget's spend (asking back would go round in a loop).
   */
  async function spent(month = thisMonth()) {
    return (await repos.cost.list()).filter((e) => String(e.at).slice(0, 7) === month).reduce((sum, e) => sum + Number(e.usd ?? 0), 0);
  }

  /** Spend in a month (YYYY-MM): the total, and per kind, largest first. */
  async function month(month = thisMonth()) {
    const [ledger, local, environments, shared] = await Promise.all([
      repos.cost.list(), repos.config.budget(), repos.environments.list(),
      // Hosted in NooblyJS, the cloud budget is Platform's (Settings · Budgets); standalone, budget.yaml's.
      Promise.resolve(host?.service?.('platform')?.budgetFor?.('cloud')).catch(() => null),
    ]);
    const budget = typeof shared === 'number' ? { monthlyUsd: shared } : local;
    const totals = new Map();
    for (const entry of ledger) {
      if (String(entry.at).slice(0, 7) !== month) continue;
      totals.set(entry.kind, (totals.get(entry.kind) ?? 0) + Number(entry.usd ?? 0));
    }
    const spentUsd = [...totals.values()].reduce((a, b) => a + b, 0);
    const largest = Math.max(0, ...totals.values());
    const budgetUsd = Number(budget.monthlyUsd ?? 0);
    return {
      month,
      monthName: monthName(month),
      spentUsd,
      budgetUsd,
      text: budgetUsd ? `${money(spentUsd)} of ${money(budgetUsd)}` : `${money(spentUsd)} this month`,
      ratio: budgetUsd ? spentUsd / budgetUsd : 0,
      byKind: KINDS.filter((kind) => totals.has(kind))
        .map((kind) => ({ kind, label: PLURAL[kind] ?? KIND_LABEL[kind], usd: totals.get(kind), text: money(totals.get(kind)), ratio: largest ? totals.get(kind) / largest : 0 }))
        .sort((a, b) => b.usd - a.usd),
      byEnvironment: environments
        .filter((env) => env.costPerDay !== undefined && env.costPerDay !== null)
        .map((env) => ({ name: env.name, kind: env.kind, kindLabel: KIND_LABEL[env.kind], costPerDay: env.costPerDay, text: money(env.costPerDay) }))
        .sort((a, b) => b.costPerDay - a.costPerDay),
    };
  }

  return { month, spent };
}
