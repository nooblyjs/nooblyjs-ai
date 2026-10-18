// The rules people change at runtime, read from data/workflows/ on every use so an edit applies without a restart:
// approval-rules.yaml ("Who approves what", product.md §4) and readiness.yaml (the checks per stage).

const QUORUMS = new Set(['all', 'any']);

/** The approval rules by key. A rule that names an unknown quorum or no permission is left out (and logged). */
/**
 * Rules added to the seed after a data folder was made. A folder from before keeps working: a rule it doesn't
 * have is used from here, and one it has (edited or not) wins.
 */
export const BUILT_IN_RULES = [
  {
    key: 'infra-design', decision: 'Infrastructure design → Test or Staging', approver: 'Platform owner', permission: 'change-repo-access',
    quorum: 'any', target: { workingDays: 1 }, targetText: '1 working day', ifLate: 'Remind', remind: true,
    tag: 'Infra', label: 'Infrastructure design', transition: 'Approve & provision',
  },
  {
    // A write to Jira or Bitbucket whose kind an Owner set to "needs approval" (NooblyJS Phase 13).
    key: 'devtools-write', decision: 'Write to Jira or Bitbucket', approver: 'Approver', permission: 'approve',
    quorum: 'any', target: { workingDays: 1 }, targetText: '1 working day', ifLate: 'Remind', remind: true,
    tag: 'Write', label: 'Write to Jira or Bitbucket', transition: 'Approve & send',
  },
];

export async function loadRules(repos, log) {
  const doc = await repos.readYaml('approval-rules.yaml');
  const rules = new Map();
  for (const rule of doc?.rules ?? []) {
    const quorumOk = QUORUMS.has(rule?.quorum) || (Number.isInteger(rule?.quorum) && rule.quorum > 0);
    if (!rule?.key || !rule.permission || !quorumOk) {
      log?.warn?.(`approval-rules.yaml: rule ${JSON.stringify(rule?.key)} is missing its key, permission or quorum; ignored`);
      continue;
    }
    rules.set(rule.key, rule);
  }
  for (const rule of BUILT_IN_RULES) if (!rules.has(rule.key)) rules.set(rule.key, rule);
  return rules;
}

/** The readiness checks a stage requires: [{ key, passed, failed }]. Empty when the stage has none. */
export async function loadReadiness(repos, stage) {
  const doc = await repos.readYaml('readiness.yaml');
  return doc?.stages?.[stage] ?? [];
}

/** How many days an item may wait on a person before Lifecycle calls it "waiting too long". */
export async function loadThresholds(repos) {
  const doc = await repos.readYaml('readiness.yaml');
  return { waitingTooLongDays: Number(doc?.waitingTooLongDays) || 3 };
}
