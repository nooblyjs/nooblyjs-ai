// The rules people change at runtime, read from data/workflows/ on every use so an edit applies without a restart:
// approval-rules.yaml ("Who approves what", product.md §4) and readiness.yaml (the checks per stage). Since Phase 27
// workflow.js reads them with lifecycle.yaml, checks them and keeps the last good; this file has their built-ins.

const QUORUMS = new Set(['all', 'any']);

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
  // A stage move with no named decision (Discover → Product, an idea taken up as a spec): a person with the approve
  // permission, and it is on record like any approval. Not in the Who approves what table. The seed's approval-rules.yaml
  // lost it when it was rebuilt (BUG-006), so a data folder made since has it from here.
  {
    key: 'stage', decision: 'Move to the next stage', approver: 'Approver', permission: 'approve',
    quorum: 'any', target: { workingDays: 1 }, targetText: '1 working day', ifLate: 'Remind', remind: false,
    tag: 'Stage', label: 'Stage move', transition: 'Approve & move', listed: false,
  },
  // Lifecycle v3 (Phase 16b): the handoffs between Design, Engineer, Build and Test, for a data folder from before. The
  // seed's approval-rules.yaml lists them too, so they can be edited there.
  {
    key: 'design-handoff', decision: 'Design → Engineering (Design handoff)', approver: 'Solution Architect', permission: 'accept-decisions',
    quorum: 'any', target: { workingDays: 1 }, targetText: '1 working day', ifLate: 'Remind, then escalate', remind: true,
    escalate: { afterWorkingDays: 1, to: 'Owner' }, needsReadiness: true,
    tag: 'Design', label: 'Design handoff', transition: 'Approve & hand off to Engineering', toLabel: 'Engineer',
  },
  {
    key: 'engineering-signoff', decision: 'Engineering → Build (Engineering sign-off)', approver: 'Application Architect and a test lead',
    permission: 'accept-decisions', slots: [{ permission: 'accept-decisions', role: 'Application Architect' }, { permission: 'sign-off-tests', role: 'Test lead' }],
    quorum: 'all', target: { workingDays: 1 }, targetText: '1 working day', ifLate: 'Remind, then escalate', remind: true,
    escalate: { afterWorkingDays: 1, to: 'Owner' }, needsReadiness: true,
    tag: 'Engineering', label: 'Engineering sign-off', transition: 'Sign off & send to Build', toLabel: 'Build',
  },
  {
    key: 'build-approval', decision: 'Build → Test (Build approval)', approver: 'Engineer (code owner of the repo)', permission: 'merge',
    quorum: 'any', target: { hours: 4 }, targetText: '4 hours', ifLate: 'Remind', remind: true,
    tag: 'PR', label: 'Build approval', transition: 'Give the Build approval', toLabel: 'Test',
  },
  {
    key: 'test-approval', decision: 'Test → Release (Test approval; then the PR may merge)', approver: 'Tester', permission: 'sign-off-tests',
    quorum: 'any', target: { hours: 4 }, targetText: '4 hours', ifLate: 'Remind', remind: true, needsReadiness: true,
    tag: 'Test', label: 'Test approval', transition: 'Give the Test approval', toLabel: 'Release',
  },
  // Phase 17: accepting an idea leaves Discover, a person's, once its business case is complete.
  {
    key: 'idea', decision: 'Discover → Product (idea accepted)', approver: 'Business owner', permission: 'approve',
    quorum: 'any', target: { workingDays: 3 }, targetText: '3 working days', ifLate: 'Remind', remind: true, needsReadiness: true,
    tag: 'Idea', label: 'Idea accepted', transition: 'Accept the idea', toLabel: 'Product',
  },
  // Retired with the stages they left (Phase 16b): kept so their history still reads, never opened again and not in
  // the Who approves what table. Open ones were withdrawn when the stages moved (engine.migrateStages).
  {
    key: 'release-candidate', decision: 'Verify → Release (release candidate)', approver: 'QA lead', permission: 'accept-release-candidate',
    verb: 'accept', quorum: 'any', target: { hours: 4 }, targetText: '4 hours', ifLate: 'Remind', remind: true, needsReadiness: true,
    tag: 'Release', label: 'Release candidate', transition: 'Accept & send to Release', toLabel: 'Release', retired: true,
  },
  {
    key: 'outcome-review', decision: 'Operate → done (outcome review)', approver: 'Product lead', permission: 'approve',
    quorum: 'any', target: { workingDays: 5 }, targetText: '5 working days', ifLate: 'Remind', remind: true,
    tag: 'Outcome', label: 'Outcome review', transition: 'Close with the outcome', toLabel: 'Done',
  },
  // App approvals the Security app will carry out (root roadmap Phase 19). Until it runs, deciding one is refused.
  {
    key: 'threat-model', decision: 'Threat model accepted', approver: 'Architect', permission: 'accept-threat-model',
    verb: 'accept', quorum: 'any', target: { workingDays: 1 }, targetText: '1 working day', ifLate: 'Remind, then escalate',
    remind: true, escalate: { afterWorkingDays: 1, to: 'Owner' }, tag: 'Threat', label: 'Threat model', transition: 'Accept the threat model',
  },
  {
    key: 'risk-acceptance', decision: 'Risk acceptance', approver: 'Risk owner', permission: 'accept-risk',
    verb: 'accept', quorum: 'any', target: { workingDays: 1 }, targetText: '1 working day', ifLate: 'Hold the release', remind: true,
    tag: 'Risk', label: 'Risk acceptance', transition: 'Accept the risk',
  },
];

/** Rules of stages that are gone (Phase 16b): an older approval-rules.yaml may still list them. */
export const RETIRED = new Set(['ui-handoff', 'merge', 'release-candidate']);

/** The spec rule's words before lifecycle v3: a data folder whose rule still has them gets the new ones. */
const OLD_SPEC_WORDS = 'Spec → Architecture';
const SPEC_WORDS = { decision: 'Product → Design (spec, UX and UI)', tag: 'Product', label: 'Product handoff', transition: 'Approve & hand off to Design', toLabel: 'Design' };

/**
 * The approval rules from approval-rules.yaml's parsed `doc`, checked (Phase 27): { rules, errors, warnings }. `rules` is
 * a Map by key, the built-in rules filling in what the file doesn't mention; a rule listed with `enabled: false` is left
 * out, built-in or not, and kept in `disabled`. `known` ({ permissions, roles }) names what exists, when the host can say.
 * Any error means the file is refused (workflow.js keeps the last good rules).
 */
export function parseRules(doc, known = null) {
  const errors = [];
  const warnings = [];
  const rules = new Map();
  const disabled = new Set();
  const listed = doc?.rules ?? [];
  if (doc !== null && doc !== undefined && (typeof doc !== 'object' || Array.isArray(doc))) errors.push({ where: 'the file', message: 'it should have a "rules" list' });
  else if (!Array.isArray(listed)) errors.push({ where: 'rules', message: 'it should be a list of rules' });
  const permissionOk = (p) => !known?.permissions || known.permissions.includes(p);
  const TARGET_KEYS = ['workingDays', 'hours', 'sameDay'];
  for (const [i, found] of (Array.isArray(listed) ? listed : []).entries()) {
    const where = `rule ${found?.key ?? `number ${i + 1}`}`;
    if (!found || typeof found !== 'object') { errors.push({ where, message: 'a rule needs a key, a permission and a quorum' }); continue; }
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(String(found.key ?? ''))) { errors.push({ where, message: 'it needs a key in lower case with dashes' }); continue; }
    if (rules.has(found.key) || disabled.has(found.key)) { errors.push({ where, message: 'the key is listed twice' }); continue; }
    if (found.enabled === false && found.key === 'stage') { errors.push({ where, message: 'the plain stage approval can\'t be switched off: a stage with no rule of its own is left with it' }); continue; }
    if (found.enabled === false) { disabled.add(found.key); continue; }
    if (found.enabled !== undefined && found.enabled !== true) errors.push({ where, message: '"enabled" is true or false' });
    const quorumOk = QUORUMS.has(found.quorum) || (Number.isInteger(found.quorum) && found.quorum > 0);
    if (!found.permission) errors.push({ where, message: 'it needs a permission: whom the approval waits on' });
    else if (!permissionOk(found.permission)) errors.push({ where, message: `there is no permission "${found.permission}" in access/roles.yaml` });
    if (!quorumOk) errors.push({ where, message: `quorum is all, any or a number, not ${JSON.stringify(found.quorum)}` });
    for (const slot of found.slots ?? []) {
      if (!slot?.permission) errors.push({ where, message: 'each slot needs a permission' });
      else if (!permissionOk(slot.permission)) errors.push({ where, message: `a slot names the permission "${slot.permission}", which access/roles.yaml doesn't have` });
    }
    if (found.target !== undefined && (typeof found.target !== 'object' || !TARGET_KEYS.some((k) => found.target?.[k]))) {
      errors.push({ where, message: 'target is { workingDays: n }, { hours: n } or { sameDay: true }' });
    }
    if (found.escalate?.to && known?.roles && !known.roles.includes(found.escalate.to)) errors.push({ where, message: `it escalates to "${found.escalate.to}", which is not an access role` });
    let rule = found;
    // An unedited spec rule from before lifecycle v3 takes the new words; one a person edited is left as it is.
    if (rule.key === 'spec' && rule.decision === OLD_SPEC_WORDS) rule = { ...rule, ...SPEC_WORDS };
    if (RETIRED.has(rule.key)) rule = { ...rule, retired: true };
    rules.set(rule.key, rule);
  }
  for (const rule of BUILT_IN_RULES) if (!rules.has(rule.key) && !disabled.has(rule.key)) rules.set(rule.key, rule);
  return { rules, disabled, errors, warnings };
}

/** The approval rules, as the seed works out due times with them. The file's mistakes are logged; the rest is used. */
export async function loadRules(repos, log) {
  const { rules, errors } = parseRules(await repos.readYaml('approval-rules.yaml'));
  for (const e of errors) log?.warn?.(`approval-rules.yaml: ${e.where}: ${e.message}`);
  return rules;
}

// Where a stage's checks were kept before lifecycle v3 (by the kind of the stage): used when readiness.yaml has nothing
// under the new key.
export const READINESS_BEFORE = { product: 'specify', design: 'architect', test: 'verify' };

/**
 * Checks added after a data folder was made (Phase 16c: Design's, before each story's Design handoff; Phase 16d:
 * Engineering's, before its sign-off). The file wins where it lists the stage.
 */
export const BUILT_IN_READINESS = {
  // Phase 17: before an idea is accepted. The Product section works it out from the idea's business case.
  discover: [
    { key: 'business-case-complete', passed: 'Business case complete', failed: 'Business case not complete' },
  ],
  design: [
    { key: 'requirements-covered', passed: 'Every business requirement is covered by a story', failed: 'A business requirement has no story' },
    { key: 'decisions-decided', passed: 'No decision is still proposed', failed: 'A decision is still proposed' },
    { key: 'interfaces-complete', passed: 'Every interface has both sides named', failed: 'An interface has a side missing' },
  ],
  // Phase 16d: before each story's Engineering sign-off, worked out by the Software Factory.
  engineer: [
    { key: 'architecture-accepted', passed: 'The application architecture is accepted and current', failed: 'The application architecture is not accepted' },
    { key: 'criteria-ready', passed: 'Every criterion has a ready test case', failed: 'A criterion has no ready test case' },
    { key: 'interfaces-tested', passed: 'Every interface has an integration test', failed: 'An interface has no integration test' },
  ],
  // Phase 16e: before a pull request's Test approval, worked out from the evidence the Software Factory recorded. Not a
  // stage: the checks of a pull request in Test (other items in Test keep Test's own, or Verify's from before).
  'pull-request': [
    { key: 'required-tests', passed: 'Every required test is present and passing', failed: 'A required test is missing or not passing' },
    { key: 'gates-passed', passed: 'The checks passed on this commit', failed: 'The checks did not pass on this commit' },
  ],
};

