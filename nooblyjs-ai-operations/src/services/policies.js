// Operations' policies (policies.yaml, root product.md §3.7 and §9). Every value is a Phase 22 default [CONFIRM]; a
// missing one falls back here.
const DEFAULTS = {
  // The rollout every release follows unless its plan says otherwise: a pilot, then everyone.
  rollout: { strategy: 'pilot', steps: [{ percent: 10, label: '10% pilot' }, { percent: 100, label: 'Everyone' }] },
  // The open findings a release can't carry without an accepted risk: at or above this severity.
  riskThreshold: 'high',
  // The release agent, who drafts release notes (Digital Teammates), and who drafts when it can't.
  agent: { teammates: ['pip-okafor'] },
  featureFlags: { tool: '[PLACEHOLDER]' },
  // Phase 23: the outcome review is due this many days after an item's first release is in production; the SRE agent.
  outcomeReviewDays: 30,
  sre: { teammates: ['pip-okafor'] },
  monitoring: { platform: '[PLACEHOLDER]' },
};

export function createPolicies({ repos, deployer, monitor = null }) {
  async function read() {
    const p = await repos.config.policies();
    return { ...DEFAULTS, ...p, rollout: { ...DEFAULTS.rollout, ...(p.rollout ?? {}) }, agent: { ...DEFAULTS.agent, ...(p.agent ?? {}) } };
  }
  async function view() {
    const p = await read();
    return {
      ...(monitor ? { monitor: { name: monitor.name, real: monitor.real, text: monitor.real ? `SLOs are read from ${monitor.name}.` : 'The mock monitor: SLO budgets burn only when a person burns them, and goal measures are sample values. Nothing is watched.' } } : {}),
      deployer: { name: deployer.name, real: deployer.real, text: deployer.real ? `Deploys through the ${deployer.name} deployer.` : 'The mock deployer: it applies a release through Infrastructure\'s records. Nothing is deployed anywhere real.' },
      rollout: { ...p.rollout, text: p.rollout.steps.map((s) => s.label).join(', then ') },
      riskThreshold: p.riskThreshold,
      riskText: `A release can't go to production with an open ${p.riskThreshold} or worse finding unless its risk is accepted (Security).`,
      approvers: 'Two different people with deploy-production (the lifecycle\'s deploy approval)',
      featureFlags: p.featureFlags,
      agent: p.agent,
      outcomeReviewDays: p.outcomeReviewDays,
      outcomeText: `An item's outcome review is due ${p.outcomeReviewDays} days after its first release is in production.`,
      monitoring: p.monitoring,
    };
  }
  return { read, view };
}
