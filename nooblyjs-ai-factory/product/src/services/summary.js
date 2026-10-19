// What other apps ask of this engine (structure.md §6): artefactsFor(itemId) for Home and the item page, and
// summary(person) for the Product Factory status card. Both cope with an item or a budget that isn't there.
import { viewContext, agentCost, monthSpend, money, ideaView, specSummary } from './views.js';
import { readinessView } from './readiness.js';

// mountPath: where the section's pages are (/factory/product inside the Software Factory), for the links it hands out.
export function createSummaryService({ repos, people, host = null, budget, architecture, stageAgents = null, now = () => new Date(), mountPath = '/product' }) {
  const deps = { repos, people };

  /** The Product Factory artefacts of one item (a spec or an idea), or null. */
  async function artefactsFor(itemId, { person = null } = {}) {
    const ctx = await viewContext(deps, person);
    const spec = await repos.specs.get(itemId);
    if (spec) {
      return {
        itemId,
        ...specSummary(ctx, spec),
        // Its readiness actions name who would draft now: a hired teammate, not the name the spec was created with.
        readiness: readinessView(spec.readiness, stageAgents ? (await stageAgents.forStage('product')).teammate : spec.agent),
        agentCost: agentCost(ctx, itemId),
        // The quality attributes become Factory gates on every PR; open decisions and the standards check go with them.
        architecture: architecture ? await architecture.summaryFor(itemId) : null,
        link: `${mountPath}/specs/${itemId}`,
      };
    }
    const opp = await repos.ideas.get(itemId);
    return opp ? { itemId, ...ideaView(ctx, opp), link: `${mountPath}?item=${itemId}` } : null;
  }

  /** Agents on duty (with a draft running) and this month's spend against the budget (none: spend alone). */
  async function summary(person = null) {
    const ctx = await viewContext(deps, person);
    const month = now().toISOString().slice(0, 7);
    const working = new Map();
    for (const d of ctx.drafts) if (['queued', 'running'].includes(d.status) && d.teammate?.id) working.set(d.teammate.id, d.teammate.name ?? d.teammate.id);
    // Hosted in NooblyJS the month's spend is Platform's (its ledger counts every costed agent action), else the drafts'.
    const shared = await Promise.resolve(host?.service?.('platform')?.spendFor?.('product')).catch(() => null);
    const usedUsd = typeof shared === 'number' ? shared : monthSpend(ctx, month);
    // The platform's budget when it shares one, else the development budget.yaml (drafting.budget()).
    const { monthlyUsd: budgetUsd } = await budget();
    const used = money(usedUsd);
    return {
      agentsOnDuty: { count: working.size, names: [...working.values()], text: `${working.size} agent${working.size === 1 ? '' : 's'} on duty` },
      spend: { month, usedUsd, budgetUsd, text: budgetUsd ? `${used} of ${money(budgetUsd)}` : `${used} this month` },
    };
  }

  return { artefactsFor, summary };
}
