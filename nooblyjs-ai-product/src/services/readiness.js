// Readiness results as people see them: "6 of 7", each check in words, and for every failing check exactly one
// agent action (product.md §1). Which checks a stage requires, and whether approval may be requested, is
// the lifecycle engine call; this engine stores the results and (from P2) supplies the facts behind them.

export const CHECKS = [
  { key: 'problem-evidence', passed: 'Problem backed by evidence', failed: 'Problem needs evidence', action: 'find evidence', draft: 'problem' },
  { key: 'goals-measurable', passed: 'Goals are measurable', failed: 'Goals need measures', action: 'draft measurable goals', draft: 'goals' },
  { key: 'criteria-testable', passed: 'Criteria are testable', failed: 'Criteria need to be testable', action: 'rewrite the criteria', draft: 'acceptance-criteria' },
  { key: 'dependencies-named', passed: 'Dependencies named', failed: 'Dependencies not named', action: 'list the dependencies', draft: 'dependencies' },
  { key: 'performance-targets', passed: 'Performance targets set', failed: 'Performance targets missing', action: 'propose targets', draft: 'performance-targets' },
  { key: 'privacy-reviewed', passed: 'Privacy reviewed', failed: 'Privacy not reviewed', action: 'draft a privacy review', draft: 'privacy-review' },
  { key: 'rollout-plan', passed: 'Rollout plan ready', failed: 'Rollout plan missing', action: 'draft rollout', draft: 'rollout-plan' },
];

const firstName = (agent) => String(agent?.name ?? 'the agent').split(' ')[0];

const PERFORMANCE = /\bp9\d\b|latency|load time|response time|throughput|\b\d+(\.\d+)?\s?(ms|s)\b/i;

/**
 * The facts behind each check, worked out from the spec's content where the text can say (D-P2-3). Checks the
 * text can't judge (dependencies named, privacy reviewed) keep what was recorded, and say so.
 * @param {object} parts   parseSpec(body)
 * @param {object} spec    the spec's front matter (knowledge, readiness)
 * @returns {Record<string, { value: boolean|null, source: 'content'|'recorded' }>}
 */
export function readinessFacts(parts, spec) {
  const recorded = (key) => ({ value: spec.readiness?.results?.[key] ?? null, source: 'recorded' });
  const content = (value) => ({ value, source: 'content' });
  const evidence = /\d/.test(parts.problem) || (spec.knowledge ?? []).some((k) => k.kind === 'customer-insight');
  const goals = parts.goals ?? [];
  const criteria = parts.acceptanceCriteria ?? [];
  return {
    'problem-evidence': content(Boolean(parts.problem.trim()) && evidence),
    'goals-measurable': content(goals.length > 0 && goals.every((g) => g.measure && g.today && g.target)),
    'criteria-testable': content(criteria.length > 0 && criteria.every((c) => c.given && c.when && c.then)),
    // A Dependencies section answers it from the content; without one, what was recorded stands.
    'dependencies-named': (parts.other ?? []).some((s) => /^dependencies$/i.test(s.heading) && s.text.trim()) ? content(true) : recorded('dependencies-named'),
    'performance-targets': content(goals.some((g) => PERFORMANCE.test(`${g.measure} ${g.target}`))),
    // A "Privacy review" section a person saved answers it. The agent's "Privacy review (draft)" does not: a person
    // reads it, edits it if needed, and saving it as "Privacy review" is their review.
    'privacy-reviewed': (parts.other ?? []).some((s) => /^privacy review$/i.test(s.heading) && s.text.trim()) ? content(true) : recorded('privacy-reviewed'),
    'rollout-plan': content(Boolean(parts.rolloutPlan?.trim())),
  };
}

/** The readiness to store after a save: the facts, as results. A recorded check never checked stays absent. */
export function readinessFromFacts(facts, checkedAt) {
  const results = {};
  for (const [key, fact] of Object.entries(facts)) if (fact.value !== null) results[key] = fact.value;
  return { checkedAt, results };
}

/**
 * @param {{ checkedAt?: string, results?: Record<string, boolean> } | null} readiness   as stored on the spec
 * @param {{ name: string } | null} agent   who the actions ask (the spec's drafting agent)
 * @returns {{ passed: number, total: number, text: string, checkedAt: string|null, checks: object[] } | null}
 *   null when the spec hasn't been checked yet (e.g. it is awaiting a brief).
 */
export function readinessView(readiness, agent) {
  if (!readiness?.results) return null;
  const checks = CHECKS.map((check) => {
    const result = readiness.results[check.key];
    if (result === true) return { key: check.key, passed: true, text: check.passed };
    if (result === false) {
      return { key: check.key, passed: false, text: check.failed, action: { label: `Ask ${firstName(agent)} to ${check.action}`, draft: check.draft } };
    }
    return { key: check.key, passed: null, text: `${check.passed}: not checked yet`, action: { label: `Ask ${firstName(agent)} to ${check.action}`, draft: check.draft } };
  });
  const passed = checks.filter((c) => c.passed === true).length;
  return { passed, total: checks.length, text: `${passed} of ${checks.length}`, checkedAt: readiness.checkedAt ?? null, checks };
}
