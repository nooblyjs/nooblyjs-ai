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
};

export function createPolicies({ repos, deployer }) {
  async function read() {
    const p = await repos.config.policies();
    return { ...DEFAULTS, ...p, rollout: { ...DEFAULTS.rollout, ...(p.rollout ?? {}) }, agent: { ...DEFAULTS.agent, ...(p.agent ?? {}) } };
  }
  async function view() {
    const p = await read();
    return {
      deployer: { name: deployer.name, real: deployer.real, text: deployer.real ? `Deploys through the ${deployer.name} deployer.` : 'The mock deployer: it applies a release through Infrastructure\'s records. Nothing is deployed anywhere real.' },
      rollout: { ...p.rollout, text: p.rollout.steps.map((s) => s.label).join(', then ') },
      riskThreshold: p.riskThreshold,
      riskText: `A release can't go to production with an open ${p.riskThreshold} or worse finding unless its risk is accepted (Security).`,
      approvers: 'Two different people with deploy-production (the lifecycle\'s deploy approval)',
      featureFlags: p.featureFlags,
      agent: p.agent,
    };
  }
  return { read, view };
}
