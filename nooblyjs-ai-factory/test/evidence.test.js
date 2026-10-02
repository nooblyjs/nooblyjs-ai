// Phase F14: the scope guard and the evidence bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { checkScope } from '../src/exec/gates/scope-guard.js';
import { createMockProvider } from '../src/harness.js';
import { runJob } from '../src/job/run-job.js';
import { getArtifact } from '../src/store/artifacts.js';
import { openStore } from '../src/store/events.js';
import { approve, gitIn, makeRepo, testEnv, tmpDir } from './helpers.js';

// ---- the scope guard, as tables ----------------------------------------------------------------

const tasks = [{ id: 'T1', paths: ['src/calc.js', 'lib/'] }];
const why = (input) => checkScope(input).violations.map((v) => `${v.file}:${v.why}`);

test('scope: declared files and folders, tests and the spec folder are in; anything else is out', () => {
  assert.deepEqual(why({ changed: ['src/calc.js', 'lib/a/b.js', 'test/calc.test.js', 'src/x.test.js', '.factory/specs/issue-1/tasks.md'], tasks, specDir: '.factory/specs/issue-1' }), []);
  assert.deepEqual(why({ changed: ['src/other.js', 'README.md'], tasks }), ['src/other.js:outside', 'README.md:outside']);
});

test('scope: protected paths fail unless a task declares them, WITH a spec or without', () => {
  assert.deepEqual(why({ changed: ['.github/workflows/ci.yml', 'package-lock.json'], tasks: null }), ['.github/workflows/ci.yml:protected', 'package-lock.json:protected']);
  const declared = checkScope({ changed: ['.github/workflows/ci.yml'], tasks: [{ id: 'T1', paths: ['.github/workflows/ci.yml'] }] });
  assert.deepEqual([declared.ok, declared.declaredProtected], [true, ['.github/workflows/ci.yml']], 'allowed, but noted: a person merges it (F12)');
  assert.deepEqual(why({ changed: ['src/any.js'], tasks: null }), [], 'no spec: only protected paths count');
});

test('scope: paths a person granted during the run are in', () => {
  assert.deepEqual(why({ changed: ['docs/calc.md'], tasks, granted: ['docs/'] }), []);
});

// ---- end to end ----------------------------------------------------------------------------------

const specDir = '.factory/specs/issue-1';
const write = (file, content) => ({ name: 'Write', input: { file_path: file, content } });
const read = (file) => ({ name: 'Read', input: { file_path: file } });
const REQ = '## R1: Halve\nAs a user, I want half(n), so that I can split things.\n- R1.1 WHEN half(n) is called THE SYSTEM SHALL return n / 2\n- R1.2 IF n is not a number THEN THE SYSTEM SHALL throw a TypeError\n';
const TASKS = '- [ ] T1: Add half()\n  - Requirements: R1.1, R1.2\n  - Paths: half.js\n  - Depends on: none\n';
function issueFile() {
  const file = path.join(tmpDir(), 'issue.md');
  fs.writeFileSync(file, '---\ntitle: Add half\n---\nhalf(n) returns n / 2.\n');
  return file;
}
const triage = () => createMockProvider([{ text: '```json\n{"kind":"feature","size":"medium","clear":true,"outOfScope":false,"questions":[],"reason":"a function and its errors"}\n```' }]);
const spec = () => createMockProvider([{ text: 'Spec.', tools: [write(`${specDir}/requirements.md`, REQ), write(`${specDir}/design.md`, '# Design\nhalf.js\n'), write(`${specDir}/tasks.md`, TASKS)] }, { text: 'Spec written.' }]);
const HALF = "export const half = (n) => {\n  if (typeof n !== 'number') throw new TypeError('n must be a number');\n  return n / 2;\n};\n";
const TEST = "import assert from 'node:assert/strict';\nimport { half } from '../half.js';\n// R1.1\nassert.equal(half(4), 2);\n// R1.2\nassert.throws(() => half('x'), TypeError);\n";

test('A SCOPE VIOLATION is a failing check; the fixer reverts it; the PR shows scope ✅', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ 'README.md': '# calc\n', 'package.json': '{"type":"module"}' });
  const build = createMockProvider([{ text: 'Implementing, and tidying the README while I am here.', tools: [read('README.md')] }, { text: 'x', tools: [write('half.js', HALF), write('test/half.test.js', TEST), write('README.md', '# calc\n\nNow with half!\n')] }, { text: 'Done.' }]);
  const fix = createMockProvider([{ text: 'Reverting the README.', tools: [read('README.md')] }, { text: 'x', tools: [write('README.md', '# calc\n')] }, { text: 'Reverted README.md: it is outside the task.' }]);
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo, providers: { triage: triage(), spec: spec(), build, 'fix#1': fix, review: await approve() } }, { env, store });
  assert.equal(out.status, 'delivered');
  assert.match(JSON.stringify(fix.requests[0].messages), /README\.md: outside every task's declared Paths/);
  assert.equal(gitIn(repo, 'show', 'factory/issue-1/main:README.md'), '# calc');
  assert.match(fs.readFileSync(/** @type {string} */ (out.pr?.path), 'utf8'), /## Scope\n\n✅ Every changed file is within/);
});

test('THE EVIDENCE BUNDLE has every section, the facts as JSON, and links criteria to the tests that name them', async () => {
  const env = testEnv();
  const store = openStore({ env });
  const repo = makeRepo({ 'package.json': '{"type":"module"}', '.factory/config.json': JSON.stringify({ gates: { test: { command: 'node test/half.test.js', fast: false } } }) });
  const build = createMockProvider([{ text: 'x', tools: [write('half.js', 'export const half = (n) => n / 2;\n'), write('test/half.test.js', TEST)] }, { text: 'Implemented half.' }]);
  const fix = createMockProvider([{ text: 'Reading.', tools: [read('half.js')] }, { text: 'x', tools: [write('half.js', HALF)] }, { text: 'Added the TypeError for R1.2.' }]);
  const review = createMockProvider([{ text: '```json\n{"verdict":"approve","summary":"Good.","findings":[{"severity":"nit","file":"half.js","rationale":"could use Number.isFinite"}]}\n```' }]);
  const out = await runJob({ autonomy: 'L2', issueFile: issueFile(), repo, allowUnsandboxed: true, providers: { triage: triage(), spec: spec(), build, 'fix#1': fix, review } }, { env, store });
  assert.equal(out.status, 'delivered');
  const pr = fs.readFileSync(/** @type {string} */ (out.pr?.path), 'utf8');
  for (const section of ['## At a glance', '## Summary (written by the agent)', '## Requirements → tasks → tests', '## Checks', '## Scope', '## Review', '## Repairs', '## Changes', '## Cost and time, by station', '## Review it']) assert.ok(pr.includes(section), section);
  assert.match(pr, /\| delivered \| ✅ pass \| ✅ approved \| 1 \| ✅ within declared paths \| ✅ every criterion \|/);
  assert.match(pr, /\| R1\.2 \| IF n is not a number THEN THE SYSTEM SHALL throw a TypeError \| T1 \| `test\/half\.test\.js:5` \|/);
  assert.match(pr, /\| repair 1 \| fixed \| \$0\.0\d{3} \|/, "the fixer's cost has its own row");
  assert.doesNotMatch(pr, /\| pending \|/, 'stations that did not run in the end are not listed');
  const rows = [...pr.matchAll(/^\| (?!\*\*run)[^|]+ \| [^|]+ \| \$(\d+\.\d+) \|/gm)].map((m) => Number(m[1]));
  const total = Number(pr.match(/\*\*\$(\d+\.\d+)\*\*/)?.[1]);
  assert.ok(Math.abs(rows.reduce((a, b) => a + b, 0) - total) < 0.00015, `the rows add up to the total (${rows} vs ${total})`);
  assert.match(pr, /factory logs run-/);

  const sha = store.get('runs', out.runId).artifacts.find((a) => a.kind === 'evidence').sha;
  const json = JSON.parse(String(getArtifact(sha, env)));
  assert.equal(json.status, 'delivered');
  assert.deepEqual(json.coverage.map((c) => [c.id, c.tests]), [['R1.1', ['test/half.test.js:3']], ['R1.2', ['test/half.test.js:5']]]);
  assert.equal(json.repairs.length, 1);
  assert.equal(json.reviews[0].findings[0].severity, 'nit');
  assert.ok(json.stations.find((s) => s.id === 'build'));
});
