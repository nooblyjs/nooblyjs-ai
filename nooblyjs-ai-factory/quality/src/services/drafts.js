// Phase 16d: the Test section's scripted test analysis. From a story's acceptance criteria, interfaces, systems, NFRs and
// feature (the Design section's) and the test policy (test-policy.yaml): a test case per criterion (its given/when/then,
// at the level the policy gives it), a contract test per interface, an E2E test for the story's journey (its feature),
// and a case for each NFR the policy names. Without ids: the analysis service numbers them. With no model configured
// this is what the test agent's task plays; a model's answer has the same shape. Pure functions.

const GWT = /^given\s+(.+?),?\s+when\s+(.+?),?\s+then\s+(.+?)\.?$/i;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A criterion's given, when and then, or the whole text as the "then" when it isn't written that way. */
export function readCriterion(text) {
  const m = GWT.exec(String(text ?? '').trim());
  return m ? { given: m[1], when: m[2], then: m[3] } : { given: '', when: '', then: String(text ?? '').trim() };
}

/** The policy's level for a criterion: the first rule whose `when` matches, else integration. */
export function levelFor(policy, text) {
  for (const rule of policy?.criteria ?? []) {
    if (!rule.when) return { level: rule.level ?? 'integration', automate: rule.automate !== false };
    try {
      if (new RegExp(rule.when, 'i').test(text)) return { level: rule.level ?? 'integration', automate: rule.automate !== false };
    } catch { /* a rule that is not a regular expression is skipped */ }
  }
  return { level: 'integration', automate: true };
}

/**
 * The cases of a story's test analysis.
 * @param {object} o
 * @param {{ title: string, criteria?: string[], systems?: string[], featureTitle?: string }} o.story
 * @param {Array<{ id: string, name: string, from: string, to: string, contract: string }>} [o.interfaces]
 * @param {Array<{ id: string, category: string, requirement: string, target: string }>} [o.nfrs]
 * @param {any} [o.policy]
 */
export function draftAnalysis({ story, interfaces = [], nfrs = [], policy = {} }) {
  const systems = story.systems ?? [];
  const cases = [];
  (story.criteria ?? []).forEach((text, i) => {
    const gwt = readCriterion(text);
    cases.push({ criterion: i, title: cap(gwt.then), ...gwt, ...levelFor(policy, text), systems });
  });
  const iface = policy.interfaces ?? { level: 'contract', automate: true };
  for (const i of interfaces) {
    const sides = [i.from, i.to].filter((s) => systems.includes(s));
    cases.push({
      interface: i.id, title: `${i.name}: the agreed contract`, given: `${i.from || 'the caller'} calls ${i.to || 'the other side'}`,
      when: 'the request is made as agreed', then: `the answer has the agreed shape (${i.contract || 'the contract'})`,
      level: iface.level ?? 'contract', automate: iface.automate !== false, systems: sides.length ? sides : systems,
    });
  }
  const journey = policy.journeys ?? { level: 'e2e', automate: true };
  if (story.featureTitle) {
    cases.push({
      journey: story.featureTitle, title: `${story.featureTitle}, from start to end`, given: `a customer starts to ${story.featureTitle.charAt(0).toLowerCase()}${story.featureTitle.slice(1)}`,
      when: 'they go through it end to end', then: 'every criterion of the story holds', level: journey.level ?? 'e2e', automate: journey.automate !== false, systems,
    });
  }
  for (const n of nfrs) {
    const rule = policy.nfrs?.[n.category];
    if (!rule) continue;
    cases.push({ nfr: n.id, title: `${n.requirement}: ${rule.title ?? 'checked'}`, given: n.requirement, when: 'it is checked', then: `the target holds: ${n.target}`, level: rule.level ?? 'manual', automate: rule.automate === true, systems });
  }
  return { cases };
}
