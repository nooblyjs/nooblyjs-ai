// @ts-check
// Phase F11: review FINDINGS, and checking a reviewer's answer.
//
//   {
//     "verdict": "approve" | "changes_requested",
//     "summary": "one paragraph",
//     "findings": [
//       { "severity": "blocking" | "major" | "minor" | "nit",
//         "file": "divide.js", "line": 2, "requirementId": "R2.2",
//         "rationale": "divide(1, 0) returns Infinity; R2.2 requires a RangeError",
//         "suggestion": "throw new RangeError('division by zero') when b === 0" }
//     ]
//   }
//
// Severity is what the factory ACTS on:
//   blocking   the change must not be merged as it is (the PR stays a draft; F13's fixer gets it)
//   major      should be fixed; shown prominently
//   minor/nit  shown; nobody is blocked
//
// An answer that doesn't fit the schema is sent back (the check → fix loop from F08),
// never guessed at. (Harness track H33, structured output, would do this in the harness.)
import { extractJson } from '../line/stations/common.js';

export const SEVERITIES = ['blocking', 'major', 'minor', 'nit'];

/**
 * @typedef {{ severity: 'blocking' | 'major' | 'minor' | 'nit', file?: string, line?: number, requirementId?: string,
 *             rationale: string, suggestion?: string, source?: string }} Finding
 * @typedef {{ verdict: 'approve' | 'changes_requested', summary: string, findings: Finding[] }} Review
 */

/**
 * @param {string} text   the reviewer's final message
 * @param {{ requirementIds?: string[] }} [known]  valid requirement ids (from the spec), if there is one
 * @returns {{ review: Review | null, problems: string[] }}
 */
export function parseReview(text, { requirementIds } = {}) {
  let raw;
  try {
    raw = extractJson(text);
  } catch {
    return { review: null, problems: ['the answer has no JSON object in a ```json block'] };
  }
  const problems = [];
  if (!['approve', 'changes_requested'].includes(raw?.verdict)) problems.push('"verdict" must be "approve" or "changes_requested"');
  if (!Array.isArray(raw?.findings)) problems.push('"findings" must be a list (empty if there are none)');
  const findings = [];
  for (const [i, f] of (Array.isArray(raw?.findings) ? raw.findings : []).entries()) {
    const at = `finding ${i + 1}`;
    if (!SEVERITIES.includes(f?.severity)) problems.push(`${at}: "severity" must be one of ${SEVERITIES.join(', ')}`);
    if (typeof f?.rationale !== 'string' || !f.rationale.trim()) problems.push(`${at}: "rationale" is required`);
    if (f?.requirementId && requirementIds && !requirementIds.includes(f.requirementId)) problems.push(`${at}: "${f.requirementId}" is not a requirement id in the spec (${requirementIds.join(', ')})`);
    findings.push({ severity: f?.severity, file: f?.file, line: typeof f?.line === 'number' ? f.line : undefined, requirementId: f?.requirementId, rationale: String(f?.rationale ?? ''), suggestion: f?.suggestion, source: 'reviewer' });
  }
  if (raw?.verdict === 'approve' && findings.some((f) => f.severity === 'blocking')) problems.push('"approve" with a blocking finding contradicts itself: use "changes_requested", or lower the severity');
  if (problems.length) return { review: null, problems };
  return { review: { verdict: raw.verdict, summary: String(raw.summary ?? ''), findings }, problems: [] };
}

/** Findings as a Markdown section for the PR. */
export function formatReview(reviews) {
  const all = reviews.flatMap((r) => r.findings.map((f) => ({ ...f, by: r.by })));
  const icon = { blocking: '⛔', major: '🟠', minor: '🟡', nit: '⚪' };
  const summary = reviews.map((r) => `**${r.by}**: ${r.verdict === 'approve' ? '✅ approve' : '⛔ changes requested'}${r.summary ? ` — ${r.summary}` : ''}`).join('\n\n');
  if (!all.length) return `## Review\n\n${summary}\n\nNo findings.`;
  const order = (f) => SEVERITIES.indexOf(f.severity);
  const rows = all.sort((a, b) => order(a) - order(b)).map((f) => `| ${icon[f.severity]} ${f.severity} | ${f.file ? `\`${f.file}${f.line ? `:${f.line}` : ''}\`` : ''} | ${f.requirementId ?? ''} | ${f.rationale.replace(/\|/g, '\\|')}${f.suggestion ? `<br>→ ${f.suggestion.replace(/\|/g, '\\|')}` : ''} | ${f.source === 'tampering-check' ? 'tampering check' : f.by} |`);
  return `## Review\n\n${summary}\n\n| Severity | Where | Requirement | Finding | By |\n|---|---|---|---|---|\n${rows.join('\n')}`;
}
