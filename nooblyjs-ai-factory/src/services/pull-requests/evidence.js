// @ts-check
// NooblyJS Phase 16e: THE REQUIRED TESTS of a pull request. The story's test analysis (the Test section, Phase 16d)
// says which test cases the AI must automate against this repository; the run carries them (request.noobly.testCases).
// Here each one is looked for in the commit the pull request is at:
//
//   present   a test file of the commit names its id (TC-031-1-4), word for word: "this test says it is TC-031-1-4"
//   passing   present, and the repository's gates passed on that commit
//   failing   present, and the gates failed with a line that names it (not ok … TC-031-1-4)
//   unproven  present, but the gates didn't pass (or there are none), so nothing proves it passes
//   missing   no test file names it
//
// Like the F14 evidence's test lines, it is an honest link, not a proof that the test tests what its case says: a
// person reads them (the Build approval) and a tester checks them (the Test approval). Cases a person checks by hand
// (automate: false) are listed as such.
import { git } from '../exec/workspace/git.js';
import { isTestFile } from '../review/tampering.js';

const MAX_FILES = 400;
const MAX_BYTES = 400_000;
const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The id as a word of its own: TC-031-1-1 is not found inside TC-031-1-10. */
const idPattern = (id) => new RegExp(`(?<![\\w-])${escape(id)}(?![\\w-])`);
const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/**
 * @typedef {{ id: string, title?: string, level?: string, automate?: boolean }} TestCase
 * @typedef {{ id: string, title: string, level: string, found: string[], status: 'passing' | 'failing' | 'unproven' | 'missing' }} RequiredTest
 * @typedef {{ required: number, present: number, passing: number, missing: string[], failing: string[], unproven: string[],
 *             gates: 'passed' | 'failed' | 'none', text: string, cases: RequiredTest[], manual: Array<{ id: string, title: string }> }} RequiredTests
 */

/**
 * Where each id is named in the commit's test files.
 * @param {string} mirror   a git folder that has the commit
 * @param {string} sha
 * @param {string[]} ids
 * @returns {Promise<Record<string, string[]>>}  id → ["test/x.test.js:12", …]
 */
export async function namedIn(mirror, sha, ids) {
  const out = Object.fromEntries(ids.map((id) => [id, /** @type {string[]} */ ([])]));
  if (!ids.length) return out;
  const files = (await git(['ls-tree', '-r', '--name-only', sha], { cwd: mirror })).split('\n').filter((f) => f && isTestFile(f)).slice(0, MAX_FILES);
  const patterns = ids.map((id) => [id, idPattern(id)]);
  for (const file of files) {
    const text = (await git(['show', `${sha}:${file}`], { cwd: mirror }).catch(() => '')).slice(0, MAX_BYTES);
    text.split('\n').forEach((line, i) => {
      for (const [id, re] of patterns) if (/** @type {RegExp} */ (re).test(line)) out[/** @type {string} */ (id)].push(`${file}:${i + 1}`);
    });
  }
  return out;
}

/** The sentence: "9 of 10 required tests present (TC-031-1-4 missing)". */
export function requiredTestsText(t) {
  if (!t.required) return 'No required tests: the test analysis asks the AI to automate none in this repository';
  if (t.missing.length) return `${t.present} of ${t.required} required tests present (${t.missing.join(', ')} missing)`;
  if (t.failing.length) return `${t.present} of ${t.required} required tests present (${t.failing.join(', ')} failing)`;
  if (t.unproven.length) return `${t.present} of ${t.required} required tests present, not proven passing (${t.gates === 'none' ? 'the repository declares no gates' : 'the checks did not pass'})`;
  return `${t.present} of ${t.required} required tests present, all passing`;
}

/**
 * The required tests of one commit.
 * @param {{ mirror: string, sha: string, cases?: TestCase[], gates?: { passed?: boolean | null, results?: Array<{ status: string, excerpt?: string }> } | null }} o
 * @returns {Promise<RequiredTests>}
 */
export async function requiredTests({ mirror, sha, cases = [], gates = null }) {
  const list = (Array.isArray(cases) ? cases : []).filter((c) => c?.id);
  const automated = list.filter((c) => c.automate !== false);
  const where = await namedIn(mirror, sha, automated.map((c) => c.id));
  const verdict = gates?.passed === true ? 'passed' : gates?.passed === false ? 'failed' : 'none';
  const failedText = (gates?.results ?? []).filter((g) => g.status !== 'passed' && g.status !== 'skipped').map((g) => g.excerpt ?? '').join('\n');
  const failedLines = failedText.split('\n').filter((l) => /not ok|✖|fail/i.test(l));
  const rows = automated.map((c) => {
    const found = where[c.id] ?? [];
    const named = idPattern(c.id);
    const status = !found.length ? 'missing' : verdict === 'passed' ? 'passing' : failedLines.some((l) => named.test(l)) ? 'failing' : 'unproven';
    return { id: c.id, title: String(c.title ?? ''), level: String(c.level ?? ''), found, status: /** @type {RequiredTest['status']} */ (status) };
  });
  const of = (s) => rows.filter((r) => r.status === s).map((r) => r.id);
  const summary = {
    required: rows.length, present: rows.filter((r) => r.found.length).length, passing: of('passing').length,
    missing: of('missing'), failing: of('failing'), unproven: of('unproven'), gates: /** @type {RequiredTests['gates']} */ (verdict),
    cases: rows, manual: list.filter((c) => c.automate === false).map((c) => ({ id: c.id, title: String(c.title ?? '') })), text: '',
  };
  summary.text = requiredTestsText(summary);
  return summary;
}

const MARK = { passing: '✅ passing', failing: '❌ failing', unproven: '⚠️ present, not proven', missing: '⛔ missing' };

/** The PR evidence's section: each required test by id, and what a person checks. */
export function requiredTestsSection(t) {
  if (!t) return '';
  const lines = [`## Required tests (from the test analysis)\n\n**${t.text}.**`];
  if (t.cases.length) lines.push(`| Test case | Level | What it proves | Found in | Result |\n|---|---|---|---|---|\n${t.cases.map((c) => `| ${c.id} | ${cell(c.level)} | ${cell(c.title)} | ${c.found.length ? c.found.slice(0, 3).map((f) => `\`${f}\``).join(' ') : '—'} | ${MARK[c.status]} |`).join('\n')}`);
  if (t.manual.length) lines.push(`Checked by a person (the tester, at the Test approval):\n\n${t.manual.map((c) => `- ${c.id}: ${cell(c.title)}`).join('\n')}`);
  return lines.join('\n\n');
}
