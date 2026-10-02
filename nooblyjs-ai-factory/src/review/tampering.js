// @ts-check
// Phase F11: TEST TAMPERING. The cheapest way to make failing tests pass is to
// weaken the tests. Agents do this: an assertion that "was wrong", a test that
// "was flaky", a `.skip` "for now". Gates can't catch it (the tests pass!), and
// a reviewer might not notice. A program can:
//
//   a test file that existed at the base is deleted              → blocking
//   assertions removed from an existing test file, net           → blocking
//   .skip / .only / xit / xdescribe / test.todo added            → blocking
//
// Deterministic, like the gates: no model, no judgement, the same diff always
// gives the same findings. A human (or the fixer, F13) can still decide the
// change was right, but it has to be SAID, not slipped through.
import { git } from '../exec/workspace/git.js';

const TEST_FILE = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/;
const ASSERTION = /\b(assert|expect|should)\b|\bt\.(is|deepEqual|true|false|throws)\(|\bself\.assert/;
const SKIP = /\b(it|test|describe)\.(skip|only|todo)\s*\(|\bx(it|describe|test)\s*\(|\{\s*skip\s*:\s*true|@pytest\.mark\.skip|t\.Skip\(/;

export const isTestFile = (file) => TEST_FILE.test(file);

/**
 * @param {string} mirrorDir
 * @param {string} baseSha   the original base (before spec and build)
 * @param {string} sha       the change's head
 * @returns {Promise<import('./findings.js').Finding[]>}
 */
export async function detectTampering(mirrorDir, baseSha, sha) {
  const findings = [];
  const status = await git(['diff', '--name-status', `${baseSha}..${sha}`], { cwd: mirrorDir });
  const existedBefore = new Set((await git(['ls-tree', '-r', '--name-only', baseSha], { cwd: mirrorDir })).split('\n'));
  for (const line of status.split('\n').filter(Boolean)) {
    const [code, file] = line.split('\t');
    if (code.startsWith('D') && isTestFile(file)) findings.push(finding(file, `The test file ${file} was deleted.`, 'Restore it, or explain in the PR why these tests no longer apply.'));
  }

  const diff = await git(['diff', '-U0', `${baseSha}..${sha}`], { cwd: mirrorDir });
  for (const [file, lines] of perFile(diff)) {
    if (!isTestFile(file)) continue;
    const removed = lines.filter((l) => l.startsWith('-') && ASSERTION.test(l)).length;
    const added = lines.filter((l) => l.startsWith('+') && ASSERTION.test(l)).length;
    if (existedBefore.has(file) && removed > added) {
      findings.push(finding(file, `${removed - added} assertion(s) were removed from ${file} (${removed} removed, ${added} added).`, 'Tests must not be weakened to make a change pass. Restore the assertions, or justify the change.'));
    }
    const skips = lines.filter((l) => l.startsWith('+') && SKIP.test(l));
    if (skips.length) findings.push(finding(file, `A test was skipped or focused in ${file}: ${skips[0].slice(1).trim().slice(0, 100)}`, 'Remove the skip/only; fix the code instead.'));
  }
  return findings;
}

/** "diff --git a/x b/x" sections → [file, changed lines]. */
function perFile(diff) {
  const out = [];
  let current = null;
  for (const line of diff.split('\n')) {
    const head = line.match(/^\+\+\+ b\/(.+)$/);
    if (head) {
      current = [head[1], []];
      out.push(current);
    } else if (line.startsWith('diff --git')) current = null;
    else if (current && /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line)) current[1].push(line);
  }
  return out;
}

/** @returns {import('./findings.js').Finding} */
function finding(file, rationale, suggestion) {
  return { severity: 'blocking', file, rationale, suggestion, source: 'tampering-check' };
}
