// @ts-check
// NooblyJS Phase 7: QUALITY ATTRIBUTES → GATES. In NooblyJS an architect writes an item's quality
// attributes as rows: { attribute, scenario, target, verifiedBy }. A run for that item carries
// them (request.noobly.attributes). Here each row is set against the gates the repository
// declares in its own .factory/config.json:
//
//   verifiedBy names a gate that ran ("test", "gate: test", "test gate")  → that gate's result is the attribute's
//   anything else ("Load test in staging", "k6", "manual review")         → "not checked by a gate", said on the PR
//
// The match is by NAME only, and it is strict on purpose: "Load test" is not the gate "test".
// Nothing in a row is ever run as a command: gates come from the repository, never from text
// a person or an agent typed into NooblyJS.

const norm = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The gate a row's verifiedBy names, or null. */
export function gateNamed(verifiedBy, gateNames) {
  const v = norm(verifiedBy).replace(/^gate:\s*/, '').replace(/\s+gate$/, '');
  return gateNames.find((name) => norm(name) === v) ?? null;
}

/**
 * @param {Array<{ attribute: string, scenario?: string, target?: string, verifiedBy?: string }>} [attributes]
 * @param {Array<{ name: string, status: string }>} [gateResults]  the gates that ran (verify station)
 * @returns {Array<{ attribute: string, scenario: string, target: string, verifiedBy: string, gate: string | null, status: string }>}
 *   status: the gate's own ("passed", "failed", "skipped"…), or "not_checked"
 */
export function attributeChecks(attributes = [], gateResults = []) {
  const names = gateResults.map((g) => g.name);
  return (Array.isArray(attributes) ? attributes : []).map((row) => {
    const gate = gateNamed(row.verifiedBy, names);
    return {
      attribute: String(row.attribute ?? ''), scenario: String(row.scenario ?? ''), target: String(row.target ?? ''), verifiedBy: String(row.verifiedBy ?? ''),
      gate, status: gate ? gateResults.find((g) => g.name === gate)?.status ?? 'not_checked' : 'not_checked',
    };
  });
}

const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const MARK = { passed: '✅ passed', failed: '❌ failed', skipped: '⚠️ skipped' };

/** The PR section: what this change is for in NooblyJS, and each quality attribute against a gate. */
export function nooblySection(noobly, gateResults = []) {
  if (!noobly?.itemId) return { md: '', checks: [] };
  const checks = attributeChecks(noobly.attributes, gateResults);
  const unchecked = checks.filter((c) => !c.gate);
  const lines = [`## From NooblyJS\n\nFor **${cell(noobly.itemId)}**, work item \`${cell(noobly.workItemId ?? '?')}\` (repository ${cell(noobly.repoName ?? '?')}), handed over in NooblyJS. The spec is the item's, in NooblyJS.`];
  if (!checks.length) lines.push('The item has no quality attributes.');
  else {
    lines.push(`| Quality attribute | Target | Verified by | Gate | Result |\n|---|---|---|---|---|\n${checks.map((c) => `| ${cell(c.attribute)} | ${cell(c.target)} | ${cell(c.verifiedBy)} | ${c.gate ? `\`${cell(c.gate)}\`` : '—'} | ${c.gate ? MARK[c.status] ?? cell(c.status) : '⚠️ not checked by a gate'} |`).join('\n')}`);
    if (unchecked.length) lines.push(`⚠️ **${unchecked.length} of ${checks.length} not checked by a gate:** ${unchecked.map((c) => cell(c.attribute)).join(', ')}. This repository declares no gate with that name, so a person has to check ${unchecked.length === 1 ? 'it' : 'them'}.`);
  }
  return { md: lines.join('\n\n'), checks };
}
