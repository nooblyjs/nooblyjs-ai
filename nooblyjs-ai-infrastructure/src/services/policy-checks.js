// Policy checks (product.md §1): run on every design version and before every apply. A policy that `blocks`
// refuses the approval when it fails; one that `warns` is shown in words and lets the decision go ahead.
import { KIND_LABEL } from '../util/ids.js';

/** Each check answers true (passes) or a sentence saying what is wrong. */
const CHECKS = {
  'in-region': ({ design }) => {
    const out = design.resources.filter((r) => r.region && r.region !== 'in-region');
    return out.length === 0 || `${out.map((r) => r.name).join(', ')} would keep data outside the region`;
  },
  encrypted: ({ design }) => {
    const out = design.resources.filter((r) => r.layer === 'data' && r.encrypted === false);
    return out.length === 0 || `${out.map((r) => r.name).join(', ')} is not encrypted`;
  },
  'approved-blueprints': ({ design, blueprints }) => {
    const approved = new Set(blueprints.filter((b) => b.approved).map((b) => `${b.name}/v${b.version}`));
    const out = design.resources.filter((r) => r.module && !approved.has(`${r.module.blueprint}/v${r.module.version}`));
    return out.length === 0 || `Not an approved blueprint: ${out.map((r) => `${r.module.blueprint} v${r.module.version}`).join(', ')}`;
  },
  'fits-budget': ({ policy, estimatePerDay, spentUsd, budgetUsd }) => {
    if (!budgetUsd) return true;
    return spentUsd + estimatePerDay * 30 <= budgetUsd || (policy.failLabel ?? 'Over the budget');
  },
  'default-tier': ({ design, kind, policy }) => {
    const limit = policy.cacheGb?.[kind];
    const over = design.resources.some((r) => r.cacheGb !== undefined && limit !== undefined && r.cacheGb > limit);
    return !over || `Cache tier above ${KIND_LABEL[kind]} default`;
  },
};

/**
 * @returns {Array<{ id, label, severity, result: 'passed'|'warning'|'failed'|'off', text }>}
 *   `text` is what to show: the policy's name when it passes, what is wrong when it doesn't.
 */
export function checkPolicies({ design, kind, policies, blueprints, estimatePerDay, spentUsd, budgetUsd }) {
  return policies.map((policy) => {
    const base = { id: policy.id, label: policy.label, severity: policy.severity };
    if (!policy.enabled) return { ...base, result: 'off', text: `${policy.label} (switched off)` };
    const check = CHECKS[policy.id];
    // A policy nobody has written a check for must not pass silently.
    if (!check) return { ...base, result: policy.severity === 'blocks' ? 'failed' : 'warning', text: `${policy.label}: no check exists for this policy` };
    const answer = check({ design, kind, policy, blueprints, estimatePerDay, spentUsd, budgetUsd });
    if (answer === true) return { ...base, result: 'passed', text: policy.label };
    return { ...base, result: policy.severity === 'blocks' ? 'failed' : 'warning', text: answer };
  });
}

export const blocking = (checks) => checks.filter((c) => c.result === 'failed');
