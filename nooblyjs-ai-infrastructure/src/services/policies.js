// Blueprints and policies as the Govern screens show them, and switching a policy on or off (an Owner's action,
// audited by the host like every write, and announced as an event so Activity shows it).
import { badRequest, notFound } from '../util/errors.js';
import { peopleOnly, needs } from '../util/http.js';

export function createPolicies({ repos, host }) {
  const view = (p) => ({
    id: p.id,
    label: p.label,
    severity: p.severity,
    severityText: p.severity === 'blocks' ? 'Blocks approval when it fails' : 'Warns, and lets the decision go ahead',
    enabled: p.enabled !== false,
    stateText: p.enabled !== false ? 'On' : 'Off',
  });

  return {
    list: async () => (await repos.config.policies()).map(view),

    async set(id, { enabled } = {}, person) {
      const action = 'change an infrastructure policy';
      await peopleOnly(host, person, action);
      await needs(host, person, 'change-guardrails', action);
      if (typeof enabled !== 'boolean') throw badRequest('enabled must be true or false.');
      const policies = await repos.config.policies();
      const policy = policies.find((p) => p.id === id);
      if (!policy) throw notFound(`No policy ${id}.`);
      policy.enabled = enabled;
      await repos.config.setPolicies(policies);
      await host.events.emit('policy.changed', { policyId: id, label: policy.label, enabled }, { actor: person.id });
      return view(policy);
    },

    /** Blueprints with the designs that use each one. */
    async blueprints() {
      const [blueprints, designs] = await Promise.all([repos.config.blueprints(), repos.designs.list()]);
      return blueprints.map((b) => ({
        name: b.name,
        version: b.version,
        summary: b.summary ?? '',
        approved: b.approved === true,
        stateText: b.approved === true ? 'Approved' : 'Not approved',
        usedBy: designs.filter((d) => (d.resources ?? []).some((r) => r.module?.blueprint === b.name && r.module?.version === b.version)).map((d) => d.id),
      }));
    },
  };
}
