// The module at a glance (product.md §5): the sidebar's status card and badge, the agent card, and what other
// apps ask for (structure.md §6). Everything is counted from the files; with nothing on disk it says zero.
import { KIND_LABEL } from '../util/ids.js';

export function createSummary({ repos, cost, runs, drift, designs, environments, mountPath }) {
  /** Live environments, open drift, runs in progress, this month's spend, and what the agent is doing. */
  async function summary() {
    const [environments, openDrift, active, spend, agent] = await Promise.all([
      repos.environments.list(), drift.list(), runs.list({ status: 'active' }), cost.month(), repos.config.agent(),
    ]);
    const previews = environments.filter((env) => env.kind === 'preview').length;
    const n = openDrift.length;
    return {
      environments: { count: environments.length, previews, text: `${environments.length} · ${previews} of them preview${previews === 1 ? '' : 's'}` },
      drift: { count: n, text: n ? `${n} drift detected` : 'No drift' },
      runs: { active: active.length },
      spend,
      agent: agent && {
        ...agent,
        initials: agent.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
        working: active.length ? `Provisioning ${active[0].environment} · ${active[0].progress}%` : 'Nothing running right now',
      },
    };
  }

  /** The shape the NooblyJS frame draws under the sidebar's nav (noobly structure.md §2a). */
  async function status() {
    const s = await summary();
    return {
      badges: { runs: s.runs.active },
      card: {
        pill: { text: s.drift.text, tone: s.drift.count ? 'warning' : 'ok' },
        items: [{ label: 'Live environments', value: s.environments.text }],
        meter: {
          label: `${s.spend.monthName} cloud spend`,
          value: s.spend.text,
          ratio: s.spend.ratio,
          tone: s.spend.ratio >= 1 ? 'danger' : s.spend.ratio >= 0.8 ? 'warning' : 'ok',
        },
      },
    };
  }

  /** What other apps may call through host.service('infrastructure'). */
  const services = {
    summary,
    /** The design built for a lifecycle item (PRD-031 → INF-031), or null. */
    async designFor(itemId) {
      const design = (await repos.designs.list()).find((d) => d.itemId === itemId);
      return design ? designs.summary(design, null) : null;
    },
    /** The environments built from an item's design. */
    async environmentsFor(itemId) {
      const ids = new Set((await repos.designs.list()).filter((d) => d.itemId === itemId).map((d) => d.id));
      return (await repos.environments.list()).filter((env) => ids.has(env.designId))
        .map((env) => ({ name: env.name, kind: env.kind, kindLabel: KIND_LABEL[env.kind], status: env.status, href: `${mountPath}/environments/${env.name}` }));
    },
    /** The preview environment of a pull request, or null. */
    async previewFor(repo, pr) {
      const env = (await repos.environments.list()).find((e) => e.kind === 'preview' && e.repo === repo && e.pr === Number(pr));
      return env ? { name: env.name, status: env.status, href: `${mountPath}/environments/${env.name}` } : null;
    },
    /** Designs waiting for a decision (Home · Waiting on you). The host filters by who may decide. */
    async waitingFor() {
      return (await repos.designs.list()).filter((d) => d.status === 'waiting-approval')
        .map((d) => ({ type: 'infrastructure-design', id: d.id, title: d.title, itemId: d.itemId ?? null, href: `${mountPath}/designs/${d.id}` }));
    },
    /**
     * Every environment, for NooblyJS Platform · Environments (Infrastructure owns them; Platform lists and links).
     * Approvals and who may deploy come from the apply rules; agents and previews only ever get staging secrets.
     */
    async environments() {
      const [list, rules] = await Promise.all([environments.list(), repos.config.applyRules()]);
      const approvals = { automatic: 0, approval: 1, release: rules.release?.approvers ?? 2 };
      return {
        environments: list.map((env) => {
          const rule = rules.kinds?.[env.kind] ?? 'approval';
          return {
            id: env.name, name: env.name, kind: env.kindLabel, deployed: env.deployed, note: env.note?.text ?? '', status: env.statusText,
            approvals: approvals[rule] ?? 1, agentsMayDeploy: rule === 'automatic',
            secretsScope: env.kind === 'production' ? 'production' : 'staging', href: env.href,
          };
        }),
      };
    },
    /** Live preview environments, for the Preview environments pool on NooblyJS Platform · Containers. */
    async previews() {
      return (await repos.environments.list()).filter((env) => env.kind === 'preview')
        .map((env) => ({ name: env.name, repo: env.repo ?? null, pr: env.pr ?? null, status: env.status, href: `${mountPath}/environments/${env.name}` }));
    },
    /** This month's cloud spend in USD, for NooblyJS Platform's cloud budget (no budget lookup, so no loop). */
    cloudSpend: () => cost.spent(),
    /** Cloud spend this month, for NooblyJS Metrics. */
    metrics: async () => {
      const spend = await cost.month();
      return { month: spend.month, cloudSpendUsd: spend.spentUsd, budgetUsd: spend.budgetUsd, byKind: spend.byKind.map(({ kind, usd }) => ({ kind, usd })) };
    },
  };

  return { summary, status, services };
}
